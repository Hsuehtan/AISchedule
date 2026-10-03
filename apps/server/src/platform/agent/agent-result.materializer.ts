import {
  candidateContextSchema,
  type ActionProposalResult,
  type ActionMutation as InternalActionMutation,
  type PlanResult,
} from '@ai-schedule/contracts/internal-agent/v1';
import { Prisma } from '@ai-schedule/db';
import type { ExecuteResponse } from '../../modules/agent/agent-runtime.port.js';
import { validateResultReferences } from './agent-result-validation.js';

import { AgentResultRejectedError } from '../../modules/agent/agent-runtime.port.js';
import { type AgentProjectsPort } from '../../modules/projects/agent-projects.port.js';
import { type AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import type { DatabaseService } from '../database/database.service.js';
import type { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import { type TransactionScope } from '../database/unit-of-work.js';

import type {
  NormalizedMutation,
  ResolvedProjectSelection,
  StoredAnswerOption,
  Transaction,
} from './agent-persistence.shared.js';
import {
  AgentLateResultError,
  AgentPersistenceInvariantError,
  AgentPersistenceSupport,
  AgentResultNotImplementedError,
  MAX_PROJECT_NAME_LENGTH,
  PROPOSAL_TTL_MS,
  asJson,
  isRejectedProductResult,
  nextStep,
  resultRejectionCode,
  sha256,
} from './agent-persistence.shared.js';
import type { PrismaAgentContextReader } from './prisma-agent-context.reader.js';

export class AgentResultMaterializer extends AgentPersistenceSupport {
  constructor(
    unitOfWork: DatabaseUnitOfWork,
    database: DatabaseService,
    tasks: AgentTasksPort,
    projects: AgentProjectsPort,
    private readonly context: PrismaAgentContextReader,
  ) {
    super(unitOfWork, database, tasks, projects);
  }
  async persistResult(
    scope: TransactionScope,
    input: Readonly<{ runId: string; response: ExecuteResponse; persistedAt: Date }>,
  ): Promise<'IGNORED_TERMINAL' | 'PERSISTED'> {
    const transaction = this.unitOfWork.clientFor(scope);
    try {
      if (!(await this.lockRun(transaction, input.runId))) return 'IGNORED_TERMINAL';
      const run = await transaction.agentRequestRun.findUnique({ where: { id: input.runId } });
      if (!run) return 'IGNORED_TERMINAL';
      if (
        ['FAILED', 'RELEASED', 'RESULT_PERSISTED', 'SETTLING', 'SUCCEEDED'].includes(run.status)
      ) {
        return 'IGNORED_TERMINAL';
      }
      if (run.status !== 'RUNNING' || !run.conversationId) {
        throw new AgentPersistenceInvariantError('Run is not accepting a result');
      }
      if (run.runDeadlineAt && input.persistedAt >= run.runDeadlineAt) {
        throw new AgentLateResultError();
      }
      if (
        input.response.requestId !== run.id ||
        input.response.contractVersion !== run.contractVersion ||
        !run.allowedResultTypes.includes(input.response.result.type)
      ) {
        throw new AgentPersistenceInvariantError('Result does not match Run admission');
      }

      const extra = this.jsonRecord(run.extra ?? {});
      const source =
        typeof extra.contextSource === 'object' &&
        extra.contextSource !== null &&
        !Array.isArray(extra.contextSource)
          ? extra.contextSource
          : {};
      const organize =
        source.kind === 'ORGANIZE' ||
        (run.allowedResultTypes.length === 1 && run.allowedResultTypes[0] === 'ACTION_PROPOSAL');
      if (
        organize &&
        (input.response.result.type !== 'ACTION_PROPOSAL' ||
          input.response.result.actionCode !== 'ORGANIZE_TASKS')
      ) {
        throw new AgentResultRejectedError('AGENT_RESULT_INVALID');
      }
      const refs = await transaction.agentRequestCandidateRef.findMany({
        where: { requestRunId: run.id, userId: run.userId },
      });
      try {
        validateResultReferences(
          {
            allowedResultTypes: run.allowedResultTypes,
            candidates: refs.map((ref) => candidateContextSchema.parse(ref.snapshot)),
          },
          input.response.result,
        );
      } catch {
        throw new AgentResultRejectedError('AGENT_RESULT_INVALID');
      }
      const materialized = await this.materializeResult(
        scope,
        transaction,
        {
          id: run.id,
          userId: run.userId,
          conversationId: run.conversationId,
          sourceProposalId: run.sourceProposalId,
          extra: run.extra,
        },
        input.response,
      );
      const updated = await transaction.agentRequestRun.updateMany({
        where: { id: run.id, status: 'RUNNING', resultPersistedAt: null },
        data: {
          status: 'RESULT_PERSISTED',
          provider: input.response.resolved.provider,
          model: input.response.resolved.model,
          promptVersion: input.response.resolved.promptVersion,
          schemaVersion: input.response.resolved.providerSchemaVersion,
          repairAttempts: input.response.resolved.repairAttempts,
          resultType: input.response.result.type,
          resultPayload: asJson(materialized.resultPayload),
          resultHash: sha256(input.response),
          resultPersistedAt: input.persistedAt,
        },
      });
      if (updated.count !== 1) {
        throw new AgentPersistenceInvariantError('Result lost its state CAS');
      }
      return 'PERSISTED';
    } catch (error) {
      if (isRejectedProductResult(error)) {
        throw new AgentResultRejectedError(resultRejectionCode(error));
      }
      throw error;
    }
  }

  async materializeResult(
    scope: TransactionScope,
    transaction: Transaction,
    run: {
      id: string;
      userId: string;
      conversationId: string;
      sourceProposalId: string | null;
      extra: Prisma.JsonValue;
    },
    response: ExecuteResponse,
  ): Promise<{ resultPayload: Record<string, unknown> }> {
    const result = response.result;
    if (result.type === 'REPLY') {
      const message = await transaction.message.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: 'ASSISTANT',
          messageType: 'AI_REPLY',
          inputMode: 'SYSTEM',
          content: result.text,
          structuredData: {
            type: 'AI_REPLY',
            text: result.text,
            canGeneratePlan: result.offerPlan,
          },
          requestRunId: run.id,
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    if (result.type === 'CLARIFICATION' || result.type === 'CANDIDATES') {
      const policyOptions: StoredAnswerOption[] = [];
      if (result.type === 'CANDIDATES') {
        for (const option of result.options) {
          await this.context.requireCandidate(scope, transaction, {
            runId: run.id,
            userId: run.userId,
            candidateRef: option.candidateRef,
            now: new Date(),
          });
          policyOptions.push({
            optionId: option.optionId,
            label: option.label,
            candidateRef: option.candidateRef,
            nextStep: 'AGENT_STANDARD_TURN',
          });
        }
      } else {
        for (const option of result.options) {
          policyOptions.push({
            optionId: option.optionId,
            label: option.label,
            nextStep: nextStep(option.nextStep),
          });
        }
      }
      const freeTextNextStep = policyOptions.every(
        (option) => option.nextStep === 'AGENT_PLAN_GENERATION',
      )
        ? 'AGENT_PLAN_GENERATION'
        : 'AGENT_STANDARD_TURN';
      const publicNextStep = policyOptions.every(
        (option) => option.nextStep === policyOptions[0]?.nextStep,
      )
        ? (policyOptions[0]?.nextStep ?? 'AGENT_STANDARD_TURN')
        : 'AGENT_STANDARD_TURN';
      const options = policyOptions.map((option) => ({
        id: option.optionId,
        label: Array.from(option.label).slice(0, 120).join(''),
      }));
      const structuredData =
        result.type === 'CLARIFICATION'
          ? {
              type: 'QUESTION',
              questionKind: 'CLARIFICATION',
              prompt: result.question,
              options,
              allowFreeText: result.allowFreeText,
              nextStep: publicNextStep,
            }
          : {
              type: 'QUESTION',
              questionKind: 'CANDIDATES',
              prompt: result.question,
              options,
              allowFreeText: true,
              nextStep: publicNextStep,
            };
      const message = await transaction.message.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: 'ASSISTANT',
          messageType: 'QUESTION',
          inputMode: 'SYSTEM',
          content: result.question,
          structuredData,
          interactionStatus: 'PENDING',
          requestRunId: run.id,
          extra: {
            answerPolicy: {
              allowFreeText: result.type === 'CANDIDATES' ? true : result.allowFreeText,
              freeTextNextStep,
              options: policyOptions,
            },
          },
        },
      });
      return { resultPayload: { type: result.type, messageId: message.id } };
    }
    if (result.type === 'PLAN' || result.type === 'ACTION_PROPOSAL') {
      const proposal = await this.materializeProposal(scope, transaction, run, response);
      return { resultPayload: { type: result.type, proposalId: proposal.id } };
    }
    throw new AgentResultNotImplementedError(String((result as { type?: unknown }).type));
  }

  async materializeProposal(
    scope: TransactionScope,
    transaction: Transaction,
    run: {
      id: string;
      userId: string;
      conversationId: string;
      sourceProposalId: string | null;
      extra: Prisma.JsonValue;
    },
    response: ExecuteResponse,
  ) {
    const result = response.result;
    if (result.type !== 'PLAN' && result.type !== 'ACTION_PROPOSAL') {
      throw new AgentPersistenceInvariantError('Result is not a proposal');
    }
    const normalized =
      result.type === 'PLAN'
        ? await this.normalizePlanResult(scope, transaction, run, result)
        : await this.normalizeActionProposalResult(scope, transaction, run, result);
    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
    const proposal = await transaction.actionProposal.create({
      data: {
        userId: run.userId,
        conversationId: run.conversationId,
        requestRunId: run.id,
        supersedesProposalId: run.sourceProposalId,
        actionCode: normalized.actionCode,
        title: normalized.title,
        status: 'AWAITING_CONFIRMATION',
        summary: normalized.summary,
        modelVersion: response.resolved.model,
        promptVersion: response.resolved.promptVersion,
        toolVersion: response.resolved.providerSchemaVersion,
        expiresAt,
      },
    });
    await transaction.actionMutation.createMany({
      data: normalized.mutations.map((mutation, index) => ({
        userId: run.userId,
        proposalId: proposal.id,
        sequence: index + 1,
        operation: mutation.operation,
        targetType: mutation.targetType,
        targetId: mutation.targetId,
        targetVersion: mutation.targetVersion,
        beforeValue: mutation.beforeValue === null ? Prisma.DbNull : asJson(mutation.beforeValue),
        afterValue: asJson(mutation.afterValue),
        fieldSource: 'AGENT_SUGGESTION' as const,
      })),
    });
    const confirmMessage = await transaction.message.create({
      data: {
        userId: run.userId,
        conversationId: run.conversationId,
        role: 'ASSISTANT',
        messageType: 'ACTION_CONFIRM',
        inputMode: 'SYSTEM',
        content: normalized.summary,
        structuredData: {
          type: 'ACTION_CONFIRM',
          title: normalized.title,
          summary: normalized.summary,
        },
        proposalId: proposal.id,
      },
    });
    void confirmMessage;

    if (run.sourceProposalId) {
      const sourceVersion = this.sourceProposalVersion(run.extra);
      const superseded = await transaction.actionProposal.updateMany({
        where: {
          id: run.sourceProposalId,
          userId: run.userId,
          version: sourceVersion,
          status: { in: ['DRAFT', 'AWAITING_CONFIRMATION', 'FAILED'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (superseded.count !== 1) {
        throw new AgentPersistenceInvariantError('Source proposal changed before redo completed');
      }
    }
    return transaction.actionProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: { mutations: { orderBy: { sequence: 'asc' } } },
    });
  }

  async normalizePlanResult(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    result: PlanResult,
  ) {
    const project = await this.resolvePlanProject(scope, transaction, run, result.project);
    const mutations: NormalizedMutation[] = [];
    if (project.type === 'NEW') {
      mutations.push({
        operation: 'CREATE',
        targetType: 'PROJECT',
        targetId: null,
        targetVersion: null,
        beforeValue: null,
        afterValue: { name: project.name },
      });
    }
    for (const task of result.tasks) {
      mutations.push({
        operation: 'CREATE',
        targetType: 'TASK',
        targetId: null,
        targetVersion: null,
        beforeValue: null,
        afterValue: this.taskDraftAfterValue(task, project),
      });
    }
    return {
      actionCode: 'CREATE_PROJECT_TASKS' as const,
      title: result.title,
      summary: result.title,
      mutations,
    };
  }

  async normalizeActionProposalResult(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    result: ActionProposalResult,
  ) {
    const mutations: NormalizedMutation[] = [];
    for (const mutation of result.mutations) {
      mutations.push(
        ...(await this.normalizeInternalMutation(
          scope,
          transaction,
          run,
          result.actionCode,
          mutation,
        )),
      );
    }
    return {
      actionCode: result.actionCode,
      title: Array.from(result.summary).slice(0, 200).join(''),
      summary: result.summary,
      mutations,
    };
  }

  async normalizeInternalMutation(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    actionCode: ActionProposalResult['actionCode'],
    mutation: InternalActionMutation,
  ): Promise<NormalizedMutation[]> {
    const expectedAction = {
      CREATE_TASK: 'CREATE_TASK',
      CREATE_PROJECT_TASKS: 'CREATE_PROJECT_TASKS',
      ORGANIZE_TASK: 'ORGANIZE_TASKS',
      UPDATE_TASK: 'UPDATE_TASK',
      COMPLETE_TASK: 'COMPLETE_TASK',
      RESTORE_TASK: 'RESTORE_TASK',
      DELETE_TASK: 'DELETE_TASK',
    }[mutation.operation];
    if (actionCode !== expectedAction) {
      throw new AgentPersistenceInvariantError('Action code does not match mutation operation');
    }
    if (mutation.operation === 'CREATE_TASK') {
      const project = await this.resolveTaskProject(scope, transaction, run, mutation.project);
      return [
        {
          operation: 'CREATE',
          targetType: 'TASK',
          targetId: null,
          targetVersion: null,
          beforeValue: null,
          afterValue: this.taskDraftAfterValue(mutation.task, project),
        },
      ];
    }
    if (mutation.operation === 'CREATE_PROJECT_TASKS') {
      const project = await this.resolvePlanProject(scope, transaction, run, mutation.project);
      return [
        ...(project.type === 'NEW'
          ? ([
              {
                operation: 'CREATE',
                targetType: 'PROJECT',
                targetId: null,
                targetVersion: null,
                beforeValue: null,
                afterValue: { name: project.name },
              },
            ] satisfies NormalizedMutation[])
          : []),
        ...mutation.tasks.map(
          (task): NormalizedMutation => ({
            operation: 'CREATE',
            targetType: 'TASK',
            targetId: null,
            targetVersion: null,
            beforeValue: null,
            afterValue: this.taskDraftAfterValue(task, project),
          }),
        ),
      ];
    }
    if (mutation.operation === 'ORGANIZE_TASK') {
      const task = await this.context.requireTaskCandidate(
        scope,
        transaction,
        run,
        mutation.targetRef,
        mutation.expectedVersion,
      );
      const project = await this.context.requireProjectCandidate(
        scope,
        transaction,
        run,
        mutation.projectRef,
      );
      return [
        {
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: task.id,
          targetVersion: task.version,
          beforeValue: this.taskBeforeValue(task),
          afterValue: {
            project: {
              type: 'EXISTING',
              projectId: project.id,
              expectedVersion: project.version,
            },
          },
        },
      ];
    }
    const task = await this.context.requireTaskCandidate(
      scope,
      transaction,
      run,
      mutation.targetRef,
      mutation.expectedVersion,
    );
    if (mutation.operation === 'UPDATE_TASK') {
      return [
        {
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: task.id,
          targetVersion: task.version,
          beforeValue: this.taskBeforeValue(task),
          afterValue: JSON.parse(JSON.stringify(mutation.changes)) as Record<string, unknown>,
        },
      ];
    }
    const transition: Pick<NormalizedMutation, 'operation' | 'afterValue'> =
      mutation.operation === 'COMPLETE_TASK'
        ? { operation: 'COMPLETE', afterValue: { status: 'COMPLETED' } }
        : mutation.operation === 'RESTORE_TASK'
          ? { operation: 'RESTORE', afterValue: { status: 'TODO' } }
          : { operation: 'SOFT_DELETE', afterValue: { deleted: true } };
    return [
      {
        operation: transition.operation,
        targetType: 'TASK',
        targetId: task.id,
        targetVersion: task.version,
        beforeValue: this.taskBeforeValue(task),
        afterValue: transition.afterValue,
      },
    ];
  }

  async resolveTaskProject(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    selection: { type: 'NONE' } | { type: 'EXISTING'; candidateRef: string },
  ): Promise<ResolvedProjectSelection> {
    if (selection.type === 'NONE') return selection;
    const project = await this.context.requireProjectCandidate(
      scope,
      transaction,
      run,
      selection.candidateRef,
    );
    return { type: 'EXISTING', projectId: project.id, expectedVersion: project.version };
  }

  async resolvePlanProject(
    scope: TransactionScope,
    transaction: Transaction,
    run: { id: string; userId: string },
    selection: { type: 'EXISTING'; candidateRef: string } | { type: 'NEW'; name: string },
  ): Promise<Exclude<ResolvedProjectSelection, { type: 'NONE' }>> {
    if (selection.type === 'EXISTING') {
      const project = await this.context.requireProjectCandidate(
        scope,
        transaction,
        run,
        selection.candidateRef,
      );
      return { type: 'EXISTING', projectId: project.id, expectedVersion: project.version };
    }
    const name = selection.name.trim();
    if (name.length === 0 || Array.from(name).length > MAX_PROJECT_NAME_LENGTH) {
      throw new AgentPersistenceInvariantError('Generated project name violates product limits');
    }
    return { type: 'NEW', name };
  }

  taskDraftAfterValue(
    task: {
      clientRef: string;
      title: string;
      description: string | null;
      priority: string;
      scheduledAt: string | null;
      deadlineAt: string | null;
      reminderAt: string | null;
    },
    project: ResolvedProjectSelection,
  ): Record<string, unknown> {
    return {
      clientRef: task.clientRef,
      title: task.title,
      description: task.description,
      priority: task.priority,
      scheduledAt: task.scheduledAt,
      deadlineAt: task.deadlineAt,
      reminderAt: task.reminderAt,
      project,
    };
  }

  taskBeforeValue(task: {
    title: string;
    description: string;
    status: string;
    priority: string;
    projectId: string | null;
    scheduledAt: Date | null;
    deadlineAt: Date | null;
    reminderAt: Date | null;
  }): Record<string, unknown> {
    return {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      projectId: task.projectId,
      scheduledAt: task.scheduledAt?.toISOString() ?? null,
      deadlineAt: task.deadlineAt?.toISOString() ?? null,
      reminderAt: task.reminderAt?.toISOString() ?? null,
    };
  }
}
