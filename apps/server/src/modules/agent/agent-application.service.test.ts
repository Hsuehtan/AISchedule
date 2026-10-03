/* eslint-disable @typescript-eslint/unbound-method */
import { agentRequestIdSchema, conversationIdSchema } from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import type { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { AgentAdmissionService } from './agent-admission.service.js';
import type { AgentActionExecutor } from './agent-action-executor.js';
import { AgentApplicationService } from './agent-application.service.js';
import type { AgentProductPort } from './agent-product.port.js';
import type { SmartInboxService } from './smart-inbox.service.js';

const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a60';
const requestId = agentRequestIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a64');
const conversationId = conversationIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a63');

function setup(available = true) {
  const scope = Object.freeze({}) as never;
  const unitOfWork: UnitOfWork = { run: vi.fn((work) => work(scope)) };
  const admission = {
    createTurn: vi.fn().mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    }),
    generatePlan: vi.fn().mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    }),
    answerMessage: vi.fn().mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    }),
    organize: vi.fn().mockResolvedValue({
      requestId,
      conversationId,
      status: 'QUEUED',
      pollAfterMs: 1_000,
    }),
  } as unknown as AgentAdmissionService;
  const products = {
    replayAnswer: vi.fn().mockResolvedValue(null),
    inspectAnswer: vi.fn(),
    answerDeterministically: vi.fn(),
    getRequest: vi.fn(),
    listMessages: vi.fn(),
    markConversationViewed: vi.fn(),
    getProposal: vi.fn(),
    editProposal: vi.fn(),
    dismissProposal: vi.fn(),
    cancelProposal: vi.fn(),
  } as unknown as AgentProductPort;
  const actionExecutor = { confirm: vi.fn() } as unknown as AgentActionExecutor;
  const smartInbox = {
    get: vi.fn(),
    assertOrganizeEligible: vi.fn().mockResolvedValue({ eligibleTaskCount: 1 }),
  } as unknown as SmartInboxService;
  const service = new AgentApplicationService(
    admission,
    products,
    unitOfWork,
    { available },
    actionExecutor,
    smartInbox,
  );
  return { actionExecutor, admission, products, service, smartInbox, unitOfWork };
}

