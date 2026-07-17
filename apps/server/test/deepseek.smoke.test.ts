import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../src/bootstrap.js';
import { DatabaseService } from '../src/platform/database/database.service.js';

const execFileAsync = promisify(execFile);
const workspace = resolve(process.cwd(), '../..');
const agentServiceRoot = resolve(workspace, 'apps/agent-service');
const configRoot = resolve(workspace, 'config');
const origin = 'http://127.0.0.1:4173';

const SAFE_CHILD_ENV_KEYS = [
  'LANG',
  'LC_ALL',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
  'UV_CACHE_DIR',
] as const;

function isolatedChildEnvironment(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.UV_CACHE_DIR ??= '/private/tmp/ai-schedule-uv';
  return { ...environment, ...extra };
}

type TerminalAgentResponse = Readonly<{
  status: 'SUCCEEDED' | 'FAILED' | 'RELEASED';
  result?: Readonly<{
    type: string;
    message?: Readonly<{ id: string; version: number }>;
  }>;
  failure?: Readonly<{ code: string }>;
}>;

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve an Agent service port')));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForReady(process: ChildProcess, url: string, output: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Python Agent service exited before readiness: ${output.join('').slice(-2_000)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error('Python Agent service did not become ready within 30 seconds');
}

async function stopProcess(process: ChildProcess | undefined): Promise<void> {
  if (process === undefined || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => process.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) =>
      setTimeout(() => {
        if (process.exitCode === null) process.kill('SIGKILL');
        resolveTimeout();
      }, 5_000),
    ),
  ]);
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (value === undefined) throw new Error('Smoke registration did not return a Session cookie');
  return value.split(';', 1)[0] ?? '';
}

