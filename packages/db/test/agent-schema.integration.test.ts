import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type DatabaseClient } from '../src/index';

const execFileAsync = promisify(execFile);
const HEX_64 = 'a'.repeat(64);

function candidateRef(): string {
  return `cand_${randomUUID().replaceAll('-', '')}`;
}

async function createQueuedRun(
  db: DatabaseClient,
  userId: string,
  allowedResultTypes: Array<'REPLY' | 'CLARIFICATION' | 'CANDIDATES' | 'PLAN' | 'ACTION_PROPOSAL'> = [
    'REPLY',
  ],
) {
  const unique = randomUUID();
  const endpointCode = `test.endpoint.${unique}`;
  const capabilityCode = `test.capability.${unique}`;
  const conversation = await db.conversationSession.create({
    data: {
      userId,
      initialInput: '测试 Agent 输入',
    },
  });
  const sourceMessage = await db.message.create({
    data: {
      userId,
      conversationId: conversation.id,
      role: 'USER',
      messageType: 'USER_INPUT',
      inputMode: 'TEXT',
      content: '测试 Agent 输入',
      structuredData: { type: 'USER_INPUT', text: '测试 Agent 输入' },
    },
  });
  const capability = await db.aiCapability.create({
    data: {
      capabilityCode,
      endpointCode,
      name: '数据库约束测试能力',
      callsModelApi: true,
      pointsCost: 1,
      costRuleVersion: 'test-v1',
      status: 'ACTIVE',
      effectiveAt: new Date('2026-07-17T00:00:00.000Z'),
      configVersion: 2,
      configHash: HEX_64,
      ruleHash: 'b'.repeat(64),
    },
  });
  const reservationId = randomUUID();
  await db.aiPointTransaction.create({
    data: {
      userId,
      type: 'DEBIT',
      pointsDelta: -1,
      status: 'PENDING',
      requestId: unique,
      idempotencyKey: `reserve:${unique}`,
      reservationId,
      capabilityId: capability.id,
      capabilityCode,
      endpointCode,
      costRuleVersion: 'test-v1',
      reasonCode: 'agent_request_reservation',
      configVersion: 2,
      configHash: HEX_64,
      unitCost: 1,
      reservedAt: new Date('2026-07-17T12:00:00.000Z'),
      reservationExpiresAt: new Date('2026-07-17T12:05:00.000Z'),
    },
  });
  const run = await db.agentRequestRun.create({
    data: {
      userId,
      conversationId: conversation.id,
      sourceMessageId: sourceMessage.id,
      capabilityCode,
      endpointCode,
      contractVersion: '1.0',
      allowedResultTypes,
      idempotencyKey: `run:${unique}`,
      reservationId,
    },
  });

  return { capability, conversation, reservationId, run, sourceMessage };
}

