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
});
