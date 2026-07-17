import { describe, expect, it } from 'vitest';

import {
  agentRunRecoveryAction,
  assertAgentRunTransition,
  canDispatchAgentRun,
} from './agent-run-state.js';

describe('Agent run state machine', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['RUNNING', 'RESULT_PERSISTED'],
    ['RUNNING', 'FAILED'],
    ['RESULT_PERSISTED', 'SETTLING'],
    ['SETTLING', 'SUCCEEDED'],
    ['FAILED', 'RELEASED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertAgentRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ['QUEUED', 'SUCCEEDED'],
    ['RUNNING', 'RELEASED'],
    ['RESULT_PERSISTED', 'FAILED'],
    ['SETTLING', 'RELEASED'],
    ['SUCCEEDED', 'RUNNING'],
    ['RELEASED', 'RUNNING'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertAgentRunTransition(from, to)).toThrow(/非法 Agent Run 状态转换/);
  });

  it('only dispatches a queued, unattempted run before its deadline', () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    const deadlineAt = new Date('2026-07-17T12:00:40.000Z');

    expect(
      canDispatchAgentRun({ deadlineAt, dispatchAttemptedAt: null, now, status: 'QUEUED' }),
    ).toBe(true);
    expect(
      canDispatchAgentRun({ deadlineAt, dispatchAttemptedAt: now, now, status: 'QUEUED' }),
    ).toBe(false);
    expect(
      canDispatchAgentRun({ deadlineAt, dispatchAttemptedAt: null, now, status: 'RUNNING' }),
    ).toBe(false);
    expect(
      canDispatchAgentRun({ deadlineAt: now, dispatchAttemptedAt: null, now, status: 'QUEUED' }),
    ).toBe(false);
  });

  it('never releases or redispatches a persisted result during recovery', () => {
    const now = new Date('2026-07-17T12:05:00.000Z');

    expect(
      agentRunRecoveryAction({ now, recoverAfter: null, status: 'RESULT_PERSISTED' }),
    ).toBe('SETTLE');
    expect(agentRunRecoveryAction({ now, recoverAfter: null, status: 'SETTLING' })).toBe('SETTLE');
  });

  it('waits through ambiguous dispatches and only releases an explicitly failed run', () => {
    const now = new Date('2026-07-17T12:05:00.000Z');

    expect(
      agentRunRecoveryAction({
        now,
        recoverAfter: new Date('2026-07-17T12:06:00.000Z'),
        status: 'RUNNING',
      }),
    ).toBe('WAIT');
    expect(
      agentRunRecoveryAction({
        now,
        recoverAfter: new Date('2026-07-17T12:04:00.000Z'),
        status: 'RUNNING',
      }),
    ).toBe('MARK_FAILED');
    expect(agentRunRecoveryAction({ now, recoverAfter: null, status: 'FAILED' })).toBe('RELEASE');
  });
});
