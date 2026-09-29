/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
import {
  actionProposalConfirmResponseSchema,
  type ActionProposalConfirmResponse,
} from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionScope, UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { AgentProjectsPort } from '../projects/agent-projects.port.js';
import type { AgentTasksPort } from '../tasks/agent-tasks.port.js';
import type {
  AgentActionExecutionPort,
  ExecutableActionProposal,
} from './agent-action-execution.port.js';
import { ActionTargetVersionConflictError } from './agent-action-execution.port.js';
import { AgentActionExecutor } from './agent-action-executor.js';

const scope = Object.freeze({}) as TransactionScope;
const userId = '00000000-0000-4000-8000-000000000001';
const proposalId = '00000000-0000-4000-8000-000000000002';
const executionId = '00000000-0000-4000-8000-000000000003';
const projectId = '00000000-0000-4000-8000-000000000004';
const projectVersion = 3;
const taskIdA = '00000000-0000-4000-8000-000000000005';
const taskIdB = '00000000-0000-4000-8000-000000000006';

function proposal(overrides: Partial<ExecutableActionProposal> = {}): ExecutableActionProposal {
  return {
    id: proposalId,
    userId,
    actionCode: 'CREATE_PROJECT_TASKS',
    version: 1,
    mutations: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        sequence: 1,
        operation: 'CREATE',
        targetType: 'PROJECT',
        targetId: null,
        targetVersion: null,
        afterValue: { name: '露营' },
      },
      {
        id: '00000000-0000-4000-8000-000000000011',
        sequence: 2,
        operation: 'CREATE',
        targetType: 'TASK',
        targetId: null,
        targetVersion: null,
        afterValue: {
          clientRef: 'draft_0000000000000001',
          title: '准备帐篷',
          description: '',
          priority: 'HIGH',
          scheduledAt: null,
          deadlineAt: null,
          reminderAt: null,
          project: { type: 'NEW', name: '露营' },
        },
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        sequence: 3,
        operation: 'CREATE',
        targetType: 'TASK',
        targetId: null,
        targetVersion: null,
        afterValue: {
          clientRef: 'draft_0000000000000002',
          title: '购买食材',
          description: '',
          priority: 'MEDIUM',
          scheduledAt: null,
          deadlineAt: null,
          reminderAt: null,
          project: { type: 'NEW', name: '露营' },
        },
      },
    ],
    ...overrides,
  };
}

function executedResponse(): ActionProposalConfirmResponse {
  return actionProposalConfirmResponseSchema.parse({
    outcome: 'EXECUTED',
    proposal: {
      id: proposalId,
      conversationId: '00000000-0000-4000-8000-000000000020',
      actionCode: 'CREATE_PROJECT_TASKS',
      presentation: 'PLAN',
      title: '创建露营计划',
      status: 'EXECUTED',
      version: 3,
      mutations: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          sequence: 1,
          operation: 'CREATE',
          targetType: 'PROJECT',
          targetId: null,
          targetVersion: null,
          beforeValue: null,
          afterValue: { name: '露营' },
          fieldSource: 'AGENT_SUGGESTION',
        },
      ],
      lastDismissedAt: null,
      expiresAt: null,
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:01.000Z',
    },
    execution: {
      id: executionId,
      status: 'SUCCEEDED',
      executedAt: '2026-07-17T00:00:01.000Z',
      result: {
        projectId,
        taskIds: [taskIdA, taskIdB],
        undoOperationId: null,
        undoExpiresAt: null,
      },
    },
  });
}

