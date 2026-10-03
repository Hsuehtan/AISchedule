import { describe, expect, it } from 'vitest';
import { AgentContextCursor } from './agent-context-cursor.js';

describe('run-scoped context cursors', () => {
  const codec = new AgentContextCursor('x'.repeat(43));
  it('encrypts and binds cursor position to the Run and resource', () => {
    const cursor = codec.encode('run-a', 'MESSAGES', 21);
    expect(cursor).not.toContain('run-a');
    expect(codec.decode(cursor, 'run-a', 'MESSAGES')).toBe(21);
    expect(() => codec.decode(cursor, 'run-b', 'MESSAGES')).toThrow();
    expect(() => codec.decode(cursor, 'run-a', 'TASKS')).toThrow();
    expect(() => codec.decode(cursor.slice(1), 'run-a', 'MESSAGES')).toThrow();
  });
});
