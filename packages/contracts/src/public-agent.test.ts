import { describe, expect, it } from 'vitest';

import {
  actionProposalCancelInputSchema,
  actionProposalConfirmInputSchema,
  actionProposalDismissInputSchema,
  actionProposalEditInputSchema,
  agentPublicErrorCodeSchema,
  agentRequestResponseSchema,
  agentTurnInputSchema,
  agentTurnQueuedResponseSchema,
  agentWriteHeadersSchema,
  conversationMessagesQuerySchema,
  conversationMessagesResponseSchema,
  conversationViewedInputSchema,
  messageAnswerInputSchema,
  planGenerationInputSchema,
  smartInboxOrganizeInputSchema,
  smartInboxResponseSchema,
} from './public-agent.js';

const conversationId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
const requestId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
const messageId = '018f47be-1972-7d58-9d67-4ddc5eb78a65';
const proposalId = '018f47be-1972-7d58-9d67-4ddc5eb78a66';
const mutationId = '018f47be-1972-7d58-9d67-4ddc5eb78a67';
const projectId = '018f47be-1972-7d58-9d67-4ddc5eb78a68';
const now = '2026-07-17T12:00:00.000Z';

const replyMessage = {
  id: messageId,
  conversationId,
  role: 'ASSISTANT',
  messageType: 'AI_REPLY',
  inputMode: 'SYSTEM',
  content: {
    type: 'AI_REPLY',
    text: '我已经理解你的要求。',
    canGeneratePlan: true,
  },
  replyToId: null,
  proposalId: null,
  interactionStatus: null,
  aiRequestId: requestId,
  version: 1,
  createdAt: now,
};

const proposal = {
  id: proposalId,
  conversationId,
  actionCode: 'CREATE_PROJECT_TASKS',
  title: '创建露营计划',
  status: 'AWAITING_CONFIRMATION',
  version: 1,
  mutations: [
    {
      id: mutationId,
      sequence: 1,
      operation: 'CREATE',
      targetType: 'TASK',
      targetId: null,
      targetVersion: null,
      beforeValue: null,
      afterValue: { title: '购买帐篷', priority: 'HIGH' },
      fieldSource: 'AGENT_SUGGESTION',
    },
  ],
  lastDismissedAt: null,
  expiresAt: '2026-07-24T12:00:00.000Z',
  createdAt: now,
  updatedAt: now,
};

describe('public Agent admission contracts', () => {
  it('accepts bounded text turns without allowing capability or billing fields', () => {
    expect(
      agentTurnInputSchema.parse({
        conversationId,
        input: { mode: 'TEXT', text: '帮我创建一个待办' },
      }),
    ).toEqual({ conversationId, input: { mode: 'TEXT', text: '帮我创建一个待办' } });

    expect(
      agentTurnInputSchema.safeParse({
        input: { mode: 'TEXT', text: '帮我创建一个待办' },
        capabilityCode: 'agent.planGeneration',
        pointsCost: 0,
      }).success,
    ).toBe(false);
    expect(agentTurnInputSchema.safeParse({ input: { mode: 'TEXT', text: '' } }).success).toBe(
      false,
    );
    expect(
      agentTurnInputSchema.safeParse({ input: { mode: 'TEXT', text: 'a'.repeat(501) } }).success,
    ).toBe(false);
  });

  it('requires an idempotency header but never accepts it in a write body', () => {
    expect(agentWriteHeadersSchema.parse({ idempotencyKey: 'agent-turn-01' })).toEqual({
      idempotencyKey: 'agent-turn-01',
    });
    expect(agentWriteHeadersSchema.safeParse({ idempotencyKey: '' }).success).toBe(false);
    expect(
      agentTurnInputSchema.safeParse({
        input: { mode: 'TEXT', text: '生成待办' },
        idempotencyKey: 'wrong-place',
      }).success,
    ).toBe(false);
  });

  it('locks plan generation to a versioned message or proposal source', () => {
    expect(
      planGenerationInputSchema.parse({
        source: { type: 'MESSAGE', messageId, version: 2 },
      }).source.type,
    ).toBe('MESSAGE');
    expect(
      planGenerationInputSchema.parse({
        source: { type: 'PROPOSAL', proposalId, version: 3 },
        instruction: '把时间安排得更紧凑',
      }).source.type,
    ).toBe('PROPOSAL');
    expect(
      planGenerationInputSchema.safeParse({
        source: { type: 'MESSAGE', messageId },
      }).success,
    ).toBe(false);
  });

  it('requires a message version when a text turn explicitly replies to a message', () => {
    expect(
      agentTurnInputSchema.parse({
        conversationId,
        input: {
          mode: 'TEXT',
          text: '我说的是明天那个待办',
          replyTo: { messageId, version: 2 },
        },
      }).input.replyTo,
    ).toEqual({ messageId, version: 2 });
    expect(
      agentTurnInputSchema.safeParse({
        conversationId,
        input: {
          mode: 'TEXT',
          text: '我说的是明天那个待办',
          replyToMessageId: messageId,
        },
      }).success,
    ).toBe(false);
  });

  it('returns a stable asynchronous receipt without exposing points or provider metadata', () => {
    const receipt = agentTurnQueuedResponseSchema.parse({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    });

    expect(receipt.status).toBe('QUEUED');
    expect(
      agentTurnQueuedResponseSchema.safeParse({ ...receipt, pointsCost: 1 }).success,
    ).toBe(false);
  });
});