function harness(inputProposal = proposal()) {
  const completeResponse = executedResponse();
  const unitOfWork: UnitOfWork = {
    run: vi.fn((work) => work(scope)),
  };
  const executions: AgentActionExecutionPort = {
    claim: vi.fn(() =>
      Promise.resolve({ kind: 'CLAIMED' as const, executionId, proposal: inputProposal }),
    ),
    complete: vi.fn(() => Promise.resolve(completeResponse)),
    fail: vi.fn(() => Promise.reject(new Error('not expected'))),
  };
  const projects: AgentProjectsPort = {
    findActiveAgentProjectName: vi.fn().mockResolvedValue(null),
    findActiveAgentProject: vi.fn().mockResolvedValue(null),
    listAgentCandidates: vi.fn(() => Promise.resolve([])),
    prepare: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve({ id: projectId })),
  };
  const createdTaskIds = [taskIdA, taskIdB];
  const tasks: AgentTasksPort = {
    getAgentScopeCounts: vi.fn().mockResolvedValue({ todoCount: 0, unprojectedTodoCount: 0 }),
    findAgentTask: vi.fn().mockResolvedValue(null),
    listAgentCandidates: vi.fn(() => Promise.resolve([])),
    prepare: vi.fn(() => Promise.resolve()),
    create: vi.fn(() => Promise.resolve({ id: createdTaskIds.shift()! })),
    update: vi.fn(() => Promise.resolve({ id: taskIdA })),
    complete: vi.fn(() => Promise.resolve({ id: taskIdA })),
    restore: vi.fn(() => Promise.resolve({ id: taskIdA })),
    softDeleteMany: vi.fn(() =>
      Promise.resolve({
        taskIds: [taskIdA],
        undoOperation: {
          id: '00000000-0000-4000-8000-000000000030',
          expiresAt: new Date('2026-07-17T00:00:03.000Z'),
        },
      }),
    ),
  };
  return {
    executor: new AgentActionExecutor(unitOfWork, executions, projects, tasks),
    executions,
    projects,
    tasks,
    completeResponse,
  };
}

