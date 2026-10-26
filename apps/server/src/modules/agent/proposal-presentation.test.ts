import { describe, expect, it } from 'vitest';
import { proposalPresentation } from './proposal-presentation.js';

describe('proposal presentation by business operation', () => {
  for (const resultType of ['PLAN', 'ACTION_PROPOSAL']) {
    it.each(['CREATE_TASK', 'CREATE_PROJECT_TASKS'])(
      `${resultType}: %s always opens the plan draft, including historical creates`,
      (actionCode) => expect(proposalPresentation(resultType, actionCode)).toBe('PLAN'),
    );
    it.each(['UPDATE_TASK', 'COMPLETE_TASK', 'RESTORE_TASK', 'DELETE_TASK', 'ORGANIZE_TASKS'])(
      `${resultType}: %s remains an action card`,
      (actionCode) => expect(proposalPresentation(resultType, actionCode)).toBe('ACTION'),
    );
  }
  it('rejects a non-proposal result or unknown operation', () => {
    expect(() => proposalPresentation('REPLY', 'CREATE_TASK')).toThrow();
    expect(() => proposalPresentation('PLAN', null)).toThrow();
  });
});
