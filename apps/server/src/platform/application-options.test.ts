import { describe, expect, it } from 'vitest';

import { resolveApplicationOptions } from './application-options.js';

const base = {
  allowedOrigins: ['http://127.0.0.1:4173'],
  configRoot: '/tmp/config',
  databaseUrl: 'postgresql://local/test',
  isProduction: false,
} as const;

describe('application options', () => {
  it('defaults and validates Agent recovery bounds for programmatic bootstraps', () => {
    expect(resolveApplicationOptions(base).agentRecovery).toEqual({
      intervalMs: 30_000,
      batchSize: 100,
    });
    expect(
      resolveApplicationOptions({
        ...base,
        agentRecovery: { intervalMs: 15_000, batchSize: 25 },
      }).agentRecovery,
    ).toEqual({ intervalMs: 15_000, batchSize: 25 });
    expect(() =>
      resolveApplicationOptions({ ...base, agentRecovery: { intervalMs: 999, batchSize: 25 } }),
    ).toThrow(/agentRecovery.intervalMs/);
    expect(() =>
      resolveApplicationOptions({ ...base, agentRecovery: { intervalMs: 15_000, batchSize: 0 } }),
    ).toThrow(/agentRecovery.batchSize/);
    expect(() =>
      resolveApplicationOptions({ ...base, agentRecovery: { intervalMs: 15_000, batchSize: 4 } }),
    ).toThrow(/agentRecovery.batchSize/);
  });
});