describe('public Agent polling and message contracts', () => {
  it('does not expose a result before SUCCEEDED', () => {
    expect(
      agentRequestResponseSchema.parse({
        requestId,
        conversationId,
        status: 'RUNNING',
        pollAfterMs: 2_000,
      }).status,
    ).toBe('RUNNING');
    expect(
      agentRequestResponseSchema.safeParse({
        requestId,
        conversationId,
        status: 'RUNNING',
        pollAfterMs: 2_000,
        result: { type: 'REPLY', message: replyMessage },
      }).success,
    ).toBe(false);
  });

  it('accepts all five settled result variants and rejects unknown variants', () => {
    const results = [
      { type: 'REPLY', message: replyMessage },
      {
        type: 'CLARIFICATION',
        message: {
          ...replyMessage,
          messageType: 'QUESTION',
          content: {
            type: 'QUESTION',
            questionKind: 'CLARIFICATION',
            prompt: '你希望什么时候完成？',
            options: [
              { id: 'today', label: '今天' },
              { id: 'weekend', label: '周末' },
            ],
            allowFreeText: true,
            nextStep: 'AGENT_STANDARD_TURN',
          },
          interactionStatus: 'PENDING',
        },
      },
      {
        type: 'CANDIDATES',
        message: {
          ...replyMessage,
          messageType: 'QUESTION',
          content: {
            type: 'QUESTION',
            questionKind: 'CANDIDATES',
            prompt: '你指的是哪个待办？',
            options: [
              {
                id: 'candidate-1',
                label: '买帐篷',
                context: { projectName: '露营', scheduledAt: null },
              },
              { id: 'none', label: '都不是' },
            ],
            allowFreeText: true,
            nextStep: 'DETERMINISTIC',
          },
          interactionStatus: 'PENDING',
        },
      },
      { type: 'PLAN', proposal },
      { type: 'ACTION_PROPOSAL', proposal: { ...proposal, actionCode: 'CREATE_TASK' } },
    ];

    for (const result of results) {
      expect(
        agentRequestResponseSchema.safeParse({
          requestId,
          conversationId,
          status: 'SUCCEEDED',
          result,
          completedAt: now,
        }).success,
      ).toBe(true);
    }

    expect(
      agentRequestResponseSchema.safeParse({
        requestId,
        conversationId,
        status: 'SUCCEEDED',
        result: { type: 'TOKEN_USAGE', tokens: 12 },
        completedAt: now,
      }).success,
    ).toBe(false);
  });

  it('represents terminal failures with stable public reasons and no raw provider error', () => {
    const released = agentRequestResponseSchema.parse({
      requestId,
      conversationId,
      status: 'RELEASED',
      failure: {
        code: 'AGENT_SERVICE_UNAVAILABLE',
        message: '智能处理暂不可用',
        canRetry: true,
      },
      completedAt: now,
    });

    expect(released.status).toBe('RELEASED');
    if (released.status !== 'RELEASED') throw new Error('预期请求已释放');
    expect(released.failure.code).toBe('AGENT_SERVICE_UNAVAILABLE');
    expect(
      agentRequestResponseSchema.safeParse({
        requestId,
        conversationId,
        status: 'FAILED',
        failure: {
          code: 'AGENT_SERVICE_UNAVAILABLE',
          message: '暂不可用',
          canRetry: true,
          providerBody: 'raw upstream response',
        },
        completedAt: now,
      }).success,
    ).toBe(false);
  });

  it('paginates conversation messages and validates question answers by option id or text', () => {
    expect(conversationMessagesQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(
      conversationMessagesResponseSchema.parse({
        items: [replyMessage],
        pageInfo: { nextCursor: null },
      }).items[0]?.messageType,
    ).toBe('AI_REPLY');
    expect(
      messageAnswerInputSchema.parse({
        version: 1,
        answer: { type: 'OPTION', optionId: 'candidate-1' },
      }).answer.type,
    ).toBe('OPTION');
    expect(
      messageAnswerInputSchema.parse({
        version: 1,
        answer: { type: 'TEXT', text: '都不是，我说的是明天那个' },
      }).answer.type,
    ).toBe('TEXT');
    expect(
      messageAnswerInputSchema.safeParse({
        version: 1,
        answer: { type: 'OPTION', optionId: 'candidate-1', text: '偷渡字段' },
      }).success,
    ).toBe(false);
  });

  it('records the last viewed message without accepting ownership or unread counts', () => {
    expect(conversationViewedInputSchema.parse({ lastViewedMessageId: messageId })).toEqual({
      lastViewedMessageId: messageId,
    });
    expect(
      conversationViewedInputSchema.safeParse({
        lastViewedMessageId: messageId,
        unreadCount: 0,
      }).success,
    ).toBe(false);
  });
});

describe('public proposal command contracts', () => {
  it('only permits whitelisted local proposal edit commands', () => {
    const commands = [
      {
        version: 1,
        command: {
          type: 'SET_PROJECT',
          project: { type: 'EXISTING', projectId },
        },
      },
      {
        version: 1,
        command: {
          type: 'UPDATE_TASK_DRAFT',
          mutationId,
          changes: { title: '购买双人帐篷', priority: 'MEDIUM' },
        },
      },
      {
        version: 1,
        command: { type: 'REMOVE_MUTATION', mutationId },
      },
      {
        version: 1,
        command: {
          type: 'REMOVE_FIELD_SUGGESTION',
          mutationId,
          field: 'REMINDER_AT',
        },
      },
    ];

    for (const command of commands) {
      expect(actionProposalEditInputSchema.safeParse(command).success).toBe(true);
    }
    expect(
      actionProposalEditInputSchema.safeParse({
        version: 1,
        command: { type: 'EXECUTE_SQL', query: 'DROP TABLE tasks' },
      }).success,
    ).toBe(false);
  });

  it('requires optimistic versions for dismiss, cancel and confirm', () => {
    expect(actionProposalDismissInputSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(actionProposalCancelInputSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(actionProposalConfirmInputSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(actionProposalConfirmInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('Smart Inbox contracts', () => {
  it('returns one server-derived state with an explicit resume action', () => {
    const result = smartInboxResponseSchema.parse({
      item: {
        kind: 'AWAITING_CONFIRMATION',
        title: '有 1 个计划等待确认',
        body: '继续检查并创建任务',
        action: {
          type: 'RESUME_CONVERSATION',
          conversationId,
          proposalId,
          messageId: null,
        },
      },
    });

    expect(result.item.kind).toBe('AWAITING_CONFIRMATION');
    expect(
      smartInboxResponseSchema.safeParse({
        ...result,
        secondaryItem: { kind: 'DEFAULT' },
      }).success,
    ).toBe(false);
  });

  it('starts organization from a scope instead of trusting client task ids', () => {
    expect(
      smartInboxOrganizeInputSchema.parse({
        scope: { type: 'PROJECT', projectId },
      }).scope.type,
    ).toBe('PROJECT');
    expect(
      smartInboxOrganizeInputSchema.safeParse({
        scope: { type: 'ALL' },
        taskIds: [messageId],
      }).success,
    ).toBe(false);
  });

  it('locks error codes needed for quota, conflicts and safe degradation', () => {
    expect(agentPublicErrorCodeSchema.parse('AGENT_DAILY_QUOTA_EXHAUSTED')).toBe(
      'AGENT_DAILY_QUOTA_EXHAUSTED',
    );
    expect(agentPublicErrorCodeSchema.parse('ACTION_TARGET_VERSION_CONFLICT')).toBe(
      'ACTION_TARGET_VERSION_CONFLICT',
    );
    expect(agentPublicErrorCodeSchema.safeParse('DEEPSEEK_503_RAW').success).toBe(false);
  });
});
