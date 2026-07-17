/* eslint-disable @typescript-eslint/unbound-method */
import { agentRequestIdSchema, conversationIdSchema } from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import type { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { AgentAdmissionService } from './agent-admission.service.js';
import { AgentApplicationService } from './agent-application.service.js';
import type { AgentProductPort } from './agent-product.port.js';

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
  } as unknown as AgentAdmissionService;
  const products = {
    getRequest: vi.fn(),
    listMessages: vi.fn(),
    markConversationViewed: vi.fn(),
  } as unknown as AgentProductPort;
  const service = new AgentApplicationService(admission, products, unitOfWork, { available });
  return { admission, products, service, unitOfWork };
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

  it('does not expose an unimplemented product path as a fake success', async () => {
    const { service } = setup();

    await expect(service.getSmartInbox({ userId, query: {} })).rejects.toMatchObject({
      code: 'AGENT_SERVICE_UNAVAILABLE',
      status: 503,
    });
  });
});
