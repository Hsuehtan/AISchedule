import { describe, expect, it } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  authResponseSchema,
  logoutResponseSchema,
  nicknameSchema,
  normalizeUsername,
  pointsConfigSchema,
  publicUserSchema,
  registerWithUsernameSchema,
  sessionResponseSchema,
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
    expect(usernameSchema.parse('  Ａlice_01  ')).toBe('Alice_01');
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

  it('exposes read-only public user and authenticated session DTOs', () => {
    const user = publicUserSchema.parse({
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
      username: '小明_01',
      nickname: '用户',
      phone: '13800138000',
      phoneVerified: false,
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
    });

    expect(authResponseSchema.parse({ user }).user.username).toBe('小明_01');
    expect(logoutResponseSchema.parse({ loggedOut: true })).toEqual({ loggedOut: true });
    expect(
      sessionResponseSchema.parse({
        authenticated: true,
        user,
        expiresAt: '2026-08-13T12:00:00.000Z',
      }).authenticated,
    ).toBe(true);
    expect(
      sessionResponseSchema.parse({ authenticated: false, user: null, expiresAt: null })
        .authenticated,
    ).toBe(false);
    expect(
      sessionResponseSchema.safeParse({ authenticated: false, user, expiresAt: null }).success,
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
    version: 2,
    grants: {
      newUser: { points: 20, ruleVersion: 'new-user-v1' },
      dailyTopUpTo: { points: 10, ruleVersion: 'daily-top-up-v1' },
    },
    capabilities: [
      {
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        name: '普通 Agent 对话',
        callsModelApi: true,
        pointsCost: 1,
        costRuleVersion: 'agent-standard-v1',
        enabled: true,
      },
      {
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generation',
        name: 'Agent 计划生成',
        callsModelApi: true,
        pointsCost: 2,
        costRuleVersion: 'agent-plan-v1',
        enabled: true,
      },
      {
        capabilityCode: 'speech.transcription',
        endpointCode: 'voice.transcription',
        name: '语音转写',
        callsModelApi: true,
        pointsCost: 1,
        costRuleVersion: 'speech-transcription-v1',
        enabled: true,
      },
    ],
  };

  it('requires every P0 capability and non-negative integer values', () => {
    expect(pointsConfigSchema.parse(validConfig)).toEqual(validConfig);
    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        grants: {
          ...validConfig.grants,
          newUser: { points: -1, ruleVersion: 'new-user-v1' },
        },
      }).success,
    ).toBe(false);
    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        grants: {
          ...validConfig.grants,
          newUser: { points: 2_147_483_648, ruleVersion: 'new-user-v1' },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects missing capabilities, duplicate endpoints and unknown configuration keys', () => {
    expect(
      pointsConfigSchema.safeParse({
        version: 2,
        grants: validConfig.grants,
        capabilities: validConfig.capabilities.slice(0, 1),
      }).success,
    ).toBe(false);

    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        capabilities: validConfig.capabilities.map((capability) => ({
          ...capability,
          endpointCode: 'agent.turn',
        })),
      }).success,
    ).toBe(false);

    expect(pointsConfigSchema.safeParse({ ...validConfig, unsupported: true }).success).toBe(false);
  });

  it('requires model-backed capabilities to have a positive cost', () => {
    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        capabilities: validConfig.capabilities.map((capability) =>
          capability.capabilityCode === 'agent.standardTurn'
            ? { ...capability, pointsCost: 0 }
            : capability,
        ),
      }).success,
    ).toBe(false);

    expect(
      pointsConfigSchema.safeParse({
        ...validConfig,
        capabilities: validConfig.capabilities.map((capability) =>
          capability.capabilityCode === 'agent.standardTurn'
            ? { ...capability, callsModelApi: false, pointsCost: 1 }
            : capability,
        ),
      }).success,
    ).toBe(false);
  });
});
