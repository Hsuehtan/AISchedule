import { describe, expect, it, vi } from 'vitest';

import { UnauthorizedChannel } from './unauthorized-channel';

describe('UnauthorizedChannel', () => {
  it('delivers an unauthorized signal that arrives before the UI boundary mounts', () => {
    const channel = new UnauthorizedChannel();
    const listener = vi.fn();

    channel.notify();
    channel.subscribe(listener);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('stops delivering signals after the boundary unsubscribes', () => {
    const channel = new UnauthorizedChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    unsubscribe();
    channel.notify();

    expect(listener).not.toHaveBeenCalled();
  });
});
