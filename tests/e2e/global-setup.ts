import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { SYNTHETIC_ACCOUNT_KEYS, syntheticSessionId } from './synthetic-account.js';

const execFileAsync = promisify(execFile);
const workspace = process.cwd();
const h5Port = Number(process.env.H5_PORT ?? 11086);
const apiPort = Number(process.env.API_PORT ?? 13000);
const agentPort = Number(process.env.AGENT_STUB_PORT ?? 14001);
const agentServiceToken = Buffer.alloc(32, 0x65).toString('base64url');

function pnpmInvocation(args: string[]) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) return { command: process.execPath, args: [npmExecPath, ...args] };
  return { command: 'corepack', args: ['pnpm', ...args] };
}

async function runPnpm(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const invocation = pnpmInvocation(args);
  await execFileAsync(invocation.command, invocation.args, {
    cwd: options.cwd ?? workspace,
    env: { ...process.env, ...options.env },
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function waitForProcess(
  process: ChildProcess,
  url: string,
  label: string,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`${label} exited before readiness.\n${logs()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for ${label}.\n${logs()}`);
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
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

async function prepareSyntheticSessions(databaseUrl: string): Promise<void> {
  const [authModule, passwordModule, pointsModule, registryModule, optionsModule, databaseModule, unitOfWorkModule, runtimeModule] =
    await Promise.all([
      import('../../apps/server/dist/modules/users/auth.service.js'),
      import('../../apps/server/dist/modules/users/password.service.js'),
      import('../../apps/server/dist/modules/users/points/ai-points.service.js'),
      import('../../apps/server/dist/modules/users/points/capability-registry.service.js'),
      import('../../apps/server/dist/platform/application-options.js'),
      import('../../apps/server/dist/platform/database/database.service.js'),
      import('../../apps/server/dist/platform/database/unit-of-work.js'),
      import('../../apps/server/dist/runtime-config.js'),
    ]);
  const { AuthService } = authModule;
  const { PasswordService } = passwordModule;
  const { AiPointsService } = pointsModule;
  const { CapabilityRegistryService } = registryModule;
  const { resolveApplicationOptions } = optionsModule;
  const { DatabaseService } = databaseModule;
  const { DatabaseUnitOfWork } = unitOfWorkModule;
  const { loadRuntimeConfiguration } = runtimeModule;
  const database = new DatabaseService(databaseUrl);
  const unitOfWork = new DatabaseUnitOfWork(database);
  const runtime = loadRuntimeConfiguration(resolve(workspace, 'config'));
  await new CapabilityRegistryService(database, runtime).synchronize();
  const auth = new AuthService(
    database,
    unitOfWork,
    new AiPointsService(unitOfWork, runtime),
    new PasswordService(),
    resolveApplicationOptions({
      allowedOrigins: [`http://127.0.0.1:${h5Port}`],
      configRoot: resolve(workspace, 'config'),
      databaseUrl,
      isProduction: false,
    }),
  );
  const sessions: Record<string, string> = {};
  let accountSequence = 0;
  try {
    for (const key of SYNTHETIC_ACCOUNT_KEYS) {
      for (let retry = 0; retry <= 2; retry += 1) {
        accountSequence += 1;
        const issued = await auth.register({
          password: 'e2e-synthetic-password',
          username: `e2e_seed_${String(accountSequence).padStart(3, '0')}`,
        });
        sessions[syntheticSessionId(key, retry)] = issued.token;
      }
    }
    process.env.E2E_SYNTHETIC_SESSIONS = Buffer.from(JSON.stringify(sessions)).toString(
      'base64url',
    );
  } finally {
    await database.onApplicationShutdown();
  }
}

export default async function globalSetup() {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule_e2e')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule')
    .start();
  const databaseUrl = container.getConnectionUri();

  try {
    await runPnpm(['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
      cwd: resolve(workspace, 'packages/db'),
      env: { DATABASE_URL: databaseUrl },
    });
    await runPnpm(['--filter', '@ai-schedule/server...', 'build']);
    await prepareSyntheticSessions(databaseUrl);
  } catch (error) {
    await container.stop();
    throw error;
  }

  const agentOutput: string[] = [];
  const agent = spawn(process.execPath, [resolve(workspace, 'tests/e2e/agent-service-stub.mjs')], {
    cwd: workspace,
    env: {
      ...process.env,
      AGENT_SERVICE_TOKEN: agentServiceToken,
      AGENT_CONTEXT_SERVICE_TOKEN: Buffer.alloc(32, 99).toString('base64url'),
      AGENT_CONTEXT_URL: `http://127.0.0.1:${apiPort}`,
      AGENT_STUB_PORT: String(agentPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agent.stdout?.on('data', (chunk: Buffer) => agentOutput.push(chunk.toString()));
  agent.stderr?.on('data', (chunk: Buffer) => agentOutput.push(chunk.toString()));
  try {
    await waitForProcess(
      agent,
      `http://127.0.0.1:${agentPort}/internal/health/ready`,
      'Agent E2E stub',
      () => agentOutput.join('').slice(-10_000),
    );
  } catch (error) {
    await stopProcess(agent);
    await container.stop();
    throw error;
  }

  const output: string[] = [];
  const server = spawn(process.execPath, [resolve(workspace, 'apps/server/dist/main.js')], {
    cwd: workspace,
    env: {
      ...process.env,
      AI_SCHEDULE_CONFIG_ROOT: resolve(workspace, 'config'),
      AGENT_SERVICE_TOKEN: agentServiceToken,
      AGENT_CONTEXT_SERVICE_TOKEN: Buffer.alloc(32, 99).toString('base64url'),
      AGENT_CONTEXT_URL: `http://127.0.0.1:${apiPort}`,
      AGENT_SERVICE_URL: `http://127.0.0.1:${agentPort}`,
      ALLOWED_ORIGINS: `http://127.0.0.1:${h5Port},http://localhost:${h5Port}`,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      PORT: String(apiPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  try {
    await waitForProcess(
      server,
      `http://127.0.0.1:${apiPort}/api/v1/health/live`,
      'AI Schedule API',
      () => output.join('').slice(-10_000),
    );
  } catch (error) {
    await stopProcess(server);
    await stopProcess(agent);
    await container.stop();
    throw error;
  }

  return async () => {
    await stopProcess(server);
    await stopProcess(agent);
    await container.stop();
  };
}
