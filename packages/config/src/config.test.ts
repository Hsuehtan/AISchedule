import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadAgentProviderConfig,
  loadPointsConfig,
  loadSpeechProviderConfig,
  parseAgentProviderConfig,
  parsePointsConfig,
  parseSpeechProviderConfig,
} from './index.js';

const source = `version: 1
grants:
  newUser: 20
  dailyTopUpTo: 10
capabilities:
  agent.standardTurn: 1
  agent.planGeneration: 2
  speech.transcription: 1
`;

describe('points configuration loader', () => {
  it('parses and fingerprints a valid YAML source', () => {
    const result = parsePointsConfig(source);

    expect(result.value.grants.newUser).toBe(20);
    expect(result.version).toBe(1);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses an invalid or incomplete source', () => {
    expect(() => parsePointsConfig('version: 1\ngrants: {}\n')).toThrow();
    expect(() => parsePointsConfig('not: [valid')).toThrow();
  });
});

describe('provider configuration loaders', () => {
  it('validates the versioned files committed at the repository root', () => {
    const repositoryRoot = resolve(process.cwd(), '../..');

    expect(loadPointsConfig(resolve(repositoryRoot, 'config/product/points.yaml')).version).toBe(1);
    expect(
      loadAgentProviderConfig(resolve(repositoryRoot, 'config/providers/agent.yaml')).value
        .provider,
    ).toBe('deepseek');
    expect(
      loadSpeechProviderConfig(resolve(repositoryRoot, 'config/providers/speech.yaml')).value
        .provider,
    ).toBe('tencent');
  });

  it('locks DeepSeek profiles and Tencent privacy limits', () => {
    expect(
      parseAgentProviderConfig(`version: 1
provider: deepseek
baseUrl: https://api.deepseek.com
profiles:
  standard:
    model: deepseek-v4-flash
    timeoutMs: 30000
    promptVersion: p0-v1
    schemaVersion: p0-v1
  plan:
    model: deepseek-v4-pro
    timeoutMs: 60000
    promptVersion: p0-plan-v1
    schemaVersion: p0-plan-v1
`).value.profiles.plan.model,
    ).toBe('deepseek-v4-pro');

    expect(
      parseSpeechProviderConfig(`version: 1
provider: tencent
profile: sentence-recognition
limits:
  maxDurationSeconds: 60
  maxBytes: 3145728
  persistOriginalAudio: false
`).value.limits.persistOriginalAudio,
    ).toBe(false);
  });

  it('refuses to enable original audio persistence from configuration', () => {
    expect(() =>
      parseSpeechProviderConfig(`version: 1
provider: tencent
profile: sentence-recognition
limits:
  maxDurationSeconds: 60
  maxBytes: 3145728
  persistOriginalAudio: true
`),
    ).toThrow();
  });
});
