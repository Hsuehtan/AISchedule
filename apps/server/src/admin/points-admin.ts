import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadPointsConfig } from '@ai-schedule/config';
import { createPrismaClient } from '@ai-schedule/db';
import { userIdSchema, usernameSchema } from '@ai-schedule/contracts';

import type { AdminUserLookup } from './admin-password.service.js';
import { AdminPointsService, type AdminPointOperation } from './admin-points.service.js';

export type PointsAdminAction = 'add' | 'subtract' | 'set' | 'history';

export type ParsedPointsAdminArguments =
  | {
      readonly action: 'add' | 'subtract' | 'set';
      readonly lookup: AdminUserLookup;
      readonly value: number;
      readonly operator: string;
      readonly reason: string;
      readonly dryRun: boolean;
    }
  | {
      readonly action: 'history';
      readonly lookup: AdminUserLookup;
      readonly limit: number;
    };

export function parsePointsAdminArguments(
  action: PointsAdminAction,
  arguments_: readonly string[],
): ParsedPointsAdminArguments {
  const values = new Map<string, string>();
  let dryRun = false;
  const allowed =
    action === 'history'
      ? new Set(['--username', '--user-id', '--limit'])
      : new Set([
          '--username',
          '--user-id',
          action === 'set' ? '--balance' : '--amount',
          '--operator',
          '--reason',
          '--dry-run',
        ]);

  for (let index = 0; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    if (!flag || !allowed.has(flag)) throw new Error(`unsupported argument: ${flag ?? ''}`);
    if (flag === '--dry-run') {
      if (dryRun) throw new Error('duplicate argument: --dry-run');
      dryRun = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    values.set(flag, value);
    index += 1;
  }

  const lookup = parseLookup(values);
  if (action === 'history') {
    const limit = values.has('--limit')
      ? parseInteger(values.get('--limit'), '--limit', false)
      : 50;
    if (limit < 1 || limit > 200) throw new Error('--limit must be between 1 and 200');
    return { action, lookup, limit };
  }

  const operator = values.get('--operator')?.trim();
  const reason = values.get('--reason')?.trim();
  if (!operator || operator.length > 128) throw new Error('--operator is required (max 128)');
  if (!reason || reason.length > 500) throw new Error('--reason is required (max 500)');
  const numericFlag = action === 'set' ? '--balance' : '--amount';
  const value = parseInteger(values.get(numericFlag), numericFlag, action !== 'set');
  return { action, lookup, value, operator, reason, dryRun };
}

function parseLookup(values: ReadonlyMap<string, string>): AdminUserLookup {
  const username = values.get('--username');
  const userId = values.get('--user-id');
  if ((username ? 1 : 0) + (userId ? 1 : 0) !== 1) {
    throw new Error('provide exactly one of --username or --user-id');
  }
  return username
    ? { username: usernameSchema.parse(username.normalize('NFKC')) }
    : { userId: userIdSchema.parse(userId) };
}

function parseInteger(value: string | undefined, flag: string, positive: boolean): number {
  if (!value || !/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed > 2_147_483_647 ||
    (positive ? parsed <= 0 : parsed < 0)
  ) {
    throw new Error(`${flag} is out of range`);
  }
  return parsed;
}

async function run(action: PointsAdminAction): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const configRoot = process.env.AI_SCHEDULE_CONFIG_ROOT ?? resolve(process.cwd(), '../../config');
  const arguments_ = parsePointsAdminArguments(action, process.argv.slice(3));
  const database = createPrismaClient(databaseUrl);
  const service = new AdminPointsService(
    database,
    loadPointsConfig(resolve(configRoot, 'product/points.yaml')),
  );
  try {
    if (arguments_.action === 'history') {
      const history = await service.history(arguments_.lookup, arguments_.limit);
      process.stdout.write(`${JSON.stringify(history)}\n`);
      return;
    }
    const operation = arguments_.action.toUpperCase() as AdminPointOperation;
    const result = await service.adjust({
      lookup: arguments_.lookup,
      operation,
      value: arguments_.value,
      operator: arguments_.operator,
      reason: arguments_.reason,
      dryRun: arguments_.dryRun,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await database.$disconnect();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const action = process.argv[2];
  if (action !== 'add' && action !== 'subtract' && action !== 'set' && action !== 'history') {
    process.stderr.write('Expected one action: add, subtract, set, or history\n');
    process.exitCode = 1;
  } else {
    run(action).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : '操作失败'}\n`);
      process.exitCode = 1;
    });
  }
}