describe('AgentActionExecutor', () => {
  it('creates a project and all planned tasks in one transaction without an undo receipt', async () => {
    const test = harness();

    await expect(
      test.executor.confirm({
        userId,
        proposalId,
        proposalVersion: 1,
        idempotencyKey: 'confirm-plan-once',
      }),
    ).resolves.toEqual(test.completeResponse);

    expect(test.projects.prepare).toHaveBeenCalledWith(scope, {
      userId,
      existingProjects: [],
      newProjectNames: ['露营'],
    });
    expect(test.tasks.prepare).toHaveBeenCalledWith(scope, { userId, targets: [] });
    expect(test.projects.create).toHaveBeenCalledOnce();
    expect(test.tasks.create).toHaveBeenCalledTimes(2);
    expect(test.executions.complete).toHaveBeenCalledWith(scope, {
      userId,
      proposalId,
      executionId,
      result: {
        projectId,
        taskIds: [taskIdA, taskIdB],
        undoOperationId: null,
        undoExpiresAt: null,
      },
      executedAt: expect.any(Date),
    });
  });

  it('returns an existing execution without calling task or project ports again', async () => {
    const test = harness();
    vi.mocked(test.executions.claim).mockResolvedValue({
      kind: 'REPLAY',
      response: test.completeResponse,
    });

    await expect(
      test.executor.confirm({
        userId,
        proposalId,
        proposalVersion: 1,
        idempotencyKey: 'confirm-plan-replayed',
      }),
    ).resolves.toEqual(test.completeResponse);

    expect(test.projects.prepare).not.toHaveBeenCalled();
    expect(test.tasks.prepare).not.toHaveBeenCalled();
    expect(test.executions.complete).not.toHaveBeenCalled();
  });

  it('creates exactly one three-second batch undo for a delete proposal', async () => {
    const deletion = proposal({
      actionCode: 'DELETE_TASK',
      mutations: [
        {
          id: '00000000-0000-4000-8000-000000000013',
          sequence: 1,
          operation: 'SOFT_DELETE',
          targetType: 'TASK',
          targetId: taskIdA,
          targetVersion: 4,
          afterValue: { deleted: true },
        },
        {
          id: '00000000-0000-4000-8000-000000000014',
          sequence: 2,
          operation: 'SOFT_DELETE',
          targetType: 'TASK',
          targetId: taskIdB,
          targetVersion: 2,
          afterValue: { deleted: true },
        },
      ],
    });
    const test = harness(deletion);

    await test.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-delete-once',
    });

    expect(test.tasks.softDeleteMany).toHaveBeenCalledOnce();
    expect(test.tasks.softDeleteMany).toHaveBeenCalledWith(scope, {
      userId,
      executionId,
      sourceOperationId: executionId,
      targets: [
        { taskId: taskIdA, version: 4 },
        { taskId: taskIdB, version: 2 },
      ],
    });
  });

  it('supports create, organize, update, complete and restore through the Tasks-owned port', async () => {
    const create = harness(
      proposal({
        actionCode: 'CREATE_TASK',
        mutations: [
          {
            id: '00000000-0000-4000-8000-000000000015',
            sequence: 1,
            operation: 'CREATE',
            targetType: 'TASK',
            targetId: null,
            targetVersion: null,
            afterValue: {
              clientRef: 'draft_0000000000000003',
              title: '单条待办',
              description: null,
              priority: 'MEDIUM',
              scheduledAt: null,
              deadlineAt: null,
              reminderAt: null,
              project: { type: 'NONE' },
            },
          },
        ],
      }),
    );
    await create.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-create-task',
    });
    expect(create.tasks.create).toHaveBeenCalledOnce();

    const organize = harness(
      proposal({
        actionCode: 'ORGANIZE_TASKS',
        mutations: [
          taskUpdateMutation(taskIdA, 4, projectId, 16),
          taskUpdateMutation(taskIdB, 2, projectId, 17),
        ],
      }),
    );
    await organize.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-organize',
    });
    expect(organize.projects.prepare).toHaveBeenCalledWith(scope, {
      userId,
      existingProjects: [{ projectId, version: projectVersion }],
      newProjectNames: [],
    });
    expect(organize.tasks.update).toHaveBeenCalledTimes(2);

    const update = harness(
      proposal({
        actionCode: 'UPDATE_TASK',
        mutations: [
          {
            id: '00000000-0000-4000-8000-000000000018',
            sequence: 1,
            operation: 'UPDATE',
            targetType: 'TASK',
            targetId: taskIdA,
            targetVersion: 4,
            afterValue: { title: '修改后的标题', reminderAt: null },
          },
        ],
      }),
    );
    await update.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-update',
    });
    expect(update.tasks.update).toHaveBeenCalledOnce();

    const complete = harness(
      proposalWithStatusAction('COMPLETE_TASK', 'COMPLETE', 'COMPLETED', 19),
    );
    await complete.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-complete',
    });
    expect(complete.tasks.complete).toHaveBeenCalledOnce();

    const restore = harness(proposalWithStatusAction('RESTORE_TASK', 'RESTORE', 'TODO', 20));
    await restore.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-restore',
    });
    expect(restore.tasks.restore).toHaveBeenCalledOnce();
  });

  it('persists a stable conflict result before applying any mutation', async () => {
    const test = harness(
      proposal({
        actionCode: 'COMPLETE_TASK',
        mutations: [
          {
            id: '00000000-0000-4000-8000-000000000021',
            sequence: 1,
            operation: 'COMPLETE',
            targetType: 'TASK',
            targetId: taskIdA,
            targetVersion: 4,
            afterValue: { status: 'COMPLETED' },
          },
        ],
      }),
    );
    vi.mocked(test.tasks.prepare).mockRejectedValue(new ActionTargetVersionConflictError());
    vi.mocked(test.executions.fail).mockResolvedValue(test.completeResponse);

    await test.executor.confirm({
      userId,
      proposalId,
      proposalVersion: 1,
      idempotencyKey: 'confirm-conflict',
    });

    expect(test.tasks.complete).not.toHaveBeenCalled();
    expect(test.executions.fail).toHaveBeenCalledWith(scope, {
      userId,
      proposalId,
      executionId,
      error: {
        code: 'ACTION_TARGET_VERSION_CONFLICT',
        message: '操作目标已发生变化，请刷新后重试',
      },
      failedAt: expect.any(Date),
    });
  });
});

function taskUpdateMutation(
  taskId: string,
  version: number,
  assignedProjectId: string,
  suffix: number,
) {
  return {
    id: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    sequence: suffix - 15,
    operation: 'UPDATE' as const,
    targetType: 'TASK' as const,
    targetId: taskId,
    targetVersion: version,
    afterValue: {
      project: {
        type: 'EXISTING' as const,
        projectId: assignedProjectId,
        expectedVersion: projectVersion,
      },
    },
  };
}

function proposalWithStatusAction(
  actionCode: 'COMPLETE_TASK' | 'RESTORE_TASK',
  operation: 'COMPLETE' | 'RESTORE',
  status: 'COMPLETED' | 'TODO',
  suffix: number,
): ExecutableActionProposal {
  return proposal({
    actionCode,
    mutations: [
      {
        id: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
        sequence: 1,
        operation,
        targetType: 'TASK',
        targetId: taskIdA,
        targetVersion: 4,
        afterValue: { status },
      },
    ],
  });
}
