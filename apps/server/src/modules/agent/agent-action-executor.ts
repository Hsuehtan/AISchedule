import type { ActionProposalConfirmResponse } from '@ai-schedule/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  UNIT_OF_WORK,
  type TransactionScope,
  type UnitOfWork,
} from '../../platform/database/unit-of-work.js';
import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { AGENT_PROJECTS_PORT, type AgentProjectsPort } from '../projects/agent-projects.port.js';
import {
  AGENT_TASKS_PORT,
  type AgentTaskChanges,
  type AgentTaskDraft,
  type AgentTasksPort,
  type AgentTaskTarget,
} from '../tasks/agent-tasks.port.js';
import {
  AGENT_ACTION_EXECUTION_PORT,
  ActionProjectNameConflictError,
  ActionTargetNotFoundError,
  ActionTargetVersionConflictError,
  type ActionExecutionFailureCode,
  type ActionExecutionResult,
  type AgentActionExecutionPort,
  type ExecutableActionMutation,
  type ExecutableActionProposal,
} from './agent-action-execution.port.js';

const dateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const projectSelectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }).strict(),
  z
    .object({
      type: z.literal('EXISTING'),
      projectId: z.string().uuid(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('NEW'), name: z.string().trim().min(1).max(40) }).strict(),
]);
const taskDraftSchema = z
  .object({
    clientRef: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    scheduledAt: dateTimeSchema.nullable(),
    deadlineAt: dateTimeSchema.nullable(),
    reminderAt: dateTimeSchema.nullable(),
    project: projectSelectionSchema,
  })
  .strict();
const taskChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2_000).nullable().optional(),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
    scheduledAt: dateTimeSchema.nullable().optional(),
    deadlineAt: dateTimeSchema.nullable().optional(),
    reminderAt: dateTimeSchema.nullable().optional(),
    project: projectSelectionSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Task changes cannot be empty');
const projectDraftSchema = z.object({ name: z.string().trim().min(1).max(40) }).strict();
const completeMarkerSchema = z.object({ status: z.literal('COMPLETED') }).strict();
const restoreMarkerSchema = z.object({ status: z.literal('TODO') }).strict();
const deleteMarkerSchema = z.object({ deleted: z.literal(true) }).strict();

type ProjectSelection = z.infer<typeof projectSelectionSchema>;
type PlannedMutation =
  | Readonly<{ kind: 'CREATE_PROJECT'; mutationId: string; name: string }>
  | Readonly<{
      kind: 'CREATE_TASK';
      mutationId: string;
      draft: Omit<AgentTaskDraft, 'projectId'>;
      project: ProjectSelection;
    }>
  | Readonly<{
      kind: 'UPDATE_TASK';
      mutationId: string;
      taskId: string;
      version: number;
      changes: Omit<AgentTaskChanges, 'projectId'>;
      project?: ProjectSelection | undefined;
    }>
  | Readonly<{ kind: 'COMPLETE_TASK'; mutationId: string; taskId: string; version: number }>
  | Readonly<{ kind: 'RESTORE_TASK'; mutationId: string; taskId: string; version: number }>
  | Readonly<{ kind: 'DELETE_TASK'; mutationId: string; taskId: string; version: number }>;

type PreparedPlan = Readonly<{
  mutations: readonly PlannedMutation[];
  existingProjects: readonly Readonly<{ projectId: string; version: number }>[];
  newProjectNames: readonly string[];
  taskTargets: readonly AgentTaskTarget[];
}>;

export const ACTION_TARGET_NOT_FOUND_MESSAGE = '操作目标不存在或已不可用';
export const ACTION_TARGET_VERSION_CONFLICT_MESSAGE = '操作目标已发生变化，请刷新后重试';
export const ACTION_PROJECT_NAME_CONFLICT_MESSAGE = '已有同名的活跃项目';

