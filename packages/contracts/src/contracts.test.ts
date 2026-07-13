import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  nicknameSchema,
  normalizeUsername,
  pointsConfigSchema,
  registerWithUsernameSchema,
  taskIdSchema,
  usernameSchema,
} from './index.js';

describe('username contract', () => {
  it('normalizes width, surrounding whitespace and ASCII case', () => {
    expect(normalizeUsername('  Ａlice_01  ')).toBe('alice_01');
    expect(normalizeUsername('  小明-A  ')).toBe('小明-a');
  });

  it('accepts the locked character set and rejects punctuation', () => {
    expect(usernameSchema.parse('小明_01')).toBe('小明_01');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('name@example').success).toBe(false);
  });
});

describe('profile and registration contract', () => {
  it('accepts non-unique Chinese and English nicknames only', () => {
    expect(nicknameSchema.parse('小明Alice')).toBe('小明Alice');
    expect(nicknameSchema.safeParse('用户01').success).toBe(false);
    expect(nicknameSchema.safeParse('超过十个英文字母昵称A').success).toBe(false);
  });

  it('keeps an optional mainland phone as an unverified contact', () => {
    expect(
      registerWithUsernameSchema.parse({
        username: ' Alice_01 ',
        password: 'correct-horse',
        phone: '13800138000',
      }),
    ).toEqual({
      username: 'Alice_01',
      password: 'correct-horse',
      phone: '13800138000',
    });

    expect(
      registerWithUsernameSchema.safeParse({
        username: 'alice',
        password: 'correct-horse',
        phone: '12345',
      }).success,
    ).toBe(false);
  });
});

describe('shared primitives', () => {
  it('brands and validates UUID identifiers', () => {
    expect(taskIdSchema.parse('018f47be-1972-7d58-9d67-4ddc5eb78a63')).toBe(
      '018f47be-1972-7d58-9d67-4ddc5eb78a63',
    );
    expect(taskIdSchema.safeParse('task-1').success).toBe(false);
  });

  it('validates the stable API error envelope', () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: 'TASK_VERSION_CONFLICT',
          message: '待办已发生变化，请刷新后重试',
          requestId: 'req_01J1ABCDEF',
          details: {},
        },
      }),
    ).toMatchObject({ error: { code: 'TASK_VERSION_CONFLICT' } });
  });
});

describe('points configuration contract', () => {
  const validConfig = {
    version: 1,
    grants: { newUser: 20, dailyTopUpTo: 10 },
    capabilities: {
      'agent.standardTurn': 1,
      'agent.planGeneration': 2,
      'speech.transcription': 1,
    },
  };

  it('requires every P0 capability and non-negative integer values', () => {
    expect(pointsConfigSchema.parse(validConfig)).toEqual(validConfig);
    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        grants: { newUser: -1, dailyTopUpTo: 10 },
      }).success,
    ).toBe(false);
  });

  it('rejects missing capabilities and unknown configuration keys', () => {
    expect(
      pointsConfigSchema.safeParse({
        version: 1,
        grants: validConfig.grants,
        capabilities: { 'agent.standardTurn': 1 },
      }).success,
    ).toBe(false);

    expect(
      pointsConfigSchema.safeParse({ ...validConfig, unsupported: true }).success,
    ).toBe(false);
  });
});
