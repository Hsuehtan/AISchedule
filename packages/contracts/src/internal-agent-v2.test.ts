import { describe, expect, it } from 'vitest';
import { contextReadRequestSchema, executeRequestSchema } from './generated/internal-agent-v2.js';

const requestId = 'b52e72d5-bb52-48c4-b511-fd7dc8c0f166';
describe('internal Agent v2 context ownership', () => {
  it('dispatches a descriptor without business identifiers or preselected context', () => {
    const request = {
      contractVersion: '2.0',
      requestId,
      capabilityCode: 'agent.standardTurn',
      deadlineAt: '2099-01-01T00:00:00Z',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      allowedResultTypes: ['REPLY'],
    };
    expect(executeRequestSchema.safeParse(request).success).toBe(true);
    for (const field of ['messages', 'candidates', 'userId', 'reservationId', 'callbackUrl']) {
      expect(executeRequestSchema.safeParse({ ...request, [field]: 'forbidden' }).success).toBe(
        false,
      );
    }
  });
  it('lets Python request more than the old algorithm window without accepting arbitrary scopes', () => {
    const request = { requestId, resource: 'MESSAGES', limit: 100 };
    expect(contextReadRequestSchema.safeParse(request).success).toBe(true);
    expect(contextReadRequestSchema.safeParse({ ...request, userId: requestId }).success).toBe(
      false,
    );
    expect(contextReadRequestSchema.safeParse({ ...request, limit: 0 }).success).toBe(false);
  });
});
