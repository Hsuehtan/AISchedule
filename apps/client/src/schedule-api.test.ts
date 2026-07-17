import { describe, expect, it, vi } from 'vitest';

import { ApiClient, type ApiTransport } from './api-client';
import { ScheduleApi } from './schedule-api';

describe('ScheduleApi', () => {
  it('unwraps the authenticated user envelope returned by GET /users/me', async () => {
    const user = {
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
      locale: 'zh-CN',
      nickname: '用户',
      phone: null,
      phoneVerified: false,
      timezone: 'Asia/Shanghai',
      username: '小明_01',
    };
    const transport: ApiTransport = vi.fn().mockResolvedValue({ data: { user }, status: 200 });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await expect(api.me()).resolves.toEqual(user);
  });

  it('forwards the form intent key through a project write', async () => {
    const project = {
      id: '018f31f2-7c27-7587-85f0-a62f4cc8e5c2',
      userId: '018f31f2-5be2-7d12-8ad8-0bb1830f92d4',
      name: '工作',
      colorKey: 'pink',
      status: 'ACTIVE',
      archivedAt: null,
      taskCount: 0,
      version: 1,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const transport: ApiTransport = vi.fn().mockResolvedValue({ data: { project }, status: 201 });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.createProject({ name: '工作' }, 'intent_project_create_1');

    expect(vi.mocked(transport).mock.calls[0]?.[0].headers['Idempotency-Key']).toBe(
      'intent_project_create_1',
    );
  });

  it('starts text and plan Agent requests with validated bodies and stable intent keys', async () => {
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const messageId = '018f47be-1972-7d58-9d67-4ddc5eb78a65';
    const transport: ApiTransport = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          requestId: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
          conversationId,
          status: 'QUEUED',
          pollAfterMs: 1_000,
        },
        status: 202,
      })
      .mockResolvedValueOnce({
        data: {
          requestId: '018f47be-1972-7d58-9d67-4ddc5eb78a66',
          conversationId,
          status: 'QUEUED',
          pollAfterMs: 1_000,
        },
        status: 202,
      });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.createAgentTurn(
      { conversationId, input: { mode: 'TEXT', text: '帮我规划一次露营' } },
      'intent_agent_turn_1',
    );
    await api.createPlanGeneration(
      { source: { type: 'MESSAGE', messageId, version: 2 } },
      'intent_agent_plan_1',
    );

    expect(vi.mocked(transport).mock.calls[0]?.[0]).toMatchObject({
      body: { conversationId, input: { mode: 'TEXT', text: '帮我规划一次露营' } },
      headers: { 'Idempotency-Key': 'intent_agent_turn_1' },
      method: 'POST',
      url: '/api/v1/agent/turns',
    });
    expect(vi.mocked(transport).mock.calls[1]?.[0]).toMatchObject({
      body: { source: { type: 'MESSAGE', messageId, version: 2 } },
      headers: { 'Idempotency-Key': 'intent_agent_plan_1' },
      method: 'POST',
      url: '/api/v1/agent/plan-generations',
    });
  });

  it('polls Agent requests and constructs bounded conversation pagination queries', async () => {
    const requestId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const cursor = '018f47be-1972-7d58-9d67-4ddc5eb78a65';
    const transport: ApiTransport = vi
      .fn()
      .mockResolvedValueOnce({
        data: { requestId, conversationId, status: 'RUNNING', pollAfterMs: 2_000 },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { items: [], pageInfo: { nextCursor: null } },
        status: 200,
      });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.getAgentRequest(requestId);
    await api.listConversationMessages(conversationId, { cursor, limit: 20 });

    expect(vi.mocked(transport).mock.calls[0]?.[0].url).toBe(`/api/v1/agent/requests/${requestId}`);
    expect(vi.mocked(transport).mock.calls[1]?.[0].url).toBe(
      `/api/v1/conversations/${conversationId}/messages?cursor=${cursor}&limit=20`,
    );
  });

  it('records viewed messages and submits versioned answers as idempotent writes', async () => {
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const messageId = '018f47be-1972-7d58-9d67-4ddc5eb78a65';
    const requestId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
    const transport: ApiTransport = vi
      .fn()
      .mockResolvedValueOnce({
        data: { lastViewedMessageId: messageId, viewedAt: '2026-07-17T12:00:00.000Z' },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          outcome: 'QUEUED',
          request: { requestId, conversationId, status: 'QUEUED', pollAfterMs: 1_000 },
        },
        status: 202,
      });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.markConversationViewed(
      conversationId,
      { lastViewedMessageId: messageId },
      'intent_agent_viewed_1',
    );
    await api.answerConversationMessage(
      conversationId,
      messageId,
      { version: 2, answer: { type: 'OPTION', optionId: 'tomorrow' } },
      'intent_agent_answer_1',
    );

    expect(vi.mocked(transport).mock.calls[0]?.[0]).toMatchObject({
      body: { lastViewedMessageId: messageId },
      headers: { 'Idempotency-Key': 'intent_agent_viewed_1' },
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/viewed`,
    });
    expect(vi.mocked(transport).mock.calls[1]?.[0]).toMatchObject({
      body: { version: 2, answer: { type: 'OPTION', optionId: 'tomorrow' } },
      headers: { 'Idempotency-Key': 'intent_agent_answer_1' },
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages/${messageId}/answers`,
    });
  });

  it('routes proposal edit, dismiss, cancel and confirm through versioned strict contracts', async () => {
    const proposalId = '018f47be-1972-7d58-9d67-4ddc5eb78a66';
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const mutationId = '018f47be-1972-7d58-9d67-4ddc5eb78a67';
    const now = '2026-07-17T12:00:00.000Z';
    const proposal = {
      id: proposalId,
      conversationId,
      actionCode: 'CREATE_TASK',
      title: '创建露营待办',
      status: 'AWAITING_CONFIRMATION',
      version: 2,
      mutations: [
        {
          id: mutationId,
          sequence: 1,
          operation: 'CREATE',
          targetType: 'TASK',
          targetId: null,
          targetVersion: null,
          beforeValue: null,
          afterValue: { title: '购买帐篷' },
          fieldSource: 'AGENT_SUGGESTION',
        },
      ],
      lastDismissedAt: null,
      expiresAt: '2026-07-24T12:00:00.000Z',
      createdAt: now,
      updatedAt: now,
    };
    const transport: ApiTransport = vi
      .fn()
      .mockResolvedValueOnce({ data: { proposal }, status: 200 })
      .mockResolvedValueOnce({ data: { proposal }, status: 200 })
      .mockResolvedValueOnce({
        data: { proposal: { ...proposal, lastDismissedAt: now, version: 3 } },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { proposal: { ...proposal, status: 'CANCELLED', version: 3 } },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          outcome: 'EXECUTED',
          proposal: { ...proposal, status: 'EXECUTED', version: 3 },
          execution: {
            id: '018f47be-1972-7d58-9d67-4ddc5eb78a68',
            status: 'SUCCEEDED',
            executedAt: now,
            result: {
              projectId: null,
              taskIds: ['018f47be-1972-7d58-9d67-4ddc5eb78a69'],
              undoOperationId: null,
              undoExpiresAt: null,
            },
          },
        },
        status: 200,
      });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.getActionProposal(proposalId);
    await api.editActionProposal(
      proposalId,
      { version: 1, command: { type: 'REMOVE_MUTATION', mutationId } },
      'intent_proposal_edit_1',
    );
    await api.dismissActionProposal(proposalId, { version: 2 }, 'intent_proposal_dismiss_1');
    await api.cancelActionProposal(proposalId, { version: 2 }, 'intent_proposal_cancel_1');
    await api.confirmActionProposal(proposalId, { version: 2 }, 'intent_proposal_confirm_1');

    expect(
      vi.mocked(transport).mock.calls.map(([request]) => [request.method, request.url]),
    ).toEqual([
      ['GET', `/api/v1/action-proposals/${proposalId}`],
      ['PATCH', `/api/v1/action-proposals/${proposalId}`],
      ['POST', `/api/v1/action-proposals/${proposalId}/dismiss`],
      ['POST', `/api/v1/action-proposals/${proposalId}/cancel`],
      ['POST', `/api/v1/action-proposals/${proposalId}/confirm`],
    ]);
    expect(
      vi
        .mocked(transport)
        .mock.calls.slice(1)
        .map(([request]) => request.headers['Idempotency-Key']),
    ).toEqual([
      'intent_proposal_edit_1',
      'intent_proposal_dismiss_1',
      'intent_proposal_cancel_1',
      'intent_proposal_confirm_1',
    ]);
  });

  it('reads scoped Smart Inbox state and starts organization without trusting task ids', async () => {
    const projectId = '018f47be-1972-7d58-9d67-4ddc5eb78a68';
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const transport: ApiTransport = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          item: {
            kind: 'ORGANIZE_TASKS',
            title: '发现 2 个无项目待办',
            body: '可以为它们建议项目归属',
            action: { type: 'ORGANIZE_TASKS', scope: { type: 'ALL' } },
          },
        },
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          requestId: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
          conversationId,
          status: 'QUEUED',
          pollAfterMs: 1_000,
        },
        status: 202,
      });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    await api.getSmartInbox({ projectId });
    await api.organizeSmartInbox({ scope: { type: 'ALL' } }, 'intent_inbox_organize_1');

    expect(vi.mocked(transport).mock.calls[0]?.[0].url).toBe(
      `/api/v1/smart-inbox?projectId=${projectId}`,
    );
    expect(vi.mocked(transport).mock.calls[1]?.[0]).toMatchObject({
      body: { scope: { type: 'ALL' } },
      headers: { 'Idempotency-Key': 'intent_inbox_organize_1' },
      method: 'POST',
      url: '/api/v1/smart-inbox/organize',
    });
  });

  it('rejects invalid Agent inputs before transport and untrusted response fields after transport', async () => {
    const requestId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
    const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
    const transport: ApiTransport = vi.fn().mockResolvedValue({
      data: {
        requestId,
        conversationId,
        status: 'RUNNING',
        pollAfterMs: 2_000,
        provider: 'deepseek',
      },
      status: 200,
    });
    const api = new ScheduleApi(new ApiClient({ baseUrl: '/api/v1', transport }));

    expect(() =>
      api.createAgentTurn({ input: { mode: 'TEXT', text: '' } }, 'intent_agent_invalid_1'),
    ).toThrow();
    expect(() => api.getAgentRequest('../escape')).toThrow();
    expect(() => api.organizeSmartInbox({ scope: { type: 'ALL' } }, '   ')).toThrow();
    expect(transport).not.toHaveBeenCalled();

    await expect(api.getAgentRequest(requestId)).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });
});
