import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-config.js';

describe('runtime configuration bootstrap', () => {
  it('loads only the product and provider files owned by the business service', () => {
    const config = loadRuntimeConfiguration();

    expect(
      config.points.value.capabilities.find(
        (capability) => capability.capabilityCode === 'agent.standardTurn',
      )?.pointsCost,
    ).toBe(1);
    expect(config.speech.value.limits.persistOriginalAudio).toBe(false);
    expect(config).not.toHaveProperty('agent');
  });
});
