import { describe, expect, it, vi } from 'vitest';
import { AgentContextController } from './agent-context.controller.js';
import type { ResolvedApplicationOptions } from '../application-options.js';
import type { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import type { PrismaAgentPersistence } from './prisma-agent.persistence.js';

describe('private context authentication', () => {
  const run = vi.fn();
  const controller = new AgentContextController(
    { agentContextServiceToken: 'context-token' } as ResolvedApplicationOptions,
    { run } as unknown as DatabaseUnitOfWork,
    {} as PrismaAgentPersistence,
  );
  it('rejects absent, execute-only and incorrect credentials before reading', async () => {
    for (const token of [undefined, 'Bearer execute-token', 'Bearer wrong']) {
      await expect(controller.read(token, {})).rejects.toMatchObject({ status: 401 });
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects caller-selected users and business IDs', async () => {
    await expect(
      controller.read('Bearer context-token', {
        requestId: 'bad',
        resource: 'TASKS',
        limit: 50,
        userId: 'other',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(run).not.toHaveBeenCalled();
  });
});
