/* eslint-disable @typescript-eslint/unbound-method */
import { projectIdSchema } from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProjectsPort } from '../../modules/projects/agent-projects.port.js';
import type { AgentTasksPort } from '../../modules/tasks/agent-tasks.port.js';
import type { DatabaseService } from '../database/database.service.js';
import type { TransactionScope, TransactionWork, UnitOfWork } from '../database/unit-of-work.js';
import { PrismaSmartInboxReadAdapter } from './prisma-smart-inbox-read.adapter.js';

const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a60';
const projectId = projectIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a68');
const now = new Date('2026-07-17T12:00:00.000Z');

function setup() {
  const client = {
    $queryRaw: vi.fn<unknown[], Promise<unknown[]>>(),
    actionProposal: { findFirst: vi.fn<[unknown], Promise<unknown>>() },
    agentRequestRun: { findFirst: vi.fn<[unknown], Promise<unknown>>() },
    message: { findFirst: vi.fn<[unknown], Promise<unknown>>() },
  };
  const scope = Object.freeze({}) as TransactionScope;
  const unitOfWork: UnitOfWork = {
    run: vi.fn(<T>(work: TransactionWork<T>) => work(scope)),
  };
  const tasks = {
    getAgentScopeCounts: vi.fn(),
  } as unknown as AgentTasksPort;
  const projects = {
    findActiveAgentProjectName: vi.fn(),
  } as unknown as AgentProjectsPort;
  const adapter = new PrismaSmartInboxReadAdapter(
    { client } as unknown as DatabaseService,
    unitOfWork,
    tasks,
    projects,
  );
  return { adapter, client, projects, tasks };
}

describe('PrismaSmartInboxReadAdapter', () => {
  it('validates an active owned project and caps global unprojected candidates at 20', async () => {
    const { adapter, projects, tasks } = setup();
    vi.mocked(projects.findActiveAgentProjectName).mockResolvedValue('工作');
    vi.mocked(tasks.getAgentScopeCounts).mockResolvedValue({
      todoCount: 4,
      unprojectedTodoCount: 27,
    });

    await expect(
      adapter.loadScopeState({ userId, scope: { type: 'PROJECT', projectId } }),
    ).resolves.toEqual({
      organizeCandidateCount: 20,
      projectName: '工作',
      scope: { type: 'PROJECT', projectId },
      todoCount: 4,
    });
    expect(projects.findActiveAgentProjectName).toHaveBeenCalledWith(expect.anything(), {
      projectId,
      userId,
    });
    expect(tasks.getAgentScopeCounts).toHaveBeenCalledWith(expect.anything(), {
      projectId,
      userId,
    });
  });

  it('rejects a foreign or archived project before reading any task counts', async () => {
    const { adapter, projects, tasks } = setup();
    vi.mocked(projects.findActiveAgentProjectName).mockResolvedValue(null);

    await expect(
      adapter.loadScopeState({ userId, scope: { type: 'PROJECT', projectId } }),
    ).rejects.toMatchObject({ code: 'AGENT_REQUEST_NOT_FOUND', status: 404 });
    expect(tasks.getAgentScopeCounts).not.toHaveBeenCalled();
  });

  it('loads only settled recoverable states and ignores a viewed reply', async () => {
    const { adapter, client } = setup();
    const questionUpdatedAt = new Date('2026-07-17T11:00:00.000Z');
    client.actionProposal.findFirst.mockResolvedValue(null);
    client.message.findFirst.mockResolvedValue({
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
      conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
      content: '请补充具体时间',
      updatedAt: questionUpdatedAt,
    });
    client.agentRequestRun.findFirst.mockResolvedValue(null);
    client.$queryRaw.mockResolvedValue([]);

    const state = await adapter.loadGlobalState({ userId, now });

    expect(state.awaitingClarification).toMatchObject({
      body: '请补充具体时间',
      messageId: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
    });
    expect(state.unreadReply).toBeNull();
    const messageQuery = client.message.findFirst.mock.calls[0]?.[0];
    const proposalQuery = client.actionProposal.findFirst.mock.calls[0]?.[0];
    const failedProposalQuery = client.actionProposal.findFirst.mock.calls[1]?.[0];
    expect(messageQuery).toMatchObject({
      where: {
        userId,
        requestRun: { is: { status: 'SUCCEEDED' } },
      },
    });
    expect(proposalQuery).toMatchObject({
      where: {
        userId,
        status: 'AWAITING_CONFIRMATION',
        requestRun: { status: 'SUCCEEDED' },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    expect(failedProposalQuery).toMatchObject({
      where: {
        userId,
        lastDismissedAt: null,
        requestRun: { status: 'SUCCEEDED' },
        status: 'FAILED',
      },
    });
    expect(failedProposalQuery).not.toHaveProperty('where.OR');
  });
});
