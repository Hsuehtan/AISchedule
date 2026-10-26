import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { DatabaseService } from '../apps/server/dist/platform/database/database.service.js';

const local = parseEnv(await readFile('.env', 'utf8'));
const database = new DatabaseService(local.DATABASE_URL);
try {
  const marker = await database.client.task.findFirstOrThrow({
    where: { title: '本地同名任务' },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  });
  const identity = await database.client.userIdentity.findFirstOrThrow({
    where: { userId: marker.userId, type: 'USERNAME', identifierNormalized: { startsWith: 'pydantic_accept_' } },
    select: { identifierNormalized: true },
  });
  const duplicates = await database.client.task.findMany({
    where: { userId: marker.userId, title: '本地同名任务' },
    select: { status: true, deletedAt: true },
  });
  const runs = await database.client.agentRequestRun.findMany({
    where: { userId: marker.userId },
    orderBy: { createdAt: 'asc' },
    select: { status: true, resultType: true, model: true, repairAttempts: true },
  });
  const debits = await database.client.aiPointTransaction.findMany({
    where: { userId: marker.userId, type: 'DEBIT' },
    select: { status: true, pointsDelta: true },
  });
  const passed =
    duplicates.length === 2 &&
    duplicates.filter((task) => task.status === 'COMPLETED' && task.deletedAt === null).length === 1 &&
    runs.length >= 13 &&
    runs.every((run) => run.status === 'SUCCEEDED' && (!run.model || run.model === 'deepseek-v4-flash')) &&
    debits.length === runs.filter((run) => run.model === 'deepseek-v4-flash').length &&
    debits.every((debit) => debit.status === 'SUCCEEDED');
  const result = {
    status: passed ? 'passed' : 'failed',
    account: identity.identifierNormalized,
    verified: ['same-name-candidate-one-target', 'runs-succeeded', 'flash-only', 'single-debit-per-model-run'],
    duplicateStatuses: duplicates.map((task) => task.status).sort(),
    runs,
    debits,
  };
  await writeFile(
    resolve('docs/quality/agent-pydantic-acceptance/10087-eleven-phase-audit.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ status: result.status, runCount: runs.length, debitCount: debits.length }));
  if (!passed) process.exitCode = 1;
} finally {
  await database.onApplicationShutdown();
}
