import { sessionResponseSchema } from '@ai-schedule/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiClient, type ApiTransport } from './api-client';

describe('ApiClient', () => {
  it('parses successful responses through the shared contract', async () => {
    const transport: ApiTransport = vi.fn().mockResolvedValue({
      data: { authenticated: false, expiresAt: null, user: null },
      status: 200,
    });
    const client = new ApiClient({ baseUrl: '/api/v1', transport });

    const result = await client.request('/auth/session', {
      responseSchema: sessionResponseSchema,
    });

    expect(result).toEqual({ authenticated: false, expiresAt: null, user: null });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/api/v1/auth/session' }),
    );
  });

  it('adds a unique idempotency key to writes', async () => {
    const transport: ApiTransport = vi.fn().mockResolvedValue({ data: { ok: true }, status: 200 });
    const client = new ApiClient({ baseUrl: '/api/v1', transport });

    await client.request('/tasks', {
      body: { title: '写周报' },
      idempotent: true,
      method: 'POST',
      responseSchema: { parse: (value) => value as { ok: true } },
    });

    const request = vi.mocked(transport).mock.calls[0]?.[0];
    expect(typeof request?.headers['Idempotency-Key']).toBe('string');
    expect(request?.headers['Idempotency-Key']?.length).toBeGreaterThan(10);
  });

  it('forwards a stable user-intent key instead of replacing it', async () => {
    const transport: ApiTransport = vi.fn().mockResolvedValue({ data: { ok: true }, status: 200 });
    const client = new ApiClient({ baseUrl: '/api/v1', transport });

    await client.request('/tasks', {
      body: { title: '写周报' },
      idempotencyKey: 'intent_task_create_1',
      idempotent: true,
      method: 'POST',
      responseSchema: { parse: (value) => value as { ok: true } },
    });

    expect(vi.mocked(transport).mock.calls[0]?.[0].headers['Idempotency-Key']).toBe(
      'intent_task_create_1',
    );
  });

  it('clears authenticated state on 401 and preserves the server error', async () => {
    const onUnauthorized = vi.fn();
    const transport: ApiTransport = vi.fn().mockResolvedValue({
      data: {
        error: {
          code: 'AUTH_SESSION_INVALID',
          details: {},
          message: '请重新登录',
          requestId: 'req_abc123',
        },
      },
      status: 401,
    });
    const client = new ApiClient({ baseUrl: '/api/v1', onUnauthorized, transport });

    await expect(
      client.request('/tasks', { responseSchema: { parse: (value) => value } }),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID', status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('lets credential forms render their own 401 without resetting navigation', async () => {
    const onUnauthorized = vi.fn();
    const transport: ApiTransport = vi.fn().mockResolvedValue({
      data: {
        error: {
          code: 'INVALID_CREDENTIALS',
          details: {},
          message: '用户名或密码错误',
          requestId: 'req_login1',
        },
      },
      status: 401,
    });
    const client = new ApiClient({ baseUrl: '/api/v1', onUnauthorized, transport });

    await expect(
      client.request('/auth/username/login', {
        handleUnauthorized: false,
        method: 'POST',
        responseSchema: { parse: (value) => value },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
