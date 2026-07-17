import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import {
  actionProposalIdSchema,
  agentMessageIdSchema,
  agentRequestIdSchema,
  conversationIdSchema,
} from '@ai-schedule/contracts';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { AuthGuard, type AuthenticatedUserContext } from '../users/auth.guard.js';
import { AgentController } from './agent.controller.js';
import type { AgentApplicationPort } from './agent-application.port.js';

const user: AuthenticatedUserContext = {
  id: '018f47be-1972-7d58-9d67-4ddc5eb78a60',
  credentialVersion: 1,
};
const conversationId = conversationIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a63');
const requestId = agentRequestIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a64');
const messageId = agentMessageIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a65');
const proposalId = actionProposalIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a66');
const now = '2026-07-17T12:00:00.000Z';
const idempotencyKey = 'phase3-public-http-01';

type PortMethod = (...args: never[]) => unknown;

function createMethodMock<TMethod extends PortMethod>() {
  return vi.fn<Parameters<TMethod>, ReturnType<TMethod>>();
}

function createPort() {
  const mocks = {
    createTurn: createMethodMock<AgentApplicationPort['createTurn']>(),
    generatePlan: createMethodMock<AgentApplicationPort['generatePlan']>(),
    getRequest: createMethodMock<AgentApplicationPort['getRequest']>(),
    listMessages: createMethodMock<AgentApplicationPort['listMessages']>(),
    markConversationViewed: createMethodMock<AgentApplicationPort['markConversationViewed']>(),
    answerMessage: createMethodMock<AgentApplicationPort['answerMessage']>(),
    editProposal: createMethodMock<AgentApplicationPort['editProposal']>(),
    dismissProposal: createMethodMock<AgentApplicationPort['dismissProposal']>(),
    cancelProposal: createMethodMock<AgentApplicationPort['cancelProposal']>(),
    confirmProposal: createMethodMock<AgentApplicationPort['confirmProposal']>(),
    getSmartInbox: createMethodMock<AgentApplicationPort['getSmartInbox']>(),
    organizeSmartInbox: createMethodMock<AgentApplicationPort['organizeSmartInbox']>(),
  };
  const port: AgentApplicationPort = mocks;

  return { mocks, port };
}

function createReply() {
  const reply = { status: vi.fn() };
  reply.status.mockReturnValue(reply);
  return reply;
}

