import { describe, expect, it } from 'vitest';

import { parsePointsConfig } from './index';

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
