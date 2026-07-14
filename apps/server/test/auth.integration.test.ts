import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { createPrismaClient, type DatabaseClient } from '@ai-schedule/db';
import type {
  ApiErrorEnvelope,
  AuthResponse,
  PublicUser,
  SessionResponse,
} from '@ai-schedule/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdminCredentialVersionConflictError,
  AdminPasswordService,
} from '../src/admin/admin-password.service.js';
import { createApplication } from '../src/bootstrap.js';
import { PasswordService } from '../src/modules/users/password.service.js';

const execFileAsync = promisify(execFile);
const origin = 'http://127.0.0.1:4173';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  if (typeof header !== 'string') throw new Error('response did not set a session cookie');
  return header.split(';', 1)[0] ?? '';
}

describe('username authentication', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let app: NestFastifyApplication;
  let db: DatabaseClient;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();
    await execFileAsync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: resolve(process.cwd(), '../../packages/db'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    db = createPrismaClient(databaseUrl);
    app = await createApplication({
      databaseUrl,
      allowedOrigins: [origin],
      configRoot: resolve(process.cwd(), '../../config'),
      isProduction: false,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await startedContainer?.stop();
  });

  it('registers a user, grants points atomically, and restores the session from a secure cookie', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username: '测试用户_01', password: ' pass word ', phone: '13800138000' },
    });

    expect(register.statusCode).toBe(201);
    expect(register.json()).toMatchObject({
      user: {
        username: '测试用户_01',
        nickname: '用户',
        phone: '13800138000',
        phoneVerified: false,
      },
    });
    expect(register.headers['set-cookie']).toEqual(
      expect.stringContaining('HttpOnly; SameSite=Lax'),
    );
    expect(register.headers['x-content-type-options']).toBe('nosniff');
    expect(register.headers['x-request-id']).toMatch(/^req_[A-Za-z0-9]+$/);

    const cookie = sessionCookie(register);
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    const sessionBody = session.json<SessionResponse>();
    expect(sessionBody).toMatchObject({
      authenticated: true,
      user: { username: '测试用户_01' },
    });
    if (!sessionBody.authenticated) throw new Error('expected an authenticated session');
    const expiresAt = Date.parse(sessionBody.expiresAt);
    expect(expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000);

    const restoredAgain = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(restoredAgain.json<SessionResponse>()).toMatchObject({
      expiresAt: sessionBody.expiresAt,
    });

    const profile = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json<{ user: PublicUser }>()).toEqual({ user: sessionBody.user });

    const identity = await db.userIdentity.findUniqueOrThrow({
      where: {
        type_identifierNormalized: { type: 'USERNAME', identifierNormalized: '测试用户_01' },
      },
      include: { user: { include: { pointTransactions: true, contacts: true, sessions: true } } },
    });
    expect(identity.user.aiPoints).toBe(20);
    expect(identity.user.pointTransactions).toEqual([
      expect.objectContaining({ type: 'NEW_USER_GRANT', amount: 20, status: 'SUCCEEDED' }),
    ]);
    expect(identity.user.contacts).toEqual([
      expect.objectContaining({ type: 'PHONE', status: 'UNVERIFIED' }),
    ]);
    expect(identity.user.sessions[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.user.sessions[0]?.tokenHash).not.toBe(cookie.split('=', 2)[1]);
  });

  it('normalizes usernames before uniqueness checks and keeps login errors generic', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username: 'Alice_01', password: 'valid-password' },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username: 'ＡＬＩＣＥ_01', password: 'another-password' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'USERNAME_ALREADY_EXISTS' } });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'Alice_01', password: 'wrong-password' },
    });
    const missingUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'missing-user', password: 'wrong-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(missingUser.statusCode).toBe(401);
    expect(wrongPassword.json<ApiErrorEnvelope>().error.code).toBe('INVALID_CREDENTIALS');
    expect(missingUser.json<ApiErrorEnvelope>().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('commits only one complete registration for concurrent equivalent usernames', async () => {
    const attempts = await Promise.allSettled([
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/username/register',
        headers: { origin },
        payload: { username: 'Concurrent_01', password: 'first-password' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/username/register',
        headers: { origin },
        payload: { username: 'ＣＯＮＣＵＲＲＥＮＴ_01', password: 'second-password' },
      }),
    ]);

    expect(attempts.every((attempt) => attempt.status === 'fulfilled')).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === 'fulfilled' ? [attempt.value] : [],
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json<ApiErrorEnvelope>().error
        .code,
    ).toBe('USERNAME_ALREADY_EXISTS');

    const identities = await db.userIdentity.findMany({
      where: { type: 'USERNAME', identifierNormalized: 'concurrent_01' },
      include: {
        user: {
          include: { pointTransactions: true, sessions: true },
        },
      },
    });
    expect(identities).toHaveLength(1);
    expect(identities[0]?.user.aiPoints).toBe(20);
    expect(identities[0]?.user.pointTransactions).toEqual([
      expect.objectContaining({ type: 'NEW_USER_GRANT', amount: 20, status: 'SUCCEEDED' }),
    ]);
    expect(identities[0]?.user.sessions).toHaveLength(1);
  });

  it('rejects cross-origin cookie writes and makes logout idempotent', async () => {
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'Alice_01', password: 'valid-password' },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'Alice_01', password: 'valid-password' },
    });
    const cookie = sessionCookie(login);

    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json()).toMatchObject({ error: { code: 'ORIGIN_REQUIRED' } });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin },
    });
    const repeated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ loggedOut: true });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual({ loggedOut: true });

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authenticated: false, user: null, expiresAt: null });
  });

  it('changes a password through the admin service, revokes every session, and audits no secrets', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username: 'cli-user', password: 'old-password' },
    });
    const oldCookie = sessionCookie(register);
    const userId = register.json<AuthResponse>().user.id;

    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'cli-user', password: 'old-password' },
    });
    expect(secondLogin.statusCode).toBe(200);

    const admin = new AdminPasswordService(db, new PasswordService());
    const result = await admin.setPassword({
      lookup: { userId },
      newPassword: 'new-password',
      operator: 'haon',
      reason: '用户申诉处理',
    });
    expect(result).toEqual({ userId, credentialVersion: 2, sessionsRevoked: 2 });

    const stored = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { passwordCredential: true, sessions: true, adminAuditEvents: true },
    });
    expect(stored.credentialVersion).toBe(2);
    expect(stored.passwordCredential?.credentialVersion).toBe(2);
    expect(
      stored.sessions.every((session: { revokedAt: Date | null }) => session.revokedAt !== null),
    ).toBe(true);
    expect(JSON.stringify(stored.adminAuditEvents)).not.toMatch(/new-password|passwordHash/i);

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: oldCookie },
    });
    expect(oldSession.json()).toEqual({ authenticated: false, user: null, expiresAt: null });

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'cli-user', password: 'old-password' },
    });
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/login',
      headers: { origin },
      payload: { username: 'cli-user', password: 'new-password' },
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
  });

  it('allows only one concurrent admin password change based on the same credential version', async () => {
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username: 'cli-race-user', password: 'old-password' },
    });
    expect(register.statusCode).toBe(201);
    const userId = register.json<AuthResponse>().user.id;

    const passwordService = new PasswordService();
    let hashingCalls = 0;
    let releaseHashing!: () => void;
    const bothHashing = new Promise<void>((resolveBarrier) => {
      releaseHashing = resolveBarrier;
    });
    const barrierPasswords = {
      async hash(password: string) {
        hashingCalls += 1;
        if (hashingCalls === 2) releaseHashing();
        await bothHashing;
        return passwordService.hash(password);
      },
      verify: (hash: string, password: string) => passwordService.verify(hash, password),
    };
    const admin = new AdminPasswordService(db, barrierPasswords);
    const attempts = [
      {
        lookup: { userId } as const,
        newPassword: 'first-new-password',
        operator: 'operator-a',
        reason: '并发改密测试 A',
      },
      {
        lookup: { userId } as const,
        newPassword: 'second-new-password',
        operator: 'operator-b',
        reason: '并发改密测试 B',
      },
    ];

    const results = await Promise.allSettled(attempts.map((input) => admin.setPassword(input)));
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof admin.setPassword>>> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(AdminCredentialVersionConflictError);

    const stored = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { passwordCredential: true, sessions: true, adminAuditEvents: true },
    });
    expect(stored.credentialVersion).toBe(2);
    expect(stored.passwordCredential?.credentialVersion).toBe(2);
    expect(stored.adminAuditEvents).toHaveLength(1);
    expect(stored.sessions.every((session) => session.revokedAt !== null)).toBe(true);

    const winner = fulfilled[0]?.value;
    const winningInput = attempts.find(
      (input) => input.operator === stored.adminAuditEvents[0]?.operator,
    );
    expect(winner?.credentialVersion).toBe(2);
    expect(winningInput).toBeDefined();
    await expect(
      passwordService.verify(
        stored.passwordCredential?.passwordHash ?? '',
        winningInput?.newPassword ?? '',
      ),
    ).resolves.toBe(true);
  });
});
