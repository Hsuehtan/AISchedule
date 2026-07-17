import { describe, expect, it } from 'vitest';

import {
  createCandidateReference,
  createOptionId,
  selectBoundedAgentMessages,
  validateCandidateBudget,
} from './agent-context.js';

describe('Agent internal context boundaries', () => {
  it('keeps the newest chronological messages within 20 items and 12 KiB', () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
      content: `message-${String(index).padStart(2, '0')}`,
    }));

    const selected = selectBoundedAgentMessages(messages);

    expect(selected).toHaveLength(20);
    expect(selected[0]?.content).toBe('message-05');
    expect(selected.at(-1)?.content).toBe('message-24');
  });

  it('drops older whole messages rather than slicing private text', () => {
    const selected = selectBoundedAgentMessages([
      { role: 'USER', content: '旧'.repeat(4_000) },
      { role: 'ASSISTANT', content: '中'.repeat(1_500) },
      { role: 'USER', content: '新'.repeat(2_000) },
    ]);

    expect(selected.map((message) => message.content[0])).toEqual(['中', '新']);
    expect(selected.every((message) => !message.content.endsWith('…'))).toBe(true);
  });

  it('rejects a newest message that cannot fit without truncation', () => {
    expect(() =>
      selectBoundedAgentMessages([{ role: 'USER', content: '🙂'.repeat(4_000) }]),
    ).toThrow(/12 KiB/);
  });

  it('enforces separate task and project candidate ceilings', () => {
    expect(() => validateCandidateBudget({ projectCount: 30, taskCount: 50 })).not.toThrow();
    expect(() => validateCandidateBudget({ projectCount: 31, taskCount: 50 })).toThrow(/项目候选/);
    expect(() => validateCandidateBudget({ projectCount: 30, taskCount: 51 })).toThrow(/待办候选/);
  });

  it('creates opaque references without embedding business ids', () => {
    const candidateReference = createCandidateReference();
    const optionId = createOptionId();

    expect(candidateReference).toMatch(/^cand_[a-f0-9]{32}$/);
    expect(optionId).toMatch(/^opt_[a-f0-9]{16}$/);
    expect(createCandidateReference()).not.toBe(candidateReference);
  });
});
