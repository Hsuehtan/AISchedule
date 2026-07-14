import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('logs unknown failures without exposing their message or request contents', () => {
    const logger = { error: vi.fn() };
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const request = {
      headers: { authorization: 'Bearer should-never-be-logged' },
      publicRequestId: 'req_safe_log',
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    new ApiExceptionFilter(logger).catch(new Error('database password is secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用',
        requestId: 'req_safe_log',
        details: {},
      },
    });
    expect(logger.error).toHaveBeenCalledOnce();
    const logEntry = JSON.stringify(logger.error.mock.calls);
    expect(logEntry).toContain('req_safe_log');
    expect(logEntry).toContain('Error');
    expect(logEntry).not.toMatch(/database password|secret|authorization|Bearer/i);
  });
});
