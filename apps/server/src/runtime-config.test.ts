import { describe, expect, it } from 'vitest';

import { loadRuntimeConfiguration } from './runtime-config.js';

describe('runtime configuration bootstrap', () => {
  it('loads and validates every committed product/provider file', () => {
    const config = loadRuntimeConfiguration();

    expect(config.points.value.capabilities['agent.standardTurn']).toBe(1);
    expect(config.agent.value.profiles.standard.model).toBe('deepseek-v4-flash');
    expect(config.speech.value.limits.persistOriginalAudio).toBe(false);
  });
});
