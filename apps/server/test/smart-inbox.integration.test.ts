import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { projectIdSchema } from '@ai-schedule/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SmartInboxService } from '../src/modules/agent/smart-inbox.service.js';
import { PrismaAgentProjectsAdapter } from '../src/modules/projects/prisma-agent-projects.adapter.js';
import { PrismaAgentTasksAdapter } from '../src/modules/tasks/prisma-agent-tasks.adapter.js';
import { PrismaSmartInboxReadAdapter } from '../src/platform/agent/prisma-smart-inbox-read.adapter.js';
import { DatabaseService } from '../src/platform/database/database.service.js';
import { DatabaseUnitOfWork } from '../src/platform/database/unit-of-work.js';

const execFileAsync = promisify(execFile);
const now = new Date('2026-07-17T12:00:00.000Z');

describe('Smart Inbox PostgreSQL derivation', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_smart_inbox')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let database: DatabaseService;
  let adapter: PrismaSmartInboxReadAdapter;
  let service: SmartInboxService;

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
    const unitOfWork = new DatabaseUnitOfWork(database);
    adapter = new PrismaSmartInboxReadAdapter(
      database,
      unitOfWork,
      new PrismaAgentTasksAdapter(unitOfWork),
      new PrismaAgentProjectsAdapter(unitOfWork),
    );
    service = new SmartInboxService(adapter, () => now);
  }, 120_000);

  afterAll(async () => {
    await database?.onApplicationShutdown();
    await startedContainer?.stop();
  });

  it('keeps global recovery states tenant-scoped and visible under a project filter', async () => {
    const owner = await database.client.user.create({ data: {} });
    const other = await database.client.user.create({ data: {} });
    const project = await database.client.project.create({
      data: {
        userId: owner.id,
        name: '工作',
        nameNormalized: '工作',
        colorKey: 'CYAN',
      },
    });

    await createAwaitingProposal(other.id, '其他用户的待确认');
    const question = await createPendingQuestion(owner.id, '你希望先处理哪一项？');

    const response = await service.get({
      userId: owner.id,
      query: { projectId: projectIdSchema.parse(project.id) },
    });

    expect(response).toMatchObject({
      item: {
        kind: 'AWAITING_CLARIFICATION',
        body: '你希望先处理哪一项？',
        action: {
          type: 'RESUME_CONVERSATION',
          conversationId: question.conversationId,
          messageId: question.id,
          proposalId: null,
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain('其他用户的待确认');
  });

  it('validates active project ownership while counting only global unprojected TODO candidates', async () => {
    const owner = await database.client.user.create({ data: {} });
    const other = await database.client.user.create({ data: {} });
    const project = await database.client.project.create({
      data: {
        userId: owner.id,
        name: '生活',
        nameNormalized: '生活',
        colorKey: 'TEAL',
      },
    });
    const archived = await database.client.project.create({
      data: {
        userId: owner.id,
        name: '归档',
        nameNormalized: '归档',
        colorKey: 'AMBER',
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
    });
    const foreignProject = await database.client.project.create({
      data: {
        userId: other.id,
        name: '他人项目',
        nameNormalized: '他人项目',
        colorKey: 'ROSE',
      },
    });
    await database.client.task.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        userId: owner.id,
        title: `未归属 ${index + 1}`,
      })),
    });
    await database.client.task.createMany({
      data: [
        { userId: owner.id, projectId: project.id, title: '项目内任务' },
        { userId: owner.id, title: '已完成', status: 'COMPLETED', completedAt: new Date() },
        { userId: owner.id, title: '已删除', deletedAt: new Date() },
        { userId: other.id, title: '其他用户未归属任务' },
      ],
    });

    const scope = await adapter.loadScopeState({
      userId: owner.id,
      scope: { type: 'PROJECT', projectId: projectIdSchema.parse(project.id) },
    });

    expect(scope).toEqual({
      organizeCandidateCount: 20,
      projectName: '生活',
      scope: { type: 'PROJECT', projectId: project.id },
      todoCount: 1,
    });
    await expect(
      adapter.loadScopeState({
        userId: owner.id,
        scope: { type: 'PROJECT', projectId: projectIdSchema.parse(foreignProject.id) },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_NOT_FOUND', status: 404 });
    await expect(
      adapter.loadScopeState({
        userId: owner.id,
        scope: { type: 'PROJECT', projectId: projectIdSchema.parse(archived.id) },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_NOT_FOUND', status: 404 });
  });

  it('stops pinning a failed proposal after the user dismisses it', async () => {
    const owner = await database.client.user.create({ data: {} });
    const proposal = await createFailedProposal(owner.id, '项目已被归档，执行失败');

    await expect(adapter.loadGlobalState({ userId: owner.id, now })).resolves.toMatchObject({
      executionFailed: { proposalId: proposal.id },
    });

    await database.client.actionProposal.update({
      where: { id: proposal.id },
      data: { lastDismissedAt: now, version: { increment: 1 } },
    });

    await expect(adapter.loadGlobalState({ userId: owner.id, now })).resolves.toMatchObject({
      executionFailed: null,
    });
  });

  async function createPendingQuestion(userId: string, text: string) {
    const conversation = await database.client.conversationSession.create({
      data: { userId, initialInput: '需要澄清' },
    });
    const sourceMessage = await database.client.message.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: '需要澄清',
        structuredData: { type: 'USER_INPUT', text: '需要澄清' },
      },
    });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId,
        conversationId: conversation.id,
        sourceMessageId: sourceMessage.id,
        status: 'SUCCEEDED',
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.standard-turn',
        contractVersion: '1.0',
        allowedResultTypes: ['CLARIFICATION'],
        idempotencyKey: randomUUID(),
        resultType: 'CLARIFICATION',
        resultPayload: { type: 'CLARIFICATION' },
        resultHash: 'a'.repeat(64),
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: 'standard-v1',
        schemaVersion: 'agent-output-v1',
        resultPersistedAt: new Date(),
        settledAt: new Date(),
      },
    });
    return database.client.message.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        messageType: 'QUESTION',
        inputMode: 'SYSTEM',
        content: text,
        structuredData: {
          type: 'QUESTION',
          questionKind: 'CLARIFICATION',
          prompt: text,
          options: [
            { id: 'first', label: '第一项' },
            { id: 'second', label: '第二项' },
          ],
          allowFreeText: true,
          nextStep: 'AGENT_STANDARD_TURN',
        },
        interactionStatus: 'PENDING',
        requestRunId: run.id,
      },
    });
  }

  async function createAwaitingProposal(userId: string, summary: string) {
    const conversation = await database.client.conversationSession.create({
      data: { userId, initialInput: summary },
    });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId,
        conversationId: conversation.id,
        status: 'SUCCEEDED',
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.standard-turn',
        contractVersion: '1.0',
        allowedResultTypes: ['ACTION_PROPOSAL'],
        idempotencyKey: randomUUID(),
        resultType: 'ACTION_PROPOSAL',
        resultPayload: { type: 'ACTION_PROPOSAL' },
        resultHash: 'b'.repeat(64),
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: 'standard-v1',
        schemaVersion: 'agent-output-v1',
        resultPersistedAt: new Date(),
        settledAt: new Date(),
      },
    });
    return database.client.actionProposal.create({
      data: {
        userId,
        conversationId: conversation.id,
        requestRunId: run.id,
        status: 'AWAITING_CONFIRMATION',
        actionCode: 'CREATE_TASK',
        title: '待确认',
        summary,
      },
    });
  }

  async function createFailedProposal(userId: string, summary: string) {
    const conversation = await database.client.conversationSession.create({
      data: { userId, initialInput: summary },
    });
    const run = await database.client.agentRequestRun.create({
      data: {
        userId,
        conversationId: conversation.id,
        status: 'SUCCEEDED',
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.standard-turn',
        contractVersion: '1.0',
        allowedResultTypes: ['ACTION_PROPOSAL'],
        idempotencyKey: randomUUID(),
        resultType: 'ACTION_PROPOSAL',
        resultPayload: { type: 'ACTION_PROPOSAL' },
        resultHash: 'c'.repeat(64),
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-flash',
        promptVersion: 'standard-v1',
        schemaVersion: 'agent-output-v1',
        resultPersistedAt: new Date(),
        settledAt: new Date(),
      },
    });
    return database.client.actionProposal.create({
      data: {
        userId,
        conversationId: conversation.id,
        requestRunId: run.id,
        status: 'FAILED',
        actionCode: 'UPDATE_TASK',
        title: '执行失败',
        summary,
      },
    });
  }
});