async function pollTerminal(
  app: NestFastifyApplication,
  cookie: string,
  requestId: string,
  timeoutMs: number,
): Promise<TerminalAgentResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/requests/${requestId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<TerminalAgentResponse>();
    if (['SUCCEEDED', 'FAILED', 'RELEASED'].includes(body.status)) return body;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Agent request did not reach a terminal state within ${timeoutMs}ms`);
}

describe('DeepSeek full-chain smoke', () => {
  let app: NestFastifyApplication | undefined;
  let database: DatabaseService | undefined;
  let agentProcess: ChildProcess | undefined;
  let startedContainer: StartedPostgreSqlContainer | undefined;
  const agentOutput: string[] = [];

  beforeAll(async () => {
    const nodeMajor = Number.parseInt(process.versions.node.split('.', 1)[0] ?? '', 10);
    if (nodeMajor !== 24) {
      throw new Error(`DeepSeek smoke requires Node.js 24; received ${process.versions.node}`);
    }

    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    if (deepSeekApiKey === undefined || deepSeekApiKey.trim() === '') {
      throw new Error(
        'DEEPSEEK_API_KEY is not set. Inject it only in the local environment before running pnpm smoke:deepseek.',
      );
    }

    const postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('ai_schedule_deepseek_smoke')
      .withUsername('ai_schedule')
      .withPassword('ai_schedule')
      .start();
    startedContainer = postgres;
    const databaseUrl = postgres.getConnectionUri();
    const dbRoot = resolve(workspace, 'packages/db');
    await execFileAsync(
      process.execPath,
      [
        resolve(dbRoot, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      { cwd: dbRoot, env: isolatedChildEnvironment({ DATABASE_URL: databaseUrl }) },
    );

    const serviceToken = randomBytes(32).toString('base64url');
    const agentPort = await reservePort();
    agentProcess = spawn(
      'uv',
      [
        'run',
        '--locked',
        'uvicorn',
        'agent_service.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(agentPort),
        '--no-access-log',
      ],
      {
        cwd: agentServiceRoot,
        env: isolatedChildEnvironment({
          AGENT_ENV: 'production',
          AGENT_SERVICE_TOKEN: serviceToken,
          AI_SCHEDULE_CONFIG_ROOT: configRoot,
          DEEPSEEK_API_KEY: deepSeekApiKey,
          ...(process.env.DEEPSEEK_BASE_URL
            ? { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL }
            : {}),
          PYTHONPATH: resolve(agentServiceRoot, 'src'),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // The Python child owns the provider credential. Remove it before NestJS is constructed so
    // the business process cannot accidentally read or log it during this full-chain smoke.
    delete process.env.DEEPSEEK_API_KEY;
    agentProcess.stdout?.on('data', (chunk: Buffer) => agentOutput.push(chunk.toString()));
    agentProcess.stderr?.on('data', (chunk: Buffer) => agentOutput.push(chunk.toString()));
    await waitForReady(
      agentProcess,
      `http://127.0.0.1:${agentPort}/internal/health/ready`,
      agentOutput,
    );

    app = await createApplication({
      databaseUrl,
      allowedOrigins: [origin],
      configRoot,
      isProduction: false,
      agentService: {
        baseUrl: `http://127.0.0.1:${agentPort}`,
        serviceToken,
      },
    });
    database = new DatabaseService(databaseUrl);
  });

  afterAll(async () => {
    await app?.close();
    await database?.onApplicationShutdown();
    await stopProcess(agentProcess);
    await startedContainer?.stop();
  });

  it('persists and settles one standard reply and one generated plan', async () => {
    if (app === undefined || database === undefined) throw new Error('Smoke harness is not ready');
    const startedAt = Date.now();
    const username = `smoke_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: { username, password: 'smoke-only-password' },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = sessionCookie(registered.headers['set-cookie']);

    const standard = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/turns',
      headers: {
        cookie,
        origin,
        'idempotency-key': `smoke-standard-${randomUUID()}`,
      },
      payload: {
        input: {
          mode: 'TEXT',
          text: '请只用一句纯文字给出安排今天工作的建议，不需要澄清或执行操作。',
        },
      },
    });
    expect(standard.statusCode).toBe(202);
    const standardQueued = standard.json<{ requestId: string }>();
    const standardResult = await pollTerminal(app, cookie, standardQueued.requestId, 90_000);
    expect(standardResult.status, standardResult.failure?.code).toBe('SUCCEEDED');
    expect(standardResult.result?.type).toBe('REPLY');
    const sourceMessage = standardResult.result?.message;
    if (sourceMessage === undefined) throw new Error('Standard reply did not expose its Message');

    const plan = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/plan-generations',
      headers: {
        cookie,
        origin,
        'idempotency-key': `smoke-plan-${randomUUID()}`,
      },
      payload: {
        source: {
          type: 'MESSAGE',
          messageId: sourceMessage.id,
          version: sourceMessage.version,
        },
        instruction: '生成两项简短且可以直接执行的任务计划。',
      },
    });
    expect(plan.statusCode).toBe(202);
    const planQueued = plan.json<{ requestId: string }>();
    const planResult = await pollTerminal(app, cookie, planQueued.requestId, 120_000);
    expect(planResult.status, planResult.failure?.code).toBe('SUCCEEDED');
    expect(planResult.result?.type).toBe('PLAN');

    const identity = await database.client.userIdentity.findUniqueOrThrow({
      where: {
        type_identifierNormalized: { type: 'USERNAME', identifierNormalized: username },
      },
    });
    const user = await database.client.user.findUniqueOrThrow({ where: { id: identity.userId } });
    const debits = await database.client.aiPointTransaction.findMany({
      where: {
        userId: identity.userId,
        requestId: { in: [standardQueued.requestId, planQueued.requestId] },
        type: 'DEBIT',
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(user.aiPoints).toBe(17);
    expect(debits.map(({ pointsDelta, status }) => ({ pointsDelta, status }))).toEqual([
      { pointsDelta: -1, status: 'SUCCEEDED' },
      { pointsDelta: -2, status: 'SUCCEEDED' },
    ]);

    const runs = await database.client.agentRequestRun.findMany({
      where: { id: { in: [standardQueued.requestId, planQueued.requestId] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(runs).toHaveLength(2);
    expect(runs.every(({ resultHash }) => /^[a-f0-9]{64}$/.test(resultHash ?? ''))).toBe(true);
    const providerCalls = runs.reduce<number>(
      (total, { repairAttempts }) => total + 1 + (repairAttempts ?? 0),
      0,
    );
    expect(providerCalls).toBeLessThanOrEqual(4);

    console.log(
      JSON.stringify({
        smoke: 'passed',
        models: runs.map(({ model }) => model),
        durationMs: Date.now() - startedAt,
      }),
    );
  });
});
