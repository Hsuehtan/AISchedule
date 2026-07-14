import { describe, expect, it } from 'vitest';

import {
  getNextPrototypeScreen,
  getPreviousPrototypeScreen,
  parsePrototypeScreen,
  prototypeScreens,
  toPrototypeHref,
} from './prototype-state';
import { prototypeProjects, prototypeTasks } from './prototype-fixtures';

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
    expect(toPrototypeHref('voice-input')).toBe('/pages/review/index?screen=voice-input');
  });

  it('uses contract-shaped project and task fixtures', () => {
    expect(prototypeProjects).toHaveLength(4);
    expect(prototypeTasks).toHaveLength(5);
    expect(prototypeTasks.every((task) => task.userId === prototypeProjects[0]?.userId)).toBe(true);
    expect(prototypeTasks.at(-1)?.status).toBe('COMPLETED');
  });
});
