import { describe, expect, it } from 'vitest';
import { createCandidateReference, createOptionId } from './agent-context.js';

describe('Agent opaque references', () => {
  it('creates opaque references without embedding business ids', () => {
    const candidateReference = createCandidateReference();
    const optionId = createOptionId();

    expect(candidateReference).toMatch(/^cand_[a-f0-9]{32}$/);
    expect(optionId).toMatch(/^opt_[a-f0-9]{16}$/);
    expect(createCandidateReference()).not.toBe(candidateReference);
  });
});
