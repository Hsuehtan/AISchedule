import { describe, expect, it } from 'vitest';

import { agentPollingInterval } from './agent-polling';

describe('agent polling interval', () => {
  it('polls every second during the first ten seconds', () => {
    expect(agentPollingInterval({ elapsedMs: 0, pageVisible: true, terminal: false })).toBe(1_000);
    expect(agentPollingInterval({ elapsedMs: 9_999, pageVisible: true, terminal: false })).toBe(
      1_000,
    );
  });

  it('slows to two seconds until the thirty-second boundary', () => {
    expect(agentPollingInterval({ elapsedMs: 10_000, pageVisible: true, terminal: false })).toBe(
      2_000,
    );
    expect(agentPollingInterval({ elapsedMs: 29_999, pageVisible: true, terminal: false })).toBe(
      2_000,
    );
  });

  it('polls every five seconds after thirty seconds', () => {
    expect(agentPollingInterval({ elapsedMs: 30_000, pageVisible: true, terminal: false })).toBe(
      5_000,
    );
  });

  it('stops for terminal requests and hidden pages', () => {
    expect(agentPollingInterval({ elapsedMs: 500, pageVisible: true, terminal: true })).toBe(false);
    expect(agentPollingInterval({ elapsedMs: 500, pageVisible: false, terminal: false })).toBe(
      false,
    );
  });
});