@Injectable()
export class AgentActionExecutor {
  private readonly now = () => new Date();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AGENT_ACTION_EXECUTION_PORT)
    private readonly executions: AgentActionExecutionPort,
    @Inject(AGENT_PROJECTS_PORT) private readonly projects: AgentProjectsPort,
    @Inject(AGENT_TASKS_PORT) private readonly tasks: AgentTasksPort,
  ) {}

  async confirm(
    input: Readonly<{
      userId: string;
      proposalId: string;
      proposalVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<ActionProposalConfirmResponse> {
    const outcome = await this.unitOfWork.run(async (scope) => {
      const confirmedAt = this.now();
      const claim = await this.executions.claim(scope, { ...input, confirmedAt });
      if (claim.kind === 'REJECTED') return claim;
      if (claim.kind === 'REPLAY') return { kind: 'RESPONSE' as const, response: claim.response };

      let plan: PreparedPlan;
      try {
        plan = preparePlan(claim.proposal);
        await this.projects.prepare(scope, {
          userId: input.userId,
          existingProjects: plan.existingProjects,
          newProjectNames: plan.newProjectNames,
        });
        await this.tasks.prepare(scope, {
          userId: input.userId,
          targets: plan.taskTargets,
        });
      } catch (error) {
        const failure = actionFailure(error);
        return {
          kind: 'RESPONSE' as const,
          response: await this.executions.fail(scope, {
            userId: input.userId,
            proposalId: input.proposalId,
            executionId: claim.executionId,
            error: failure,
            failedAt: this.now(),
          }),
        };
      }

      // All fallible business checks happen above while target rows and project-name allocation
      // are locked. Do not catch writes below: an unexpected storage failure must abort the whole
      // UnitOfWork instead of committing an execution with a partially applied mutation batch.
      const result = await this.applyPlan(scope, input.userId, claim.executionId, plan);
      return {
        kind: 'RESPONSE' as const,
        response: await this.executions.complete(scope, {
          userId: input.userId,
          proposalId: input.proposalId,
          executionId: claim.executionId,
          result,
          executedAt: this.now(),
        }),
      };
    });
    if (outcome.kind === 'REJECTED') {
      throw new ApiHttpException(409, outcome.error.code, outcome.error.message);
    }
    return outcome.response;
  }

  private async applyPlan(
    scope: TransactionScope,
    userId: string,
    executionId: string,
    plan: PreparedPlan,
  ): Promise<ActionExecutionResult> {
    const projectsByName = new Map<string, string>();
    const taskIds: string[] = [];
    let resultProjectId: string | null = null;

    for (const mutation of plan.mutations) {
      if (mutation.kind !== 'CREATE_PROJECT') continue;
      const project = await this.projects.create(scope, {
        userId,
        name: mutation.name,
        sourceActionId: executionId,
      });
      projectsByName.set(normalizeName(mutation.name), project.id);
      resultProjectId ??= project.id;
    }

    const deletions = plan.mutations.filter(
      (mutation): mutation is Extract<PlannedMutation, { kind: 'DELETE_TASK' }> =>
        mutation.kind === 'DELETE_TASK',
    );

    for (const mutation of plan.mutations) {
      if (mutation.kind === 'CREATE_PROJECT' || mutation.kind === 'DELETE_TASK') continue;
      if (mutation.kind === 'CREATE_TASK') {
        const projectId = resolveProjectId(mutation.project, projectsByName);
        resultProjectId ??= projectId;
        const task = await this.tasks.create(scope, {
          userId,
          sourceActionId: executionId,
          draft: { ...mutation.draft, projectId },
        });
        taskIds.push(task.id);
        continue;
      }
      if (mutation.kind === 'UPDATE_TASK') {
        const projectId = mutation.project
          ? resolveProjectId(mutation.project, projectsByName)
          : undefined;
        const task = await this.tasks.update(scope, {
          userId,
          taskId: mutation.taskId,
          version: mutation.version,
          changes: {
            ...mutation.changes,
            ...(projectId === undefined ? {} : { projectId }),
          },
        });
        taskIds.push(task.id);
        continue;
      }
      const task =
        mutation.kind === 'COMPLETE_TASK'
          ? await this.tasks.complete(scope, {
              userId,
              taskId: mutation.taskId,
              version: mutation.version,
            })
          : await this.tasks.restore(scope, {
              userId,
              taskId: mutation.taskId,
              version: mutation.version,
            });
      taskIds.push(task.id);
    }

    if (deletions.length === 0) {
      return {
        projectId: resultProjectId,
        taskIds,
        undoOperationId: null,
        undoExpiresAt: null,
      };
    }
    const deleted = await this.tasks.softDeleteMany(scope, {
      userId,
      executionId,
      sourceOperationId: executionId,
      targets: deletions.map((mutation) => ({
        taskId: mutation.taskId,
        version: mutation.version,
      })),
    });
    return {
      projectId: resultProjectId,
      taskIds: [...taskIds, ...deleted.taskIds],
      undoOperationId: deleted.undoOperation.id,
      undoExpiresAt: deleted.undoOperation.expiresAt.toISOString(),
    };
  }
}

function preparePlan(proposal: ExecutableActionProposal): PreparedPlan {
  const ordered = [...proposal.mutations].sort((left, right) => left.sequence - right.sequence);
  if (
    ordered.length === 0 ||
    new Set(ordered.map(({ sequence }) => sequence)).size !== ordered.length
  ) {
    throw new InvalidActionProposalError();
  }
  const mutations = ordered.map(parseMutation);
  assertActionShape(proposal.actionCode, mutations);

  const newProjectNames = mutations
    .filter(
      (mutation): mutation is Extract<PlannedMutation, { kind: 'CREATE_PROJECT' }> =>
        mutation.kind === 'CREATE_PROJECT',
    )
    .map(({ name }) => name);
  if (new Set(newProjectNames.map(normalizeName)).size !== newProjectNames.length) {
    throw new InvalidActionProposalError();
  }
  const newNameSet = new Set(newProjectNames.map(normalizeName));
  const selections = mutations.flatMap((mutation) => {
    if (mutation.kind === 'CREATE_TASK') return [mutation.project];
    if (mutation.kind === 'UPDATE_TASK' && mutation.project) return [mutation.project];
    return [];
  });
  for (const selection of selections) {
    if (selection.type === 'NEW' && !newNameSet.has(normalizeName(selection.name))) {
      throw new InvalidActionProposalError();
    }
  }
  const existingProjectVersions = new Map<string, number>();
  for (const selection of selections) {
    if (selection.type !== 'EXISTING') continue;
    const current = existingProjectVersions.get(selection.projectId);
    if (current !== undefined && current !== selection.expectedVersion) {
      throw new InvalidActionProposalError();
    }
    existingProjectVersions.set(selection.projectId, selection.expectedVersion);
  }
  const existingProjects = [...existingProjectVersions]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectId, version]) => ({ projectId, version }));
  const taskTargets = mutations.flatMap((mutation): AgentTaskTarget[] => {
    switch (mutation.kind) {
      case 'UPDATE_TASK':
        return [{ taskId: mutation.taskId, version: mutation.version }];
      case 'COMPLETE_TASK':
        return [{ taskId: mutation.taskId, version: mutation.version, expectedStatus: 'TODO' }];
      case 'RESTORE_TASK':
        return [
          { taskId: mutation.taskId, version: mutation.version, expectedStatus: 'COMPLETED' },
        ];
      case 'DELETE_TASK':
        return [{ taskId: mutation.taskId, version: mutation.version }];
      case 'CREATE_PROJECT':
      case 'CREATE_TASK':
        return [];
    }
  });
  if (new Set(taskTargets.map(({ taskId }) => taskId)).size !== taskTargets.length) {
    throw new InvalidActionProposalError();
  }
  return { mutations, existingProjects, newProjectNames, taskTargets };
}

