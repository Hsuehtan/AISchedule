import type { ExecuteRequest } from '@ai-schedule/contracts/internal-agent/v1';
import { describe, expect, it, vi } from 'vitest';

import { AgentServiceClient, AgentServiceClientError } from './python-agent.client.js';

type FetchArguments = [input: string, init: RequestInit];
type FetchResult = Promise<Response>;

const SERVICE_TOKEN = Buffer.alloc(32, 0x73).toString('base64url');
const request: ExecuteRequest = {
  contractVersion: '1.0',
  requestId: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
  capabilityCode: 'agent.standardTurn',
  deadlineAt: '2026-07-17T12:00:40.000Z',
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai',
  allowedResultTypes: ['REPLY'],
  messages: [{ role: 'USER', content: '帮我整理今天的事情' }],
  candidates: [],
};

const response = {
  contractVersion: '1.0',
  requestId: request.requestId,
  resolved: {
    provider: 'DEEPSEEK',
    model: 'deepseek-v4-flash',
    promptVersion: 'standard-v1',
    providerSchemaVersion: 'agent-output-v1',
    repairAttempts: 0,
  },
  result: { type: 'REPLY', text: '先处理周报。', offerPlan: false },
};

describe('AgentServiceClient', () => {
  it('requires a private 256-bit service token', () => {
    expect(
      () =>
        new AgentServiceClient({
          baseUrl: 'http://agent-service:8081',
          serviceToken: 'too-short',
        }),
    ).toThrow(/256-bit/);
    expect(
      () =>
        new AgentServiceClient({
          baseUrl: 'http://agent-service:8081',
          serviceToken: '.'.repeat(43),
        }),
    ).toThrow(/base64url/);
    expect(
      () =>
        new AgentServiceClient({
          baseUrl: 'http://agent-service:8081',
          serviceToken: 'a'.repeat(43),
        }),
    ).toThrow(/base64url/);
  });

  it('dispatches once with bearer authentication and validates the response', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081/', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(request)).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://agent-service:8081/internal/v1/agent/execute',
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SERVICE_TOKEN}`);
    expect(new Headers(init?.headers).get('x-request-id')).toBe(request.requestId);
  });

  it('treats a mismatched request id as an untrusted invalid response', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...response, requestId: crypto.randomUUID() }), {
          status: 200,
        }),
      ),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retain malformed private response content in the error cause', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(new Response('private-secret-body', { status: 200 })),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    const error = await client.execute(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', cause: undefined });
    expect(String(error)).not.toContain('private-secret-body');
  });

  it('rejects an oversized response before parsing it', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(new Response(JSON.stringify(response), { status: 200 })),
    );
    const client = new AgentServiceClient(
      {
        baseUrl: 'http://agent-service:8081',
        maxResponseBytes: 32,
        serviceToken: SERVICE_TOKEN,
      },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a contract-valid result type that admission did not allow', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...response,
            result: {
              type: 'CLARIFICATION',
              question: '你希望先处理哪一项？',
              options: [
                { optionId: 'opt_0000000000000001', label: '第一项', nextStep: 'DETERMINISTIC' },
                { optionId: 'opt_0000000000000002', label: '第二项', nextStep: 'AGENT_STANDARD' },
              ],
              allowFreeText: true,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(request)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('independently rejects stale or wrong-kind candidate references', async () => {
    const candidateRequest: ExecuteRequest = {
      ...request,
      allowedResultTypes: ['ACTION_PROPOSAL'],
      candidates: [
        {
          candidateRef: 'cand_00000000000000000000000000000001',
          kind: 'TASK',
          label: '写周报',
          version: 2,
        },
      ],
    };
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...response,
            result: {
              type: 'ACTION_PROPOSAL',
              actionCode: 'COMPLETE_TASK',
              summary: '完成周报',
              mutations: [
                {
                  operation: 'COMPLETE_TASK',
                  targetRef: 'cand_00000000000000000000000000000001',
                  expectedVersion: 1,
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(candidateRequest)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a wrong-kind candidate even when its version is current', async () => {
    const candidateRequest: ExecuteRequest = {
      ...request,
      allowedResultTypes: ['ACTION_PROPOSAL'],
      candidates: [
        {
          candidateRef: 'cand_00000000000000000000000000000001',
          kind: 'PROJECT',
          label: '工作',
          version: 2,
        },
      ],
    };
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...response,
            result: {
              type: 'ACTION_PROPOSAL',
              actionCode: 'COMPLETE_TASK',
              summary: '完成周报',
              mutations: [
                {
                  operation: 'COMPLETE_TASK',
                  targetRef: 'cand_00000000000000000000000000000001',
                  expectedVersion: 2,
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    await expect(client.execute(candidateRequest)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    ['AbortError', 'TIMEOUT'],
    ['ReadError', 'UNAVAILABLE'],
  ] as const)('treats a 2xx body %s as an ambiguous transport failure', async (name, code) => {
    const privateError = Object.assign(new Error('private-stream-detail'), { name });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"contractVersion":"1.0",'));
        controller.error(privateError);
      },
    });
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() =>
      Promise.resolve(new Response(stream, { status: 200 })),
    );
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    const error = await client.execute(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code, cause: undefined });
    expect(String(error)).not.toContain('private-stream-detail');
  });

  it('rejects oversized message context and per-kind candidate counts before dispatch', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>();
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );
    const oversizedMessages: ExecuteRequest = {
      ...request,
      messages: Array.from({ length: 4 }, () => ({
        role: 'USER' as const,
        content: '中'.repeat(4000),
      })),
    };
    const tooManyTasks: ExecuteRequest = {
      ...request,
      candidates: Array.from({ length: 51 }, (_, index) => ({
        candidateRef: `cand_${index.toString(16).padStart(32, '0')}`,
        kind: 'TASK' as const,
        label: `任务 ${index}`,
        version: 1,
      })),
    };

    await expect(client.execute(oversizedMessages)).rejects.toMatchObject({
      code: 'CONTRACT_REJECTED',
    });
    await expect(client.execute(tooManyTasks)).rejects.toMatchObject({
      code: 'CONTRACT_REJECTED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'BUSY'],
    [502, 'UNAVAILABLE'],
    [503, 'UNAVAILABLE'],
    [504, 'TIMEOUT'],
  ] as const)('does not retry HTTP %s or expose its body', async (status, code) => {
    const privateResponse = new Response('upstream-secret-body', { status });
    const cancelSpy = vi.spyOn(privateResponse.body!, 'cancel');
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() => Promise.resolve(privateResponse));
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    const error = await client.execute(request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentServiceClientError);
    expect(error).toMatchObject({ code, status });
    expect(String(error)).not.toContain('upstream-secret-body');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it('preserves HTTP classification when private body cancellation fails', async () => {
    const privateResponse = new Response('private-cancel-failure', { status: 503 });
    vi.spyOn(privateResponse.body!, 'cancel').mockRejectedValueOnce(
      new Error('private-cancel-detail'),
    );
    const fetchMock = vi.fn<FetchArguments, FetchResult>(() => Promise.resolve(privateResponse));
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:00:00.000Z'),
    );

    const error = await client.execute(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'UNAVAILABLE', status: 503, cause: undefined });
    expect(String(error)).not.toContain('private-cancel-detail');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an expired run before making a network dispatch', async () => {
    const fetchMock = vi.fn<FetchArguments, FetchResult>();
    const client = new AgentServiceClient(
      { baseUrl: 'http://agent-service:8081', serviceToken: SERVICE_TOKEN },
      fetchMock,
      () => new Date('2026-07-17T12:01:00.000Z'),
    );

    await expect(client.execute(request)).rejects.toMatchObject({ code: 'DEADLINE_EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
