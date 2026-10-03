import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { PublicActionProposal } from '@ai-schedule/contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { chromium, expect as expectBrowser, type Browser } from '@playwright/test';
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
    proposal?: PublicActionProposal;
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

async function waitForReady(
  process: ChildProcess,
  url: string,
  output: string[],
  label = 'Python Agent service',
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `${label} exited before readiness: ${output.join('').slice(-2_000)}`,
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
  throw new Error(`${label} did not become ready within 30 seconds`);
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
  let h5Process: ChildProcess | undefined;
  let browser: Browser | undefined;
  let h5Origin = '';
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
    const contextPort = await reservePort();
    const h5Port = await reservePort();
    h5Origin = `http://127.0.0.1:${h5Port}`;
    const contextToken = randomBytes(32).toString('base64url');
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
          AGENT_CONTEXT_SERVICE_TOKEN: contextToken,
          AGENT_CONTEXT_URL: `http://127.0.0.1:${contextPort}`,
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
      allowedOrigins: [origin, h5Origin],
      configRoot,
      isProduction: false,
      agentContextServiceToken: contextToken,
      agentService: {
        baseUrl: `http://127.0.0.1:${agentPort}`,
        serviceToken,
      },
    });
    await app.listen(contextPort, '127.0.0.1');
    database = new DatabaseService(databaseUrl);

    await execFileAsync('corepack', ['pnpm', '--filter', '@ai-schedule/client...', 'build'], {
      cwd: workspace,
      env: isolatedChildEnvironment({}),
    });
    const h5Output: string[] = [];
    h5Process = spawn(process.execPath, [resolve(workspace, 'tests/e2e/h5-server.mjs')], {
      cwd: workspace,
      env: isolatedChildEnvironment({ API_PORT: String(contextPort), H5_PORT: String(h5Port) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    h5Process.stdout?.on('data', (chunk: Buffer) => h5Output.push(chunk.toString()));
    h5Process.stderr?.on('data', (chunk: Buffer) => h5Output.push(chunk.toString()));
    await waitForReady(h5Process, h5Origin, h5Output, 'H5 smoke server');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await stopProcess(h5Process);
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

  it('confirms seven Action types through one real multi-turn conversation', async () => {
    if (!app || !database) throw new Error('Smoke harness is not ready');
    const startedAt = Date.now();
    const username = `actions_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin },
      payload: {
        username,
        password: 'smoke-only-password',
      },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = sessionCookie(registered.headers['set-cookie']);
    const identity = await database.client.userIdentity.findUniqueOrThrow({
      where: {
        type_identifierNormalized: { type: 'USERNAME', identifierNormalized: username },
      },
    });
    const bystander = await database.client.task.create({
      data: { userId: identity.userId, title: '绝不能修改的对照任务', priority: 'LOW' },
    });
    let conversationId: string | undefined;
    let targetTaskId: string | undefined;
    let organizedTaskId: string | undefined;
    const runIds: string[] = [];
    const scenarios = [
      [
        'CREATE_TASK',
        '请创建一个无项目待办，标题为“合成测试甲”，优先级中，无需设置时间。请给我可确认的操作卡，不要只回复文字。',
      ],
      ['UPDATE_TASK', '把“合成测试甲”的优先级改为高，其他字段不变，请生成修改操作卡。'],
      ['COMPLETE_TASK', '把“合成测试甲”标记为已完成，请生成完成操作卡。'],
      ['RESTORE_TASK', '把已完成的“合成测试甲”恢复为待完成，请生成恢复操作卡。'],
      ['DELETE_TASK', '删除“合成测试甲”，请生成删除操作卡。'],
      [
        'CREATE_PROJECT_TASKS',
        '新建项目“合成测试项目”，同时在这个新项目下创建一项任务“合成测试乙”，优先级中，不设置时间。请生成创建项目及任务的操作卡。',
      ],
      [
        'ORGANIZE_TASKS',
        '将无项目待办“合成测试丙”归入已有项目“合成测试项目”，不修改其他字段。请生成整理任务操作卡。',
      ],
    ] as const;
    for (const [actionCode, text] of scenarios) {
      if (actionCode === 'ORGANIZE_TASKS') {
        const seeded = await app.inject({
          method: 'POST',
          url: '/api/v1/tasks',
          headers: { cookie, origin, 'idempotency-key': randomUUID() },
          payload: { title: '合成测试丙', priority: 'MEDIUM' },
        });
        expect(seeded.statusCode).toBe(201);
        organizedTaskId = seeded.json<{ task: { id: string } }>().task.id;
      }
      const queued = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/turns',
        headers: { cookie, origin, 'idempotency-key': randomUUID() },
        payload: { ...(conversationId ? { conversationId } : {}), input: { mode: 'TEXT', text } },
      });
      expect(queued.statusCode).toBe(202);
      const accepted = queued.json<{ requestId: string; conversationId: string }>();
      conversationId ??= accepted.conversationId;
      expect(accepted.conversationId).toBe(conversationId);
      runIds.push(accepted.requestId);
      let result = await pollTerminal(app, cookie, accepted.requestId, 90_000);
      expect(result.status, `${actionCode}:${result.failure?.code ?? 'no-code'}`).toBe('SUCCEEDED');
      if (result.result?.type === 'CLARIFICATION' && result.result.message) {
        const question = result.result.message;
        const answer = await app.inject({
          method: 'POST',
          url: `/api/v1/conversations/${conversationId}/messages/${question.id}/answers`,
          headers: { cookie, origin, 'idempotency-key': randomUUID() },
          payload: {
            version: question.version,
            answer: { type: 'TEXT', text: `本轮要求已确认：${text}` },
          },
        });
        expect(answer.statusCode).toBe(202);
        const followup = answer.json<{ outcome: string; request: { requestId: string } }>();
        expect(followup.outcome).toBe('QUEUED');
        runIds.push(followup.request.requestId);
        result = await pollTerminal(app, cookie, followup.request.requestId, 90_000);
        expect(result.status, `${actionCode}:${result.failure?.code ?? 'no-code'}`).toBe(
          'SUCCEEDED',
        );
      }
      expect(result.result?.type, actionCode).toBe('ACTION_PROPOSAL');
      const proposal = result.result?.proposal;
      if (!proposal) throw new Error(`Missing proposal for ${actionCode}`);
      expect(proposal.actionCode).toBe(actionCode);
      const beforeConfirm = await database.client.task.findMany({
        where: { userId: identity.userId },
        orderBy: { id: 'asc' },
      });
      const confirm = await app.inject({
        method: 'POST',
        url: `/api/v1/action-proposals/${proposal.id}/confirm`,
        headers: { cookie, origin, 'idempotency-key': randomUUID() },
        payload: { version: proposal.version },
      });
      expect(confirm.statusCode, actionCode).toBe(200);
      expect(confirm.json<{ outcome: string }>().outcome, actionCode).toBe('EXECUTED');
      const afterConfirm = await database.client.task.findMany({
        where: { userId: identity.userId },
        orderBy: { id: 'asc' },
      });
      // Replaying confirmation never dispatches inference or applies a second mutation.
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/action-proposals/${proposal.id}/confirm`,
        headers: { cookie, origin, 'idempotency-key': randomUUID() },
        payload: { version: proposal.version },
      });
      expect(replay.json<{ outcome: string }>().outcome).toBe('EXECUTED');
      expect(
        await database.client.task.findMany({
          where: { userId: identity.userId },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(afterConfirm);
      await expect(
        database.client.task.findUniqueOrThrow({ where: { id: bystander.id } }),
      ).resolves.toMatchObject({
        deletedAt: null,
        priority: 'LOW',
        status: 'TODO',
        title: '绝不能修改的对照任务',
      });
      if (actionCode === 'CREATE_TASK') {
        const created = afterConfirm.find((task) => task.title === '合成测试甲');
        expect(created).toMatchObject({ deletedAt: null, priority: 'MEDIUM', status: 'TODO' });
        targetTaskId = created?.id;
        expect(afterConfirm).toHaveLength(beforeConfirm.length + 1);
      }
      if (actionCode === 'UPDATE_TASK') {
        expect(targetTaskId).toBeTruthy();
        expect(afterConfirm.find((task) => task.id === targetTaskId)).toMatchObject({
          deletedAt: null,
          priority: 'HIGH',
          status: 'TODO',
        });
      }
      if (actionCode === 'COMPLETE_TASK') {
        expect(afterConfirm.find((task) => task.id === targetTaskId)).toMatchObject({
          deletedAt: null,
          status: 'COMPLETED',
        });
      }
      if (actionCode === 'RESTORE_TASK') {
        expect(afterConfirm.find((task) => task.id === targetTaskId)).toMatchObject({
          deletedAt: null,
          status: 'TODO',
        });
      }
      if (actionCode === 'DELETE_TASK') {
        expect(afterConfirm.find((task) => task.id === targetTaskId)?.deletedAt).toBeInstanceOf(
          Date,
        );
      }
      if (actionCode === 'CREATE_PROJECT_TASKS') {
        const created = afterConfirm.find((task) => task.title === '合成测试乙');
        expect(created).toMatchObject({ deletedAt: null, priority: 'MEDIUM', status: 'TODO' });
        if (!created?.projectId) throw new Error('Project task was not assigned to its new project');
        const project = await database.client.project.findUniqueOrThrow({
          where: { id: created.projectId },
        });
        expect(project.name).toBe('合成测试项目');
      }
      if (actionCode === 'ORGANIZE_TASKS') {
        expect(organizedTaskId).toBeTruthy();
        const organized = afterConfirm.find((task) => task.id === organizedTaskId);
        if (!organized?.projectId) throw new Error('Organized task was not assigned to a project');
        const project = await database.client.project.findUniqueOrThrow({
          where: { id: organized.projectId },
        });
        expect(project.name).toBe('合成测试项目');
      }
    }
    const runs = await database.client.agentRequestRun.findMany({ where: { id: { in: runIds } } });
    expect(runs.length).toBe(runIds.length);
    expect(
      runs.every((run) => run.status === 'SUCCEEDED' && run.dispatchAttemptedAt !== null),
    ).toBe(true);
    const debits = await database.client.aiPointTransaction.findMany({
      where: { requestId: { in: runIds }, type: 'DEBIT' },
    });
    expect(debits.length).toBe(runIds.length);
    expect(debits.every((debit) => debit.status === 'SUCCEEDED' && debit.pointsDelta === -1)).toBe(
      true,
    );
    console.log(
      JSON.stringify({
        smoke: 'actions-passed',
        cases: scenarios.length,
        durationMs: Date.now() - startedAt,
      }),
    );
  }, 600_000);

  it('drives real Action and plan recovery through the production H5 in Chrome', async () => {
    if (!app || !database || !browser || !h5Origin) throw new Error('Browser smoke is not ready');
    const startedAt = Date.now();
    const username = `browser_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/username/register',
      headers: { origin: h5Origin },
      payload: { username, password: 'smoke-only-password' },
    });
    expect(registered.statusCode).toBe(201);
    const cookie = sessionCookie(registered.headers['set-cookie']);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const identity = await database.client.userIdentity.findUniqueOrThrow({
      where: {
        type_identifierNormalized: { type: 'USERNAME', identifierNormalized: username },
      },
    });
    const bystander = await database.client.task.create({
      data: { userId: identity.userId, title: '浏览器对照任务', priority: 'LOW' },
    });
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
    await context.addCookies([
      {
        httpOnly: true,
        name: 'ai_schedule_session',
        sameSite: 'Lax',
        url: h5Origin,
        value: token,
      },
    ]);
    const page = await context.newPage();
    const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
    const plan = page.getByRole('dialog', { name: '计划草稿' });

    const submitInitial = async (text: string) => {
      await page.getByRole('button', { name: '打开文字输入' }).click();
      await page.getByLabel('告诉 Agent 的内容').locator('textarea').fill(text);
      await page.getByRole('button', { name: '发送给 Agent' }).click();
      await expectBrowser(conversation).toBeVisible();
    };
    const answerOneClarificationIfNeeded = async (answer: string, expectedCardCount: number) => {
      const cards = conversation.getByLabel('Agent 操作确认卡');
      const card = cards.nth(expectedCardCount - 1);
      const freeText = conversation.getByRole('button', { name: '都不是，补充说明' }).last();
      await expectBrowser
        .poll(
          async () => ((await cards.count()) >= expectedCardCount ? 1 : 0) + (await freeText.count()),
          { timeout: 90_000 },
        )
        .toBeGreaterThan(0);
      if ((await cards.count()) >= expectedCardCount) return card;
      await freeText.click();
      await conversation.getByLabel('继续告诉 Agent 的内容').locator('textarea').fill(answer);
      await conversation.getByRole('button', { name: '发送给 Agent' }).click();
      await expectBrowser(card).toBeVisible({ timeout: 90_000 });
      return card;
    };

    try {
      await page.goto(h5Origin);
      await submitInitial(
        '请创建一个无项目待办，标题为“浏览器合成任务”，优先级中，不设置时间。请给我确认卡。',
      );
      let card = await answerOneClarificationIfNeeded(
        '确认创建无项目待办“浏览器合成任务”，优先级中，不设置时间。',
        1,
      );
      await card.getByRole('button', { name: '确认执行' }).click();
      await expectBrowser(card).toContainText('已执行', { timeout: 30_000 });
      const created = await database.client.task.findFirstOrThrow({
        where: { userId: identity.userId, title: '浏览器合成任务' },
      });
      expect(created).toMatchObject({ priority: 'MEDIUM', status: 'TODO', deletedAt: null });

      await conversation
        .getByLabel('继续告诉 Agent 的内容')
        .locator('textarea')
        .fill('把它改成高优先级，其他字段不变，请给我确认卡。');
      await conversation.getByRole('button', { name: '发送给 Agent' }).click();
      card = await answerOneClarificationIfNeeded(
        '把刚创建的“浏览器合成任务”改成高优先级，其他字段不变。',
        2,
      );
      await card.getByRole('button', { name: '确认执行' }).click();
      await expectBrowser(card).toContainText('已执行', { timeout: 30_000 });
      await expect(
        database.client.task.findUniqueOrThrow({ where: { id: created.id } }),
      ).resolves.toMatchObject({ priority: 'HIGH', status: 'TODO', deletedAt: null });
      await expect(
        database.client.task.findUniqueOrThrow({ where: { id: bystander.id } }),
      ).resolves.toMatchObject({ priority: 'LOW', status: 'TODO', deletedAt: null });

      await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
      await submitInitial(
        '请只用一句文字说明如何准备一次产品评审，并提供生成计划的入口，不要执行任务操作。',
      );
      const generate = conversation.getByRole('button', { name: '根据这条回复生成计划' }).last();
      await expectBrowser(generate).toBeVisible({ timeout: 90_000 });
      await generate.click();
      await expectBrowser(plan).toBeVisible({ timeout: 120_000 });
      const firstEdit = plan.getByRole('button', { name: /^编辑/ }).first();
      await firstEdit.click();
      await plan.getByLabel('计划项标题').locator('input').fill('浏览器编辑后的评审准备');
      await plan.getByRole('button', { name: '保存此项' }).click();
      await expectBrowser(
        plan.getByRole('button', { name: '编辑浏览器编辑后的评审准备' }),
      ).toBeVisible();

      await plan.getByRole('button', { name: '重新生成计划' }).click();
      await expectBrowser(conversation).toBeVisible();
      await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
      const resume = page.getByRole('button', { name: /查看确认/ });
      await expectBrowser(resume).toBeVisible({ timeout: 120_000 });
      await resume.click();
      await expectBrowser(plan).toBeVisible({ timeout: 30_000 });
      const createPlan = plan.getByRole('button', { name: /^创建 \d+ 项$/ });
      await createPlan.click();
      await expectBrowser(plan).toBeHidden({ timeout: 30_000 });
      expect(
        await database.client.task.count({
          where: { userId: identity.userId, id: { notIn: [bystander.id, created.id] } },
        }),
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }

    console.log(
      JSON.stringify({ smoke: 'browser-passed', browser: 'chrome', durationMs: Date.now() - startedAt }),
    );
  }, 600_000);
});