function parseMutation(mutation: ExecutableActionMutation): PlannedMutation {
  if (mutation.operation === 'CREATE' && mutation.targetType === 'PROJECT') {
    assertCreateTarget(mutation);
    const project = projectDraftSchema.parse(mutation.afterValue);
    return { kind: 'CREATE_PROJECT', mutationId: mutation.id, name: project.name };
  }
  if (mutation.operation === 'CREATE' && mutation.targetType === 'TASK') {
    assertCreateTarget(mutation);
    const draft = taskDraftSchema.parse(mutation.afterValue);
    return {
      kind: 'CREATE_TASK',
      mutationId: mutation.id,
      project: draft.project,
      draft: {
        title: draft.title,
        description: draft.description ?? '',
        priority: draft.priority,
        scheduledAt: draft.scheduledAt,
        deadlineAt: draft.deadlineAt,
        reminderAt: draft.reminderAt,
      },
    };
  }
  const target = requiredTaskTarget(mutation);
  if (mutation.operation === 'UPDATE') {
    const changes = taskChangesSchema.parse(mutation.afterValue);
    const { project, description, ...fields } = changes;
    return {
      kind: 'UPDATE_TASK',
      mutationId: mutation.id,
      ...target,
      changes: {
        ...fields,
        ...(description === undefined ? {} : { description: description ?? '' }),
      },
      ...(project === undefined ? {} : { project }),
    };
  }
  if (mutation.operation === 'COMPLETE') {
    completeMarkerSchema.parse(mutation.afterValue);
    return { kind: 'COMPLETE_TASK', mutationId: mutation.id, ...target };
  }
  if (mutation.operation === 'RESTORE') {
    restoreMarkerSchema.parse(mutation.afterValue);
    return { kind: 'RESTORE_TASK', mutationId: mutation.id, ...target };
  }
  if (mutation.operation === 'SOFT_DELETE') {
    deleteMarkerSchema.parse(mutation.afterValue);
    return { kind: 'DELETE_TASK', mutationId: mutation.id, ...target };
  }
  throw new InvalidActionProposalError();
}

