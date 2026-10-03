import { candidateContextSchema } from '@ai-schedule/contracts/internal-agent/v1';
import type { Prisma } from '@ai-schedule/db';

import type { AgentRunSource } from '../../modules/agent/agent-admission.port.js';
import { createCandidateReference } from '../../modules/agent/agent-context.js';
import { type TransactionScope } from '../database/unit-of-work.js';

import type {
  CandidateSeed,
  Transaction,
  ValidatedCandidate} from './agent-persistence.shared.js';
import {
  AgentPersistenceInvariantError,
  AgentPersistenceSupport,
  asJson,
  conflict,
} from './agent-persistence.shared.js';

export class PrismaAgentContextReader extends AgentPersistenceSupport {
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
            limit: Math.min(projectIds.size, 30),
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
