import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { PostgreSqlContainer } from '@testcontainers/postgresql';

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