describe('Phase 3 Agent PostgreSQL model', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_agent')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let db: DatabaseClient;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();

    await execFileAsync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    const diff = await execFileAsync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--config',
        'prisma.config.ts',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    // Prisma currently reports T18's two equivalent raw partial-index predicates
    // as remove/add pairs. Agent tables must otherwise have zero physical drift.
    expect(diff.stdout).not.toMatch(
      /conversation_sessions|messages|agent_request|action_proposal|action_mutation|action_execution/i,
    );

    db = createPrismaClient(databaseUrl);
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await startedContainer?.stop();
  });

  it('keeps candidate references tenant-safe and bound to exactly one target kind', async () => {
    const owner = await db.user.create({ data: { aiPoints: 20 } });
    const otherUser = await db.user.create({ data: { aiPoints: 20 } });
    const { run } = await createQueuedRun(db, owner.id);
    const ownerTask = await db.task.create({ data: { userId: owner.id, title: '自己的任务' } });
    const otherTask = await db.task.create({
      data: { userId: otherUser.id, title: '他人的任务' },
    });
    const ownerProject = await db.project.create({
      data: {
        userId: owner.id,
        name: '自己的项目',
        nameNormalized: '自己的项目',
        colorKey: 'pink',
      },
    });

    const ownRef = await db.agentRequestCandidateRef.create({
      data: {
        userId: owner.id,
        requestRunId: run.id,
        candidateRef: candidateRef(),
        kind: 'TASK',
        taskId: ownerTask.id,
        targetVersion: ownerTask.version,
        label: ownerTask.title,
        snapshot: { title: ownerTask.title },
        expiresAt: new Date('2026-07-17T12:05:00.000Z'),
      },
    });
    expect(ownRef.taskId).toBe(ownerTask.id);

    await expect(
      db.agentRequestCandidateRef.create({
        data: {
          userId: owner.id,
          requestRunId: run.id,
          candidateRef: candidateRef(),
          kind: 'TASK',
          taskId: otherTask.id,
          targetVersion: otherTask.version,
          label: otherTask.title,
          snapshot: { title: otherTask.title },
          expiresAt: new Date('2026-07-17T12:05:00.000Z'),
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.agentRequestCandidateRef.create({
        data: {
          userId: owner.id,
          requestRunId: run.id,
          candidateRef: candidateRef(),
          kind: 'TASK',
          projectId: ownerProject.id,
          targetVersion: ownerProject.version,
          label: ownerProject.name,
          snapshot: { name: ownerProject.name },
          expiresAt: new Date('2026-07-17T12:05:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('prevents cross-user reservation binding and cross-user viewed-message cursors', async () => {
    const owner = await db.user.create({ data: { aiPoints: 20 } });
    const otherUser = await db.user.create({ data: { aiPoints: 20 } });
    const ownerContext = await createQueuedRun(db, owner.id);
    const otherContext = await createQueuedRun(db, otherUser.id);

    await expect(
      db.agentRequestRun.create({
        data: {
          userId: owner.id,
          conversationId: ownerContext.conversation.id,
          sourceMessageId: ownerContext.sourceMessage.id,
          capabilityCode: otherContext.run.capabilityCode,
          endpointCode: `${otherContext.run.endpointCode}.cross-user`,
          contractVersion: '1.0',
          allowedResultTypes: ['REPLY'],
          idempotencyKey: `cross-user:${randomUUID()}`,
          reservationId: otherContext.reservationId,
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.conversationSession.update({
        where: { id: ownerContext.conversation.id },
        data: {
          lastViewedMessageId: otherContext.sourceMessage.id,
          lastViewedAt: new Date('2026-07-17T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();

    const sameUserOtherConversation = await db.conversationSession.create({
      data: { userId: owner.id, initialInput: '同用户的另一段会话' },
    });
    const sameUserOtherMessage = await db.message.create({
      data: {
        userId: owner.id,
        conversationId: sameUserOtherConversation.id,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: '另一段会话的消息',
      },
    });
    await expect(
      db.conversationSession.update({
        where: { id: ownerContext.conversation.id },
        data: {
          lastViewedMessageId: sameUserOtherMessage.id,
          lastViewedAt: new Date('2026-07-17T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();

    const viewed = await db.conversationSession.update({
      where: { id: ownerContext.conversation.id },
      data: {
        lastViewedMessageId: ownerContext.sourceMessage.id,
        lastViewedAt: new Date('2026-07-17T12:00:00.000Z'),
      },
    });
    expect(viewed.lastViewedMessageId).toBe(ownerContext.sourceMessage.id);
  });

  it('persists exactly one schema-valid message result per Run', async () => {
    const owner = await db.user.create({ data: { aiPoints: 20 } });
    const context = await createQueuedRun(db, owner.id, ['REPLY']);
    const dispatchAttemptedAt = new Date('2026-07-17T12:00:00.000Z');

    const resultMessage = await db.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          userId: owner.id,
          conversationId: context.conversation.id,
          role: 'ASSISTANT',
          messageType: 'AI_REPLY',
          inputMode: 'SYSTEM',
          content: '这是一个测试回复。',
          structuredData: {
            type: 'AI_REPLY',
            text: '这是一个测试回复。',
            canGeneratePlan: false,
          },
          requestRunId: context.run.id,
        },
      });
      await tx.agentRequestRun.update({
        where: { id: context.run.id },
        data: {
          status: 'RESULT_PERSISTED',
          provider: 'DEEPSEEK',
          model: 'deepseek-v4-flash',
          promptVersion: 'standard-v1',
          schemaVersion: 'provider-v1',
          dispatchAttemptedAt,
          executeTimeoutAt: new Date('2026-07-17T12:00:35.000Z'),
          runDeadlineAt: new Date('2026-07-17T12:00:40.000Z'),
          recoveryEligibleAt: new Date('2026-07-17T12:02:40.000Z'),
          resultType: 'REPLY',
          resultPayload: { type: 'REPLY', messageId: message.id },
          resultHash: 'c'.repeat(64),
          resultPersistedAt: new Date('2026-07-17T12:00:10.000Z'),
        },
      });
      return message;
    });
    expect(resultMessage.requestRunId).toBe(context.run.id);

    await expect(
      db.message.create({
        data: {
          userId: owner.id,
          conversationId: context.conversation.id,
          role: 'ASSISTANT',
          messageType: 'AI_REPLY',
          inputMode: 'SYSTEM',
          content: '重复结果',
          requestRunId: context.run.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.message.create({
        data: {
          userId: owner.id,
          conversationId: context.conversation.id,
          role: 'USER',
          messageType: 'QUESTION',
          inputMode: 'SYSTEM',
          interactionStatus: 'PENDING',
          content: '非法角色问题',
        },
      }),
    ).rejects.toThrow();
  });

  it('enforces formal mutation, confirmation and single-execution invariants', async () => {
    const owner = await db.user.create({ data: { aiPoints: 20 } });
    const otherUser = await db.user.create({ data: { aiPoints: 20 } });
    const { conversation, run } = await createQueuedRun(db, owner.id, ['PLAN']);
    const proposal = await db.actionProposal.create({
      data: {
        userId: owner.id,
        conversationId: conversation.id,
        requestRunId: run.id,
        actionCode: 'CREATE_PROJECT_TASKS',
        title: '创建露营计划',
        summary: '创建一个项目和两项任务',
        status: 'AWAITING_CONFIRMATION',
        modelVersion: 'deepseek-v4-pro',
        promptVersion: 'plan-v1',
        toolVersion: 'actions-v1',
        expiresAt: new Date('2026-07-24T12:00:00.000Z'),
      },
    });

    const mutation = await db.actionMutation.create({
      data: {
        userId: owner.id,
        proposalId: proposal.id,
        sequence: 1,
        operation: 'CREATE',
        targetType: 'PROJECT',
        afterValue: { name: '周末露营' },
        fieldSource: 'AGENT_SUGGESTION',
      },
    });
    expect(mutation.sequence).toBe(1);

    await expect(
      db.actionMutation.create({
        data: {
          userId: owner.id,
          proposalId: proposal.id,
          sequence: 2,
          operation: 'UPDATE',
          targetType: 'TASK',
          afterValue: { priority: 'HIGH' },
          fieldSource: 'USER',
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.actionMutation.create({
        data: {
          userId: otherUser.id,
          proposalId: proposal.id,
          sequence: 3,
          operation: 'CREATE',
          targetType: 'TASK',
          afterValue: { title: '越权任务' },
          fieldSource: 'USER',
        },
      }),
    ).rejects.toThrow();

    await expect(
      db.actionExecution.create({
        data: {
          userId: owner.id,
          proposalId: proposal.id,
          confirmedById: otherUser.id,
          confirmedAt: new Date('2026-07-17T12:00:00.000Z'),
          idempotencyKey: `confirm:${randomUUID()}`,
        },
      }),
    ).rejects.toThrow();

    const execution = await db.actionExecution.create({
      data: {
        userId: owner.id,
        proposalId: proposal.id,
        confirmedById: owner.id,
        confirmedAt: new Date('2026-07-17T12:00:00.000Z'),
        idempotencyKey: `confirm:${randomUUID()}`,
      },
    });
    const succeeded = await db.actionExecution.update({
      where: { id: execution.id },
      data: {
        status: 'SUCCEEDED',
        executedAt: new Date('2026-07-17T12:00:01.000Z'),
        resultSnapshot: { projectId: randomUUID(), taskIds: [] },
      },
    });
    expect(succeeded.status).toBe('SUCCEEDED');

    await expect(
      db.actionExecution.create({
        data: {
          userId: owner.id,
          proposalId: proposal.id,
          confirmedById: owner.id,
          confirmedAt: new Date('2026-07-17T12:00:02.000Z'),
          idempotencyKey: `confirm:${randomUUID()}`,
        },
      }),
    ).rejects.toThrow();
  });
});
