import { describe, expect, it } from 'vitest';

import { WriteIntentRegistry } from './write-intent';

describe('WriteIntentRegistry', () => {
  it('reuses one idempotency key for retries of the same user intent', () => {
    let sequence = 0;
    const registry = new WriteIntentRegistry(() => `key-${++sequence}`);

    const first = registry.keyFor({ title: '写周报', priority: 'MEDIUM' });
    const retry = registry.keyFor({ priority: 'MEDIUM', title: '写周报' });

    expect(retry).toBe(first);
    expect(sequence).toBe(1);
  });

  it('creates a new key when the payload changes or the previous intent succeeds', () => {
    let sequence = 0;
    const registry = new WriteIntentRegistry(() => `key-${++sequence}`);
    const original = { title: '写周报' };

    expect(registry.keyFor(original)).toBe('key-1');
    expect(registry.keyFor({ title: '写月报' })).toBe('key-2');
    registry.complete(original);
    expect(registry.keyFor(original)).toBe('key-3');
  });

  it('keeps concurrent task commands isolated by their payload', () => {
    let sequence = 0;
    const registry = new WriteIntentRegistry(() => `key-${++sequence}`);
    const first = { operation: 'complete', taskId: 'task-1', version: 1 };
    const second = { operation: 'complete', taskId: 'task-2', version: 1 };

    expect(registry.keyFor(first)).toBe('key-1');
    expect(registry.keyFor(second)).toBe('key-2');
    expect(registry.keyFor(first)).toBe('key-1');
  });
});
