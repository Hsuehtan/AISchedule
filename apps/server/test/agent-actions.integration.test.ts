import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { TaskRepository, type Prisma } from '@ai-schedule/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentActionExecutor } from '../src/modules/agent/agent-action-executor.js';
import { PrismaAgentProjectsAdapter } from '../src/modules/projects/prisma-agent-projects.adapter.js';
import { PrismaAgentTasksAdapter } from '../src/modules/tasks/prisma-agent-tasks.adapter.js';
import { PrismaAgentActionExecutionAdapter } from '../src/platform/agent/prisma-agent-action-execution.adapter.js';
import { DatabaseService } from '../src/platform/database/database.service.js';
import { DatabaseUnitOfWork } from '../src/platform/database/unit-of-work.js';

const execFileAsync = promisify(execFile);

describe('Agent proposal confirmation and atomic business writes', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_agent_actions')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let database: DatabaseService;
  let unitOfWork: DatabaseUnitOfWork;
  let executor: AgentActionExecutor;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();
    const dbRoot = resolve(process.cwd(), '../../packages/db');
    await execFileAsync(
      process.execPath,
      [
        resolve(dbRoot, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { cwd: dbRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
    );
    database = new DatabaseService(databaseUrl);
    unitOfWork = new DatabaseUnitOfWork(database);
    executor = new AgentActionExecutor(
      unitOfWork,
      new PrismaAgentActionExecutionAdapter(unitOfWork),
      new PrismaAgentProjectsAdapter(unitOfWork),
      new PrismaAgentTasksAdapter(unitOfWork),
    );
  }, 120_000);

  afterAll(async () => {
    await database?.onApplicationShutdown();
    await startedContainer?.stop();
  });

  it('creates one new project and all planned tasks once across duplicate confirmations', async () => {
    const user = await database.client.user.create({ data: {} });
    const proposal = await seedProposal(user.id, 'CREATE_PROJECT_TASKS', [
      createProjectMutation(1, '露营'),
      createTaskMutation(2, '准备帐篷', { type: 'NEW', name: '露营' }),
      createTaskMutation(3, '购买食材', { type: 'NEW', name: '露营' }),
    ]);

    const first = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'confirm-camping-plan',
    });
    expect(first).toMatchObject({
      outcome: 'EXECUTED',
      proposal: { id: proposal.id, status: 'EXECUTED' },
      execution: {
        status: 'SUCCEEDED',
        result: { undoOperationId: null },
      },
    });
    if (first.outcome !== 'EXECUTED') throw new Error('expected plan execution to succeed');
    expect(first.execution.result.taskIds).toHaveLength(2);
    expect(first.execution.result.projectId).not.toBeNull();

    const replay = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'a-second-network-key-still-replays-the-proposal',
    });
    expect(replay).toEqual(first);
    expect(
      await database.client.actionExecution.count({ where: { proposalId: proposal.id } }),
    ).toBe(1);
    expect(await database.client.project.count({ where: { userId: user.id, name: '露营' } })).toBe(
      1,
    );
    expect(await database.client.task.count({ where: { userId: user.id } })).toBe(2);
    expect(
      await database.client.task.count({
        where: { userId: user.id, source: 'AGENT', sourceActionId: first.execution.id },
      }),
    ).toBe(2);
  });

  it('persists a project-name conflict without creating any planned task', async () => {
    const user = await database.client.user.create({ data: {} });
    await database.client.project.create({
      data: {
        userId: user.id,
        name: '工作',
        nameNormalized: '工作',
        colorKey: 'pink',
      },
    });
    const proposal = await seedProposal(user.id, 'CREATE_PROJECT_TASKS', [
      createProjectMutation(1, '工作'),
      createTaskMutation(2, '不会残留', { type: 'NEW', name: '工作' }),
    ]);

    const result = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'confirm-duplicate-project',
    });

    expect(result).toMatchObject({
      outcome: 'FAILED',
      proposal: { status: 'FAILED' },
      execution: { error: { code: 'ACTION_PROJECT_NAME_CONFLICT' } },
    });
    expect(await database.client.task.count({ where: { userId: user.id } })).toBe(0);
  });

  it('lazily persists proposal expiry without creating an execution', async () => {
    const user = await database.client.user.create({ data: {} });
    const now = Date.now();
    const proposal = await seedProposal(
      user.id,
      'CREATE_TASK',
      [createTaskMutation(1, '已经过期', { type: 'NONE' })],
      {
        createdAt: new Date(now - 8 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(now - 24 * 60 * 60 * 1_000),
      },
    );

    await expect(
      executor.confirm({
        userId: user.id,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        idempotencyKey: 'confirm-expired-proposal',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_EXECUTABLE' });
    const expired = await database.client.actionProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    expect(expired).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect(expired.expiredAt).toBeInstanceOf(Date);
    expect(
      await database.client.actionExecution.count({ where: { proposalId: proposal.id } }),
    ).toBe(0);
  });

  it("hides another user's proposal and never creates an execution for it", async () => {
    const owner = await database.client.user.create({ data: {} });
    const other = await database.client.user.create({ data: {} });
    const proposal = await seedProposal(owner.id, 'CREATE_TASK', [
      createTaskMutation(1, '不可越权创建', { type: 'NONE' }),
    ]);

    await expect(
      executor.confirm({
        userId: other.id,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        idempotencyKey: 'confirm-foreign-proposal',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND' });
    expect(
      await database.client.actionExecution.count({ where: { proposalId: proposal.id } }),
    ).toBe(0);
    expect(await database.client.task.count({ where: { userId: owner.id } })).toBe(0);
    expect(await database.client.task.count({ where: { userId: other.id } })).toBe(0);
  });

  it('blocks confirmation until the originating Run has settled', async () => {
    const user = await database.client.user.create({ data: {} });
    const now = new Date();
    const proposal = await seedProposal(
      user.id,
      'CREATE_TASK',
      [createTaskMutation(1, '结算前不可创建', { type: 'NONE' })],
      {
        createdAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000),
        runStatus: 'SETTLING',
      },
    );

    await expect(
      executor.confirm({
        userId: user.id,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        idempotencyKey: 'confirm-before-points-settlement',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_FOUND', status: 404 });
    expect(
      await database.client.actionExecution.count({ where: { proposalId: proposal.id } }),
    ).toBe(0);
    expect(await database.client.task.count({ where: { userId: user.id } })).toBe(0);
  });

  it('preflights every target so a stale item leaves the whole completion batch untouched', async () => {
    const user = await database.client.user.create({ data: {} });
    const first = await database.client.task.create({ data: { userId: user.id, title: '第一项' } });
    const second = await database.client.task.create({
      data: { userId: user.id, title: '第二项' },
    });
    const proposal = await seedProposal(user.id, 'COMPLETE_TASK', [
      statusMutation(1, 'COMPLETE', first.id, first.version, { status: 'COMPLETED' }),
      statusMutation(2, 'COMPLETE', second.id, second.version + 1, {
        status: 'COMPLETED',
      }),
    ]);

    const result = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'confirm-stale-completion-batch',
    });

    expect(result).toMatchObject({
      outcome: 'FAILED',
      execution: { error: { code: 'ACTION_TARGET_VERSION_CONFLICT' } },
    });
    expect(
      await database.client.task.count({
        where: { id: { in: [first.id, second.id] }, status: 'COMPLETED' },
      }),
    ).toBe(0);
  });

  it('creates one three-second undo receipt for a confirmed multi-task delete', async () => {
    const user = await database.client.user.create({ data: {} });
    const first = await database.client.task.create({ data: { userId: user.id, title: '删除一' } });
    const second = await database.client.task.create({
      data: { userId: user.id, title: '删除二' },
    });
    const proposal = await seedProposal(user.id, 'DELETE_TASK', [
      statusMutation(1, 'SOFT_DELETE', first.id, first.version, { deleted: true }),
      statusMutation(2, 'SOFT_DELETE', second.id, second.version, { deleted: true }),
    ]);

    const result = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'confirm-batch-delete',
    });
    if (result.outcome !== 'EXECUTED') throw new Error('expected delete execution to succeed');
    expect(result.execution.result).toMatchObject({
      taskIds: [first.id, second.id],
    });
    expect(result.execution.result.undoOperationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(result.execution.result.undoExpiresAt ?? '')).not.toBeNaN();
    expect(
      await database.client.undoOperation.count({
        where: { actionExecutionId: result.execution.id, sourceType: 'ACTION_EXECUTION' },
      }),
    ).toBe(1);
    expect(
      await database.client.task.count({
        where: { id: { in: [first.id, second.id] }, deletedAt: { not: null } },
      }),
    ).toBe(2);

    const undoId = result.execution.result.undoOperationId;
    if (!undoId) throw new Error('batch delete did not return an undo operation');
    const restored = await new TaskRepository(database.client).executeDeleteUndo(
      user.id,
      undoId,
      `undo-${randomUUID()}`,
    );
    expect(restored.kind).toBe('executed');
    expect(
      await database.client.task.count({
        where: { id: { in: [first.id, second.id] }, deletedAt: null },
      }),
    ).toBe(2);
  });

  it('executes create, organize, update, complete and restore proposals against current versions', async () => {
    const user = await database.client.user.create({ data: {} });
    const project = await database.client.project.create({
      data: {
        userId: user.id,
        name: '工作',
        nameNormalized: '工作',
        colorKey: 'pink',
      },
    });
    const createProposal = await seedProposal(user.id, 'CREATE_TASK', [
      createTaskMutation(1, 'Agent 创建', { type: 'NONE' }),
    ]);
    const createdResult = await executor.confirm({
      userId: user.id,
      proposalId: createProposal.id,
      proposalVersion: createProposal.version,
      idempotencyKey: 'confirm-create-one',
    });
    if (createdResult.outcome !== 'EXECUTED') throw new Error('expected task creation to succeed');
    const createdId = createdResult.execution.result.taskIds[0];
    if (!createdId) throw new Error('task creation did not return a task ID');

    const created = await database.client.task.findUniqueOrThrow({ where: { id: createdId } });
    const updateProposal = await seedProposal(user.id, 'UPDATE_TASK', [
      updateMutation(1, created.id, created.version, {
        title: 'Agent 已修改',
        project: {
          type: 'EXISTING',
          projectId: project.id,
          expectedVersion: project.version,
        },
      }),
    ]);
    await executor.confirm({
      userId: user.id,
      proposalId: updateProposal.id,
      proposalVersion: updateProposal.version,
      idempotencyKey: 'confirm-update-one',
    });
    const updated = await database.client.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(updated).toMatchObject({ title: 'Agent 已修改', projectId: project.id, version: 2 });

    const unassigned = await database.client.task.create({
      data: { userId: user.id, title: '待整理' },
    });
    const organizeProposal = await seedProposal(user.id, 'ORGANIZE_TASKS', [
      updateMutation(1, unassigned.id, unassigned.version, {
        project: {
          type: 'EXISTING',
          projectId: project.id,
          expectedVersion: project.version,
        },
      }),
    ]);
    await executor.confirm({
      userId: user.id,
      proposalId: organizeProposal.id,
      proposalVersion: organizeProposal.version,
      idempotencyKey: 'confirm-organize-one',
    });
    expect(
      await database.client.task.findUniqueOrThrow({ where: { id: unassigned.id } }),
    ).toMatchObject({ projectId: project.id, version: 2 });

    const completeProposal = await seedProposal(user.id, 'COMPLETE_TASK', [
      statusMutation(1, 'COMPLETE', updated.id, updated.version, { status: 'COMPLETED' }),
    ]);
    await executor.confirm({
      userId: user.id,
      proposalId: completeProposal.id,
      proposalVersion: completeProposal.version,
      idempotencyKey: 'confirm-complete-one',
    });
    const completed = await database.client.task.findUniqueOrThrow({ where: { id: updated.id } });
    expect(completed).toMatchObject({ status: 'COMPLETED', version: 3 });

    const restoreProposal = await seedProposal(user.id, 'RESTORE_TASK', [
      statusMutation(1, 'RESTORE', completed.id, completed.version, { status: 'TODO' }),
    ]);
    await executor.confirm({
      userId: user.id,
      proposalId: restoreProposal.id,
      proposalVersion: restoreProposal.version,
      idempotencyKey: 'confirm-restore-one',
    });
    expect(
      await database.client.task.findUniqueOrThrow({ where: { id: completed.id } }),
    ).toMatchObject({ status: 'TODO', completedAt: null, version: 4 });
  });

  it('rejects an old proposal after its selected project is renamed', async () => {
    const user = await database.client.user.create({ data: {} });
    const project = await database.client.project.create({
      data: {
        userId: user.id,
        name: '旧项目名',
        nameNormalized: '旧项目名',
        colorKey: 'pink',
      },
    });
    const proposal = await seedProposal(user.id, 'CREATE_TASK', [
      createTaskMutation(1, '不得写入已变化的项目', {
        type: 'EXISTING',
        projectId: project.id,
        expectedVersion: project.version,
      }),
    ]);
    await database.client.project.update({
      where: { id: project.id },
      data: { name: '新项目名', nameNormalized: '新项目名', version: { increment: 1 } },
    });

    const result = await executor.confirm({
      userId: user.id,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      idempotencyKey: 'confirm-stale-project-version',
    });

    expect(result).toMatchObject({
      outcome: 'FAILED',
      proposal: { status: 'FAILED' },
      execution: { error: { code: 'ACTION_TARGET_VERSION_CONFLICT' } },
    });
    expect(await database.client.task.count({ where: { userId: user.id } })).toBe(0);
  });

  async function seedProposal(
    userId: string,
    actionCode:
      | 'COMPLETE_TASK'
      | 'CREATE_PROJECT_TASKS'
      | 'CREATE_TASK'
      | 'DELETE_TASK'
      | 'ORGANIZE_TASKS'
      | 'RESTORE_TASK'
      | 'UPDATE_TASK',
    mutations: readonly MutationSeed[],
    timing?: Readonly<{
      createdAt: Date;
      expiresAt: Date;
      runStatus?: 'RESULT_PERSISTED' | 'SETTLING' | 'SUCCEEDED';
    }>,
  ) {
    const conversation = await database.client.conversationSession.create({ data: { userId } });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId,
        conversationId: conversation.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turns',
        contractVersion: '1.0',
        allowedResultTypes: ['ACTION_PROPOSAL'],
        idempotencyKey: `run-${randomUUID()}`,
        status: timing?.runStatus ?? 'SUCCEEDED',
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: 'standard-v1',
        schemaVersion: 'agent-output-v1',
        resultType: 'ACTION_PROPOSAL',
        resultPayload: { type: 'ACTION_PROPOSAL' },
        resultHash: 'a'.repeat(64),
        resultPersistedAt: new Date(),
        ...(timing?.runStatus === 'RESULT_PERSISTED' || timing?.runStatus === 'SETTLING'
          ? {}
          : { settledAt: new Date() }),
      },
    });
    return database.client.actionProposal.create({
      data: {
        userId,
        conversationId: conversation.id,
        requestRunId: run.id,
        actionCode,
        title: `执行 ${actionCode}`,
        status: 'AWAITING_CONFIRMATION',
        summary: `执行 ${actionCode}`,
        ...(timing
          ? { createdAt: timing.createdAt, expiresAt: timing.expiresAt }
          : { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) }),
        mutations: {
          create: mutations.map((mutation) => ({
            sequence: mutation.sequence,
            operation: mutation.operation,
            targetType: mutation.targetType,
            targetId: mutation.targetId,
            targetVersion: mutation.targetVersion,
            ...(mutation.beforeValue === null
              ? {}
              : { beforeValue: mutation.beforeValue as Prisma.InputJsonValue }),
            afterValue: mutation.afterValue as Prisma.InputJsonValue,
            fieldSource: 'AGENT_SUGGESTION',
          })),
        },
      },
    });
  }
});