describe('AgentApplicationService T20 boundary', () => {
  it('rejects a turn before admission when the private runtime is not configured', async () => {
    const { admission, service } = setup(false);

    const error = await Promise.resolve()
      .then(() =>
        service.createTurn({
          userId,
          idempotencyKey: 'turn-disabled',
          input: { input: { mode: 'TEXT', text: '帮我梳理今天的任务' } },
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiHttpException);
    expect(error).toMatchObject({ code: 'AGENT_SERVICE_UNAVAILABLE', status: 503 });
    expect(admission.createTurn).not.toHaveBeenCalled();
  });

  it('binds a public turn to server-side standard admission', async () => {
    const { admission, service } = setup();
    const command = {
      userId,
      idempotencyKey: 'turn-1',
      input: { input: { mode: 'TEXT' as const, text: '帮我梳理今天的任务' } },
    };

    await expect(service.createTurn(command)).resolves.toMatchObject({ requestId });
    expect(admission.createTurn).toHaveBeenCalledWith(command);
  });

  it('persists proposal expiry before rejecting regeneration admission', async () => {
    const { admission, products, service } = setup();
    vi.mocked(products.getProposal).mockResolvedValue({
      proposal: { status: 'EXPIRED' },
    } as never);

    await expect(
      service.generatePlan({
        userId,
        idempotencyKey: 'expired-plan-redo',
        input: {
          source: {
            type: 'PROPOSAL',
            proposalId: '018f47be-1972-7d58-9d67-4ddc5eb78a66' as never,
            version: 1,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_PROPOSAL_NOT_EXECUTABLE', status: 409 });
    expect(admission.generatePlan).not.toHaveBeenCalled();
  });

  it('routes Smart Inbox reads without requiring the inference runtime', async () => {
    const { service, smartInbox } = setup(false);
    vi.mocked(smartInbox.get).mockResolvedValue({
      item: {
        kind: 'DEFAULT',
        title: '告诉我下一件事',
        body: '可以用自然语言描述待办',
        action: { type: 'START_AGENT' },
      },
    });

    await expect(service.getSmartInbox({ userId, query: {} })).resolves.toMatchObject({
      item: { kind: 'DEFAULT' },
    });
    expect(smartInbox.get).toHaveBeenCalledWith({ userId, query: {} });
  });

  it('routes a deterministic option without runtime admission or points', async () => {
    const { admission, products, service } = setup(false);
    vi.mocked(products.inspectAnswer).mockResolvedValue({ nextStep: 'DETERMINISTIC' });
    vi.mocked(products.answerDeterministically).mockResolvedValue({
      outcome: 'DETERMINISTIC',
      message: {
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a65' as never,
        conversationId,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'CHOICE',
        content: { type: 'USER_INPUT', text: '工作' },
        replyToId: '018f47be-1972-7d58-9d67-4ddc5eb78a66' as never,
        proposalId: null,
        interactionStatus: null,
        aiRequestId: null,
        version: 1,
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      proposal: null,
    });

    await expect(
      service.answerMessage({
        userId,
        conversationId,
        messageId: '018f47be-1972-7d58-9d67-4ddc5eb78a66' as never,
        idempotencyKey: 'answer-1',
        input: { version: 1, answer: { type: 'OPTION', optionId: 'opt_1234567890abcdef' } },
      }),
    ).resolves.toMatchObject({ outcome: 'DETERMINISTIC' });
    expect(admission.answerMessage).not.toHaveBeenCalled();
  });

  it('uses the server-owned per-option next step for a billed answer', async () => {
    const { admission, products, service } = setup();
    vi.mocked(products.inspectAnswer).mockResolvedValue({ nextStep: 'AGENT_PLAN_GENERATION' });

    await expect(
      service.answerMessage({
        userId,
        conversationId,
        messageId: '018f47be-1972-7d58-9d67-4ddc5eb78a66' as never,
        idempotencyKey: 'answer-2',
        input: { version: 1, answer: { type: 'OPTION', optionId: 'opt_1234567890abcdef' } },
      }),
    ).resolves.toMatchObject({ outcome: 'QUEUED', request: { requestId } });
    expect(admission.answerMessage).toHaveBeenCalledWith(
      expect.objectContaining({ nextStep: 'AGENT_PLAN_GENERATION' }),
    );
  });

  it('routes confirmation through the atomic action executor', async () => {
    const { actionExecutor, service } = setup();
    vi.mocked(actionExecutor.confirm).mockResolvedValue({ outcome: 'EXECUTED' } as never);

    await service.confirmProposal({
      userId,
      proposalId: '018f47be-1972-7d58-9d67-4ddc5eb78a68' as never,
      idempotencyKey: 'confirm-1',
      input: { version: 3 },
    });

    expect(actionExecutor.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ proposalVersion: 3, idempotencyKey: 'confirm-1' }),
    );
  });

  it('checks organize eligibility before runtime availability and admission', async () => {
    const { admission, service, smartInbox } = setup(false);

    await expect(
      service.organizeSmartInbox({
        userId,
        idempotencyKey: 'organize-1',
        input: { scope: { type: 'ALL' } },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SERVICE_UNAVAILABLE', status: 503 });
    expect(smartInbox.assertOrganizeEligible).toHaveBeenCalledOnce();
    expect(admission.organize).not.toHaveBeenCalled();
  });

  it('admits an eligible organize request through the standard capability', async () => {
    const { admission, service } = setup();
    const command = {
      userId,
      idempotencyKey: 'organize-2',
      input: { scope: { type: 'ALL' as const } },
    };

    await expect(service.organizeSmartInbox(command)).resolves.toMatchObject({ requestId });
    expect(admission.organize).toHaveBeenCalledWith(command);
  });
});
