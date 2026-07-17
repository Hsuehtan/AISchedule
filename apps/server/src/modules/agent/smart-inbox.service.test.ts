/* eslint-disable @typescript-eslint/unbound-method */
import {
  projectIdSchema,
  smartInboxResponseSchema,
  type SmartInboxScope,
} from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import type {
  SmartInboxGlobalState,
  SmartInboxReadPort,
  SmartInboxResumeTarget,
  SmartInboxScopeState,
} from './smart-inbox.port.js';
import { SmartInboxService } from './smart-inbox.service.js';

const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a60';
const projectId = projectIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a68');
const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
const messageId = '018f47be-1972-7d58-9d67-4ddc5eb78a62';
const proposalId = '018f47be-1972-7d58-9d67-4ddc5eb78a61';
const requestId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
const now = new Date('2026-07-17T12:00:00.000Z');

const emptyGlobalState: SmartInboxGlobalState = {
  awaitingConfirmation: null,
  awaitingClarification: null,
  processing: null,
  executionFailed: null,
  unreadReply: null,
};

function resume(overrides: Partial<SmartInboxResumeTarget> = {}): SmartInboxResumeTarget {
  return {
    body: '保留已有上下文',
    conversationId,
    messageId,
    occurredAt: now,
    proposalId,
    requestId,
    title: '继续处理',
    ...overrides,
  };
}

function setup(input?: {
  globalState?: SmartInboxGlobalState;
  scopeState?: Partial<SmartInboxScopeState>;
}) {
  const readPort: SmartInboxReadPort = {
    loadGlobalState: vi.fn().mockResolvedValue(input?.globalState ?? emptyGlobalState),
    loadScopeState: vi.fn().mockImplementation(({ scope }: { scope: SmartInboxScope }) =>
      Promise.resolve({
        organizeCandidateCount: 0,
        projectName: scope.type === 'PROJECT' ? '工作' : null,
        scope,
        todoCount: 3,
        ...input?.scopeState,
      }),
    ),
  };
  return { readPort, service: new SmartInboxService(readPort, () => now) };
}