type MutationSeed = Readonly<{
  sequence: number;
  operation: 'COMPLETE' | 'CREATE' | 'RESTORE' | 'SOFT_DELETE' | 'UPDATE';
  targetType: 'PROJECT' | 'TASK';
  targetId: string | null;
  targetVersion: number | null;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown>;
}>;

function createProjectMutation(sequence: number, name: string): MutationSeed {
  return {
    sequence,
    operation: 'CREATE',
    targetType: 'PROJECT',
    targetId: null,
    targetVersion: null,
    beforeValue: null,
    afterValue: { name },
  };
}

function createTaskMutation(
  sequence: number,
  title: string,
  project:
    | Readonly<{ type: 'EXISTING'; projectId: string; expectedVersion: number }>
    | Readonly<{ type: 'NEW'; name: string }>
    | Readonly<{ type: 'NONE' }>,
): MutationSeed {
  return {
    sequence,
    operation: 'CREATE',
    targetType: 'TASK',
    targetId: null,
    targetVersion: null,
    beforeValue: null,
    afterValue: {
      clientRef: `draft_${String(sequence).padStart(16, '0')}`,
      title,
      description: '',
      priority: 'MEDIUM',
      scheduledAt: null,
      deadlineAt: null,
      reminderAt: null,
      project,
    },
  };
}

function statusMutation(
  sequence: number,
  operation: 'COMPLETE' | 'RESTORE' | 'SOFT_DELETE',
  taskId: string,
  version: number,
  afterValue: Record<string, unknown>,
): MutationSeed {
  return {
    sequence,
    operation,
    targetType: 'TASK',
    targetId: taskId,
    targetVersion: version,
    beforeValue: { id: taskId, version },
    afterValue,
  };
}

function updateMutation(
  sequence: number,
  taskId: string,
  version: number,
  afterValue: Record<string, unknown>,
): MutationSeed {
  return {
    sequence,
    operation: 'UPDATE',
    targetType: 'TASK',
    targetId: taskId,
    targetVersion: version,
    beforeValue: { id: taskId, version },
    afterValue,
  };
}