describe('AgentController HTTP contract', () => {
  it('publishes every approved endpoint behind AuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentController)).toContain(AuthGuard);

    const routes = [
      ['createTurn', 'agent/turns', RequestMethod.POST],
      ['generatePlan', 'agent/plan-generations', RequestMethod.POST],
      ['getRequest', 'agent/requests/:id', RequestMethod.GET],
      ['listMessages', 'conversations/:id/messages', RequestMethod.GET],
      ['markConversationViewed', 'conversations/:id/viewed', RequestMethod.POST],
      ['answerMessage', 'conversations/:id/messages/:messageId/answers', RequestMethod.POST],
      ['editProposal', 'action-proposals/:id', RequestMethod.PATCH],
      ['dismissProposal', 'action-proposals/:id/dismiss', RequestMethod.POST],
      ['cancelProposal', 'action-proposals/:id/cancel', RequestMethod.POST],
      ['confirmProposal', 'action-proposals/:id/confirm', RequestMethod.POST],
      ['getSmartInbox', 'smart-inbox', RequestMethod.GET],
      ['organizeSmartInbox', 'smart-inbox/organize', RequestMethod.POST],
    ] as const;

    for (const [methodName, path, method] of routes) {
      const handler = AgentController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it('strictly parses admission, polling and Smart Inbox inputs before delegation', async () => {
    const { mocks, port } = createPort();
    mocks.createTurn.mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    });
    mocks.getRequest.mockResolvedValue({
      requestId,
      conversationId,
      status: 'RUNNING',
      pollAfterMs: 2_000,
    });
    mocks.getSmartInbox.mockResolvedValue({
      item: {
        kind: 'DEFAULT',
        title: '告诉我下一件事',
        body: '可以用自然语言描述待办',
        action: { type: 'START_AGENT' },
      },
    });
    const controller = new AgentController(port);

    await expect(
      controller.createTurn(user, idempotencyKey, {
        input: { mode: 'TEXT', text: '  帮我创建明天的待办  ' },
      }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    expect(mocks.createTurn).toHaveBeenCalledWith({
      userId: user.id,
      idempotencyKey,
      input: { input: { mode: 'TEXT', text: '帮我创建明天的待办' } },
    });

    await controller.getRequest(user, requestId);
    expect(mocks.getRequest).toHaveBeenCalledWith({ userId: user.id, requestId });

    await controller.getSmartInbox(user, { projectId: undefined });
    expect(mocks.getSmartInbox).toHaveBeenCalledWith({ userId: user.id, query: {} });

    expect(() =>
      controller.createTurn(user, idempotencyKey, {
        input: { mode: 'TEXT', text: '正常输入' },
        pointsCost: 0,
      }),
    ).toThrowError(ApiHttpException);
    expect(() => controller.getRequest(user, 'not-a-uuid')).toThrowError(ApiHttpException);
    expect(() => controller.getSmartInbox(user, { unexpected: 'field' })).toThrowError(
      ApiHttpException,
    );
  });

  it('delegates the versioned conversation and proposal commands with authenticated ownership', async () => {
    const { mocks, port } = createPort();
    mocks.generatePlan.mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    });
    mocks.listMessages.mockResolvedValue({ items: [], pageInfo: { nextCursor: null } });
    mocks.markConversationViewed.mockResolvedValue({
      lastViewedMessageId: messageId,
      viewedAt: now,
    });
    mocks.answerMessage.mockResolvedValue({
      outcome: 'QUEUED',
      request: { requestId, conversationId, status: 'QUEUED', pollAfterMs: 1_000 },
    });
    const controller = new AgentController(port);

    await controller.generatePlan(user, idempotencyKey, {
      source: { type: 'MESSAGE', messageId, version: 2 },
    });
    await controller.listMessages(user, conversationId, { limit: '20' });
    await controller.markConversationViewed(user, conversationId, idempotencyKey, {
      lastViewedMessageId: messageId,
    });
    const reply = createReply();
    await controller.answerMessage(
      user,
      conversationId,
      messageId,
      idempotencyKey,
      { version: 2, answer: { type: 'OPTION', optionId: 'candidate-1' } },
      reply as unknown as FastifyReply,
    );

    expect(mocks.generatePlan).toHaveBeenCalledWith({
      userId: user.id,
      idempotencyKey,
      input: { source: { type: 'MESSAGE', messageId, version: 2 } },
    });
    expect(mocks.listMessages).toHaveBeenCalledWith({
      userId: user.id,
      conversationId,
      query: { limit: 20 },
    });
    expect(mocks.markConversationViewed).toHaveBeenCalledWith({
      userId: user.id,
      conversationId,
      idempotencyKey,
      input: { lastViewedMessageId: messageId },
    });
    expect(mocks.answerMessage).toHaveBeenCalledWith({
      userId: user.id,
      conversationId,
      messageId,
      idempotencyKey,
      input: { version: 2, answer: { type: 'OPTION', optionId: 'candidate-1' } },
    });
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
  });

  it('requires Idempotency-Key on every public write endpoint', async () => {
    const controller = new AgentController(createPort().port);
    const reply = createReply();

    const calls: Array<() => unknown> = [
      () => controller.createTurn(user, undefined, { input: { mode: 'TEXT', text: '新待办' } }),
      () =>
        controller.generatePlan(user, undefined, {
          source: { type: 'MESSAGE', messageId, version: 1 },
        }),
      () =>
        controller.markConversationViewed(user, conversationId, undefined, {
          lastViewedMessageId: messageId,
        }),
      () =>
        controller.answerMessage(
          user,
          conversationId,
          messageId,
          undefined,
          { version: 1, answer: { type: 'OPTION', optionId: 'candidate-1' } },
          reply as unknown as FastifyReply,
        ),
      () =>
        controller.editProposal(user, proposalId, undefined, {
          version: 1,
          command: { type: 'REMOVE_FIELD_SUGGESTION', mutationId: messageId, field: 'PROJECT' },
        }),
      () => controller.dismissProposal(user, proposalId, undefined, { version: 1 }),
      () => controller.cancelProposal(user, proposalId, undefined, { version: 1 }),
      () => controller.confirmProposal(user, proposalId, undefined, { version: 1 }),
      () =>
        controller.organizeSmartInbox(user, undefined, {
          scope: { type: 'ALL' },
        }),
    ];

    for (const call of calls) {
      await expect(Promise.resolve().then(call)).rejects.toEqual(
        expect.objectContaining({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        }),
      );
    }
  });

  it('maps deterministic answers to 200 and queued answers to 202', async () => {
    const { mocks, port } = createPort();
    const controller = new AgentController(port);
    const reply = createReply();
    mocks.answerMessage.mockResolvedValueOnce({
      outcome: 'QUEUED',
      request: { requestId, conversationId, status: 'QUEUED', pollAfterMs: 1_000 },
    });

    await controller.answerMessage(
      user,
      conversationId,
      messageId,
      idempotencyKey,
      { version: 1, answer: { type: 'OPTION', optionId: 'candidate-1' } },
      reply as unknown as FastifyReply,
    );
    expect(reply.status).toHaveBeenLastCalledWith(HttpStatus.ACCEPTED);

    mocks.answerMessage.mockResolvedValueOnce({
      outcome: 'DETERMINISTIC',
      message: {
        id: messageId,
        conversationId,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'CHOICE',
        content: { type: 'USER_INPUT', text: 'candidate-1' },
        replyToId: null,
        proposalId: null,
        interactionStatus: null,
        aiRequestId: null,
        version: 1,
        createdAt: now,
      },
      proposal: null,
    });
    await controller.answerMessage(
      user,
      conversationId,
      messageId,
      idempotencyKey,
      { version: 1, answer: { type: 'OPTION', optionId: 'candidate-1' } },
      reply as unknown as FastifyReply,
    );
    expect(reply.status).toHaveBeenLastCalledWith(HttpStatus.OK);
  });

  it('never leaks unknown or upstream application errors through the public boundary', async () => {
    const { mocks, port } = createPort();
    const controller = new AgentController(port);
    mocks.createTurn.mockRejectedValueOnce(
      new Error('DeepSeek 503: raw provider body and internal Python traceback'),
    );

    const first = await controller
      .createTurn(user, idempotencyKey, { input: { mode: 'TEXT', text: '创建待办' } })
      .catch((error: unknown) => error);
    expect(first).toBeInstanceOf(ApiHttpException);
    expect(first).toMatchObject({
      code: 'AGENT_SERVICE_UNAVAILABLE',
      message: '智能处理暂不可用',
      details: {},
    });
    expect(String(first)).not.toContain('DeepSeek');

    mocks.createTurn.mockRejectedValueOnce(
      new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AGENT_SERVICE_UNAVAILABLE',
        'Python traceback',
        { providerBody: 'secret upstream content' },
      ),
    );
    const second = await controller
      .createTurn(user, idempotencyKey, { input: { mode: 'TEXT', text: '创建待办' } })
      .catch((error: unknown) => error);
    expect(second).toMatchObject({
      code: 'AGENT_SERVICE_UNAVAILABLE',
      message: '智能处理暂不可用',
      details: {},
    });
    expect(JSON.stringify(second)).not.toContain('secret upstream content');
  });
});