describe('SmartInboxService', () => {
  it('always gives awaiting confirmation precedence when every global state is present', async () => {
    const { service } = setup({
      globalState: {
        awaitingConfirmation: resume({
          title: '最高优先级',
          messageId: null,
          requestId: null,
        }),
        awaitingClarification: resume({ proposalId: null, requestId: null }),
        processing: resume({ messageId: null, proposalId: null }),
        executionFailed: resume({ messageId: null, requestId: null }),
        unreadReply: resume({ proposalId: null, requestId: null }),
      },
    });

    await expect(service.get({ userId, query: {} })).resolves.toMatchObject({
      item: { kind: 'AWAITING_CONFIRMATION', title: '最高优先级' },
    });
  });

  it.each([
    [
      'AWAITING_CONFIRMATION',
      { awaitingConfirmation: resume({ messageId: null, requestId: null }) },
    ],
    [
      'AWAITING_CLARIFICATION',
      {
        awaitingConfirmation: null,
        awaitingClarification: resume({ proposalId: null, requestId: null }),
      },
    ],
    [
      'PROCESSING',
      {
        awaitingConfirmation: null,
        awaitingClarification: null,
        processing: resume({ messageId: null, proposalId: null }),
      },
    ],
    [
      'EXECUTION_FAILED',
      {
        awaitingConfirmation: null,
        awaitingClarification: null,
        processing: null,
        executionFailed: resume({ messageId: null, requestId: null }),
      },
    ],
    [
      'UNREAD_REPLY',
      {
        awaitingConfirmation: null,
        awaitingClarification: null,
        processing: null,
        executionFailed: null,
        unreadReply: resume({ proposalId: null, requestId: null }),
      },
    ],
  ] as const)(
    'selects %s using the fixed global priority regardless of project filter',
    async (expectedKind, overrides) => {
      const { readPort, service } = setup({
        globalState: { ...emptyGlobalState, ...overrides },
      });

      const response = await service.get({ userId, query: { projectId } });

      expect(response.item.kind).toBe(expectedKind);
      expect(response.item.action).toMatchObject({
        type: 'RESUME_CONVERSATION',
        conversationId,
      });
      expect(readPort.loadGlobalState).toHaveBeenCalledWith({ now, userId });
      expect(readPort.loadScopeState).toHaveBeenCalledWith({
        userId,
        scope: { type: 'PROJECT', projectId },
      });
      expect(() => smartInboxResponseSchema.parse(response)).not.toThrow();
    },
  );

  it.each([
    [
      'AWAITING_CLARIFICATION',
      {
        awaitingClarification: resume({ proposalId: null, requestId: null }),
        processing: resume({ messageId: null, proposalId: null }),
        executionFailed: resume({ messageId: null, requestId: null }),
        unreadReply: resume({ proposalId: null, requestId: null }),
      },
    ],
    [
      'PROCESSING',
      {
        processing: resume({ messageId: null, proposalId: null }),
        executionFailed: resume({ messageId: null, requestId: null }),
        unreadReply: resume({ proposalId: null, requestId: null }),
      },
    ],
    [
      'EXECUTION_FAILED',
      {
        executionFailed: resume({ messageId: null, requestId: null }),
        unreadReply: resume({ proposalId: null, requestId: null }),
      },
    ],
  ] as const)('keeps %s ahead of every lower global state', async (expectedKind, overrides) => {
    const { service } = setup({ globalState: { ...emptyGlobalState, ...overrides } });

    await expect(service.get({ userId, query: {} })).resolves.toMatchObject({
      item: { kind: expectedKind },
    });
  });

  it('offers at most 20 unprojected TODO candidates without invoking a runtime dependency', async () => {
    const { service } = setup({ scopeState: { organizeCandidateCount: 20, todoCount: 6 } });

    await expect(service.get({ userId, query: { projectId } })).resolves.toEqual({
      item: {
        kind: 'ORGANIZE_TASKS',
        title: '发现 20 个无项目待办',
        body: '可以为它们建议项目归属，本次最多整理 20 项',
        action: { type: 'ORGANIZE_TASKS', scope: { type: 'PROJECT', projectId } },
      },
    });
  });

  it.each([
    [{ type: 'PROJECT', projectId } as const, 2, 'CURRENT_SCOPE'],
    [{ type: 'PROJECT', projectId } as const, 0, 'EMPTY_SCOPE'],
    [{ type: 'ALL' } as const, 0, 'EMPTY_SCOPE'],
    [{ type: 'ALL' } as const, 2, 'DEFAULT'],
  ])('derives the current fallback for scope %j with %i TODOs', async (scope, todoCount, kind) => {
    const { service } = setup({ scopeState: { scope, todoCount } });
    const query = scope.type === 'PROJECT' ? { projectId: scope.projectId } : {};

    const response = await service.get({ userId, query });

    expect(response.item.kind).toBe(kind);
  });

  it('validates organize eligibility before admission and rejects an empty candidate set', async () => {
    const { readPort, service } = setup({ scopeState: { organizeCandidateCount: 0 } });

    const error = await service
      .assertOrganizeEligible({ userId, scope: { type: 'PROJECT', projectId } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiHttpException);
    expect(error).toMatchObject({ code: 'AGENT_REQUEST_CONFLICT', status: 409 });
    expect(readPort.loadScopeState).toHaveBeenCalledWith({
      userId,
      scope: { type: 'PROJECT', projectId },
    });
  });

  it('returns only the bounded eligible count for the admission caller', async () => {
    const { service } = setup({ scopeState: { organizeCandidateCount: 20 } });

    await expect(
      service.assertOrganizeEligible({ userId, scope: { type: 'ALL' } }),
    ).resolves.toEqual({ eligibleTaskCount: 20 });
  });
});