function assertCreateTarget(mutation: ExecutableActionMutation): void {
  if (mutation.targetId !== null || mutation.targetVersion !== null) {
    throw new InvalidActionProposalError();
  }
}

function requiredTaskTarget(
  mutation: ExecutableActionMutation,
): Readonly<{ taskId: string; version: number }> {
  if (
    mutation.targetType !== 'TASK' ||
    mutation.targetId === null ||
    mutation.targetVersion === null
  ) {
    throw new InvalidActionProposalError();
  }
  return { taskId: mutation.targetId, version: mutation.targetVersion };
}

function assertActionShape(
  actionCode: ExecutableActionProposal['actionCode'],
  mutations: readonly PlannedMutation[],
): void {
  const kinds = mutations.map(({ kind }) => kind);
  const taskCreates = mutations.filter(
    (mutation): mutation is Extract<PlannedMutation, { kind: 'CREATE_TASK' }> =>
      mutation.kind === 'CREATE_TASK',
  );
  const projectCreates = mutations.filter(
    (mutation): mutation is Extract<PlannedMutation, { kind: 'CREATE_PROJECT' }> =>
      mutation.kind === 'CREATE_PROJECT',
  );
  const valid = (() => {
    switch (actionCode) {
      case 'CREATE_TASK':
        return (
          kinds.length === 1 && kinds[0] === 'CREATE_TASK' && taskCreates[0]?.project.type !== 'NEW'
        );
      case 'CREATE_PROJECT_TASKS':
        if (
          projectCreates.length > 1 ||
          taskCreates.length < 1 ||
          taskCreates.length > 10 ||
          !kinds.every((kind) => kind === 'CREATE_PROJECT' || kind === 'CREATE_TASK')
        ) {
          return false;
        }
        if (projectCreates[0]) {
          const name = normalizeName(projectCreates[0].name);
          return taskCreates.every(
            ({ project }) => project.type === 'NEW' && normalizeName(project.name) === name,
          );
        }
        return (
          taskCreates.every(({ project }) => project.type === 'EXISTING') &&
          new Set(
            taskCreates.map(({ project }) =>
              project.type === 'EXISTING' ? project.projectId : '',
            ),
          ).size === 1
        );
      case 'ORGANIZE_TASKS':
        return (
          kinds.length <= 20 &&
          mutations.every(
            (mutation) =>
              mutation.kind === 'UPDATE_TASK' &&
              mutation.project?.type === 'EXISTING' &&
              Object.keys(mutation.changes).length === 0,
          )
        );
      case 'UPDATE_TASK':
        return kinds.length === 1 && kinds[0] === 'UPDATE_TASK';
      case 'COMPLETE_TASK':
        return kinds.length >= 1 && kinds.every((kind) => kind === 'COMPLETE_TASK');
      case 'RESTORE_TASK':
        return kinds.length >= 1 && kinds.every((kind) => kind === 'RESTORE_TASK');
      case 'DELETE_TASK':
        return kinds.length >= 1 && kinds.every((kind) => kind === 'DELETE_TASK');
    }
  })();
  if (!valid) throw new InvalidActionProposalError();
}

function resolveProjectId(
  selection: ProjectSelection,
  projectsByName: ReadonlyMap<string, string>,
): string | null {
  if (selection.type === 'NONE') return null;
  if (selection.type === 'EXISTING') return selection.projectId;
  const projectId = projectsByName.get(normalizeName(selection.name));
  if (!projectId) throw new InvalidActionProposalError();
  return projectId;
}

function actionFailure(error: unknown): Readonly<{
  code: ActionExecutionFailureCode;
  message: string;
}> {
  if (error instanceof ActionTargetNotFoundError) {
    return { code: 'ACTION_TARGET_NOT_FOUND', message: ACTION_TARGET_NOT_FOUND_MESSAGE };
  }
  if (error instanceof ActionTargetVersionConflictError) {
    return {
      code: 'ACTION_TARGET_VERSION_CONFLICT',
      message: ACTION_TARGET_VERSION_CONFLICT_MESSAGE,
    };
  }
  if (error instanceof ActionProjectNameConflictError) {
    return {
      code: 'ACTION_PROJECT_NAME_CONFLICT',
      message: ACTION_PROJECT_NAME_CONFLICT_MESSAGE,
    };
  }
  return { code: 'ACTION_EXECUTION_FAILED', message: '操作执行失败，请刷新后重试' };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

class InvalidActionProposalError extends Error {
  constructor() {
    super('The persisted action proposal is invalid');
    this.name = 'InvalidActionProposalError';
  }
}
