import { describe, expect, it } from 'vitest';

import {
  getNextPrototypeScreen,
  getPreviousPrototypeScreen,
  parsePrototypeScreen,
  prototypeScreens,
  toPrototypeHref,
} from './prototype-state';

describe('prototype navigation state', () => {
  it('exposes every Production V3 review state in board order', () => {
    expect(prototypeScreens).toHaveLength(15);
    expect(prototypeScreens[0]?.id).toBe('login');
    expect(prototypeScreens.at(-1)?.id).toBe('quota-limit');
  });

  it('parses safe screen values and falls back to all todos', () => {
    expect(parsePrototypeScreen('?screen=agent-confirm')).toBe('agent-confirm');
    expect(parsePrototypeScreen('?screen=unknown')).toBe('all-todos');
    expect(parsePrototypeScreen('')).toBe('all-todos');
  });

  it('cycles review navigation and emits reproducible urls', () => {
    expect(getNextPrototypeScreen('quota-limit')).toBe('login');
    expect(getPreviousPrototypeScreen('login')).toBe('quota-limit');
    expect(toPrototypeHref('voice-input')).toBe('/?screen=voice-input');
  });
});
