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

const source = `version: 2
grants:
  newUser:
    points: 20
    ruleVersion: new-user-v1
  dailyTopUpTo:
    points: 10
    ruleVersion: daily-top-up-v1
capabilities:
  - capabilityCode: agent.standardTurn
    endpointCode: agent.turn
    name: 普通 Agent 对话
    callsModelApi: true
    pointsCost: 1
    costRuleVersion: agent-standard-v1
    enabled: true
  - capabilityCode: agent.planGeneration
    endpointCode: agent.plan-generation
    name: Agent 计划生成
    callsModelApi: true
    pointsCost: 2
    costRuleVersion: agent-plan-v1
    enabled: true
  - capabilityCode: speech.transcription
    endpointCode: voice.transcription
    name: 语音转写
    callsModelApi: true
    pointsCost: 1
    costRuleVersion: speech-transcription-v1
    enabled: true
`;

describe('points configuration loader', () => {
  it('parses and fingerprints a valid YAML source', () => {
    const result = parsePointsConfig(source);

    expect(result.value.grants.newUser.points).toBe(20);
    expect(result.value.capabilities[0]?.endpointCode).toBe('agent.turn');
    expect(result.version).toBe(2);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses an invalid or incomplete source', () => {
    expect(() => parsePointsConfig('version: 2\ngrants: {}\n')).toThrow();
    expect(() => parsePointsConfig('not: [valid')).toThrow();
  });
});

describe('provider configuration loaders', () => {
  it('validates the versioned files committed at the repository root', () => {
    const repositoryRoot = resolve(process.cwd(), '../..');

    expect(loadPointsConfig(resolve(repositoryRoot, 'config/product/points.yaml')).version).toBe(2);
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
