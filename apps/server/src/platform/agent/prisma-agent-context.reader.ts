import { candidateContextSchema } from '@ai-schedule/contracts/internal-agent/v1';
import {
  contextReadResponseSchema,
  safePreviousDraftSchema,
  sourceContextSchema,
  type ContextReadRequest,
  type ContextReadResponse,
} from '@ai-schedule/contracts/internal-agent/v2';
import type { Prisma } from '@ai-schedule/db';
import { ApiHttpException } from '../http/api-http.exception.js';
import { AgentContextCursor } from './agent-context-cursor.js';
import { CONSUMABLE_MESSAGE_WHERE } from './agent-persistence.shared.js';

import type { AgentRunSource } from '../../modules/agent/agent-admission.port.js';
import { createCandidateReference } from '../../modules/agent/agent-context.js';
import { type TransactionScope } from '../database/unit-of-work.js';

import type { CandidateSeed, Transaction, ValidatedCandidate } from './agent-persistence.shared.js';
import {
  AgentPersistenceInvariantError,
  AgentPersistenceSupport,
  asJson,
  conflict,
} from './agent-persistence.shared.js';

export class PrismaAgentContextReader extends AgentPersistenceSupport {
  /** Called in one short transaction; no Provider/network work holds this lock. */
  async read(
    scope: TransactionScope,
    input: ContextReadRequest,
    token: string,
  ): Promise<ContextReadResponse> {
    const transaction = this.unitOfWork.clientFor(scope);
    const unavailable = () =>
      new ApiHttpException(409, 'AGENT_CONTEXT_UNAVAILABLE', '智能上下文不可用');
    if (!(await this.lockRun(transaction, input.requestId))) throw unavailable();
    const run = await transaction.agentRequestRun.findUnique({ where: { id: input.requestId } });
    if (
      !run ||
      run.status !== 'RUNNING' ||
      !run.conversationId ||
      !run.runDeadlineAt ||
      (run.executeTimeoutAt ?? run.runDeadlineAt) <= new Date()
    )
      throw unavailable();
    const codec = new AgentContextCursor(token);
    const offset = codec.decode(input.cursor, run.id, input.resource);
    const extra = this.jsonRecord(run.extra ?? {});
    const cutoffId = run.sourceMessageId ?? this.contextMessageId(run.extra);
    const cutoff = cutoffId
      ? await transaction.message.findFirst({
          where: { id: cutoffId, userId: run.userId, conversationId: run.conversationId },
        })
      : null;
    if (!cutoff) throw unavailable();
    const source = this.jsonRecord(extra.contextSource ?? {});
    const legacyPlan = this.jsonRecord(extra.planSource ?? {});
    const kind =
      source.kind ??
      (legacyPlan.type === 'PROPOSAL'
        ? 'REGENERATE'
        : legacyPlan.type === 'MESSAGE'
          ? 'PLAN'
          : extra.answerSource
            ? 'ANSWER'
            : run.allowedResultTypes.length === 1 && run.allowedResultTypes[0] === 'ACTION_PROPOSAL'
              ? 'ORGANIZE'
              : 'TURN');
    const response: ContextReadResponse = {
      requestId: run.id,
      resource: input.resource,
      source: null,
      messages: [],
      candidates: [],
      nextCursor: null,
    };
    if (input.resource === 'SOURCE') {
      if (offset !== 0) throw unavailable();
      let draft = source.previousDraft ?? null;
      let instruction = source.instruction ?? null;
      if (!source.kind) {
        instruction = cutoff.content;
        if (kind === 'REGENERATE') {
          try {
            const legacy = this.jsonRecord(JSON.parse(cutoff.content) as Prisma.JsonValue);
            // A whitelist schema rejects legacy IDs instead of exporting arbitrary JSON.
            draft = safePreviousDraftSchema.parse(legacy.previousDraft);
            instruction = typeof legacy.instruction === 'string' ? legacy.instruction : null;
          } catch {
            throw unavailable();
          }
        }
      }
      response.source = sourceContextSchema.parse({ kind, instruction, previousDraft: draft });
      return contextReadResponseSchema.parse(response);
    }
    // Per-page transport protection only; the caller controls how many pages to read.
    const take = Math.min(input.limit, 128);
    let hasMore = false;
    if (input.resource === 'MESSAGES') {
      const rows = await transaction.message.findMany({
        where: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: { in: ['USER', 'ASSISTANT'] },
          AND: [
            CONSUMABLE_MESSAGE_WHERE,
            {
              OR: [
                { createdAt: { lt: cutoff.createdAt } },
                { createdAt: cutoff.createdAt, id: { lte: cutoff.id } },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: take + 1,
      });
      hasMore = rows.length > take;
      for (const row of rows.slice(0, take)) {
        const structured = this.jsonRecord(row.structuredData ?? {});
        const message = {
          role: row.role as 'USER' | 'ASSISTANT',
          content:
            row.role === 'USER' && typeof structured.text === 'string'
              ? structured.text
              : row.content,
        };
        if (
          Buffer.byteLength(
            JSON.stringify({ ...response, messages: [...response.messages, message] }),
          ) >
          250 * 1024
        ) {
          hasMore = true;
          break;
        }
        response.messages.push(message);
      }
    } else {
      const contextScope = this.jsonRecord(extra.contextScope ?? {});
      const scopedId =
        contextScope.type === 'PROJECT' && typeof contextScope.projectId === 'string'
          ? contextScope.projectId
          : undefined;
      // Undispatched legacy organize Runs retain their original product scope via saved mappings.
      const legacyScope =
        !source.kind && kind === 'ORGANIZE'
          ? await transaction.agentRequestCandidateRef.findMany({
              where: {
                requestRunId: run.id,
                kind: input.resource === 'TASKS' ? 'TASK' : 'PROJECT',
              },
              orderBy: { candidateRef: 'asc' },
              skip: offset,
              take: take + 1,
            })
          : null;
      if (legacyScope) {
        response.candidates = legacyScope
          .slice(0, take)
          .map((row) => candidateContextSchema.parse(row.snapshot));
        hasMore = legacyScope.length > take;
      } else {
        const rows =
          input.resource === 'TASKS'
            ? await this.tasks.listAgentCandidates(scope, {
                userId: run.userId,
                limit: take + 1,
                offset,
                onlyUnassigned: kind === 'ORGANIZE',
                statuses: kind === 'ORGANIZE' ? ['TODO'] : ['TODO', 'COMPLETED'],
              })
            : await this.projects.listAgentCandidates(scope, {
                userId: run.userId,
                limit: take + 1,
                offset,
                ...(scopedId ? { projectIds: [scopedId] } : {}),
              });
        hasMore = rows.length > take;
        for (const row of rows.slice(0, take)) {
          const task = 'title' in row ? row : null;
          const existing = await transaction.agentRequestCandidateRef.findFirst({
            where: { requestRunId: run.id, ...(task ? { taskId: row.id } : { projectId: row.id }) },
          });
          const snapshot = existing
            ? candidateContextSchema.parse(existing.snapshot)
            : candidateContextSchema.parse({
                candidateRef: createCandidateReference(),
                kind: task ? 'TASK' : 'PROJECT',
                label: task
                  ? task.status === 'COMPLETED'
                    ? `【已完成】${task.title}`
                    : task.title
                  : 'name' in row
                    ? row.name
                    : '',
                version: row.version,
                ...(task
                  ? {
                      priority: task.priority,
                      scheduledAt: task.scheduledAt?.toISOString() ?? null,
                      deadlineAt: task.deadlineAt?.toISOString() ?? null,
                    }
                  : {}),
              });
          if (
            Buffer.byteLength(
              JSON.stringify({ ...response, candidates: [...response.candidates, snapshot] }),
            ) >
            250 * 1024
          ) {
            hasMore = true;
            break;
          }
          if (!existing)
            await transaction.agentRequestCandidateRef.create({
              data: {
                requestRunId: run.id,
                userId: run.userId,
                candidateRef: snapshot.candidateRef,
                kind: snapshot.kind,
                ...(task ? { taskId: row.id } : { projectId: row.id }),
                targetVersion: snapshot.version,
                label: snapshot.label,
                snapshot: asJson(snapshot),
                expiresAt: new Date(
                  typeof extra.candidateExpiresAt === 'string'
                    ? extra.candidateExpiresAt
                    : (run.recoveryEligibleAt ?? run.runDeadlineAt).getTime() + 60_000,
                ),
              },
            });
          response.candidates.push(snapshot);
        }
      }
    }
    const count = response.messages.length + response.candidates.length;
    if (hasMore && count === 0) throw unavailable();
    if (hasMore) response.nextCursor = codec.encode(run.id, input.resource, offset + count);
    return contextReadResponseSchema.parse(response);
  }

  async sanitizeProposalForAgent(
    scope: TransactionScope,
    proposal: {
      userId: string;
      actionCode: string | null;
      title: string | null;
      summary: string;
      mutations: Array<{ targetType: string; operation: string; afterValue: Prisma.JsonValue }>;
    },
  ): Promise<Record<string, unknown>> {
    const projectIds = new Set<string>();
    for (const mutation of proposal.mutations) {
      const project = this.jsonRecord(mutation.afterValue).project;
      if (
        typeof project === 'object' &&
        project !== null &&
        !Array.isArray(project) &&
        project.type === 'EXISTING' &&
        typeof project.projectId === 'string'
      ) {
        projectIds.add(project.projectId);
      }
    }
    const projects =
      projectIds.size === 0
        ? []
        : await this.projects.listAgentCandidates(scope, {
            userId: proposal.userId,
            limit: projectIds.size,
            projectIds: [...projectIds],
          });
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const tasks = proposal.mutations
      .filter((mutation) => mutation.targetType === 'TASK' && mutation.operation === 'CREATE')
      .map((mutation) => {
        const value = this.jsonRecord(mutation.afterValue);
        const project = value.project;
        let safeProject: Record<string, unknown> | undefined;
        if (typeof project === 'object' && project !== null && !Array.isArray(project)) {
          if (project.type === 'NEW' && typeof project.name === 'string') {
            safeProject = { type: 'NEW', name: project.name };
          } else if (project.type === 'EXISTING' && typeof project.projectId === 'string') {
            safeProject = { type: 'EXISTING', name: names.get(project.projectId) ?? '已有项目' };
          }
        }
        return {
          title: typeof value.title === 'string' ? value.title : '未命名任务',
          description: typeof value.description === 'string' ? value.description : null,
          priority: typeof value.priority === 'string' ? value.priority : 'MEDIUM',
          scheduledAt: typeof value.scheduledAt === 'string' ? value.scheduledAt : null,
          deadlineAt: typeof value.deadlineAt === 'string' ? value.deadlineAt : null,
          reminderAt: typeof value.reminderAt === 'string' ? value.reminderAt : null,
          ...(safeProject ? { project: safeProject } : {}),
        };
      });
    return {
      actionCode: proposal.actionCode ?? 'CREATE_PROJECT_TASKS',
      title: proposal.title ?? '计划草稿',
      summary: proposal.summary,
      tasks,
    };
  }

  async createCandidates(
    scope: TransactionScope,
    userId: string,
    source: AgentRunSource,
    expiresAt: Date,
  ): Promise<CandidateSeed[]> {
    const tasks = await this.tasks.listAgentCandidates(scope, {
      userId,
      limit: source.kind === 'ORGANIZE' ? 20 : 50,
      onlyUnassigned: source.kind === 'ORGANIZE',
      statuses: source.kind === 'ORGANIZE' ? ['TODO'] : ['TODO', 'COMPLETED'],
    });
    if (source.kind === 'ORGANIZE' && tasks.length === 0) {
      throw conflict('当前没有可整理的无项目待办');
    }
    const scopedProjectId =
      source.kind === 'ORGANIZE' && source.input.scope.type === 'PROJECT'
        ? source.input.scope.projectId
        : undefined;
    const projects = await this.projects.listAgentCandidates(scope, {
      userId,
      limit: scopedProjectId ? 1 : 30,
      ...(scopedProjectId ? { projectIds: [scopedProjectId] } : {}),
    });
    if (scopedProjectId && projects.length !== 1) {
      throw conflict('整理目标项目不存在或已归档');
    }
    const taskCandidates = tasks.map((task) => {
      const candidateRef = createCandidateReference();
      const label = task.status === 'COMPLETED' ? `【已完成】${task.title}` : task.title;
      const snapshot = candidateContextSchema.parse({
        candidateRef,
        kind: 'TASK',
        label,
        version: task.version,
        priority: task.priority,
        scheduledAt: task.scheduledAt?.toISOString() ?? null,
        deadlineAt: task.deadlineAt?.toISOString() ?? null,
      });
      return {
        userId,
        candidateRef,
        kind: 'TASK' as const,
        taskId: task.id,
        targetVersion: task.version,
        label,
        snapshot: asJson(snapshot),
        expiresAt,
      };
    });
    const projectCandidates = projects.map((project) => {
      const candidateRef = createCandidateReference();
      const snapshot = candidateContextSchema.parse({
        candidateRef,
        kind: 'PROJECT',
        label: project.name,
        version: project.version,
      });
      return {
        userId,
        candidateRef,
        kind: 'PROJECT' as const,
        projectId: project.id,
        targetVersion: project.version,
        label: project.name,
        snapshot: asJson(snapshot),
        expiresAt,
      };
    });
    return [...taskCandidates, ...projectCandidates];
  }

  async requireCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    input: Readonly<{
      runId: string;
      userId: string;
      candidateRef: string;
      now: Date;
    }>,
  ): Promise<ValidatedCandidate> {
    const candidate = await transaction.agentRequestCandidateRef.findFirst({
      where: {
        requestRunId: input.runId,
        userId: input.userId,
        candidateRef: input.candidateRef,
      },
      select: {
        kind: true,
        taskId: true,
        projectId: true,
        targetVersion: true,
        expiresAt: true,
      },
    });
    if (!candidate || candidate.expiresAt <= input.now) {
      throw conflict('候选项已过期，请重新发起智能请求');
    }
    if (candidate.kind === 'TASK') {
      const task = candidate.taskId
        ? await this.tasks.findAgentTask(scope, { userId: input.userId, taskId: candidate.taskId })
        : null;
      if (!task || task.version !== candidate.targetVersion) {
        throw conflict('候选待办已发生变化，请刷新后重试');
      }
      return { kind: 'TASK', targetVersion: candidate.targetVersion, task, project: null };
    }
    const project = candidate.projectId
      ? await this.projects.findActiveAgentProject(scope, {
          userId: input.userId,
          projectId: candidate.projectId,
        })
      : null;
    if (!project || project.version !== candidate.targetVersion) {
      throw conflict('候选项目已发生变化，请刷新后重试');
    }
    return { kind: 'PROJECT', targetVersion: candidate.targetVersion, task: null, project };
  }

  async requireTaskCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    candidateRef: string,
    expectedVersion: number,
  ) {
    const candidate = await this.requireCandidate(scope, transaction, {
      runId: run.id,
      userId: run.userId,
      candidateRef,
      now: new Date(),
    });
    if (
      !candidate.task ||
      candidate.kind !== 'TASK' ||
      candidate.targetVersion !== expectedVersion
    ) {
      throw new AgentPersistenceInvariantError('Task candidate does not match mutation');
    }
    return candidate.task;
  }

  async requireProjectCandidate(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    candidateRef: string,
  ) {
    const candidate = await this.requireCandidate(scope, transaction, {
      runId: run.id,
      userId: run.userId,
      candidateRef,
      now: new Date(),
    });
    if (!candidate.project || candidate.kind !== 'PROJECT') {
      throw new AgentPersistenceInvariantError('Project candidate does not match mutation');
    }
    return candidate.project;
  }
}
