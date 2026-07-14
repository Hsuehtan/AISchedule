import { pathToFileURL } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import type { ReadStream, WriteStream } from 'node:tty';

import { createPrismaClient } from '@ai-schedule/db';
import { passwordSchema, userIdSchema, usernameSchema } from '@ai-schedule/contracts';

import { PasswordService } from '../modules/users/password.service.js';
import {
  AdminPasswordService,
  type AdminUserLookup,
  type SetAdminPasswordResult,
} from './admin-password.service.js';

export interface PasswordSetArguments {
  readonly lookup: AdminUserLookup;
  readonly operator: string;
  readonly reason: string;
}

type HiddenPrompt = (label: string) => Promise<string>;

export function parsePasswordSetArguments(arguments_: readonly string[]): PasswordSetArguments {
  const values = new Map<string, string>();
  const allowed = new Set(['--username', '--user-id', '--operator', '--reason']);

  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag || !allowed.has(flag)) throw new Error(`unsupported argument: ${flag ?? ''}`);
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    values.set(flag, value);
  }

  const username = values.get('--username');
  const userId = values.get('--user-id');
  if ((username ? 1 : 0) + (userId ? 1 : 0) !== 1) {
    throw new Error('provide exactly one of --username or --user-id');
  }

  const operator = values.get('--operator')?.trim();
  const reason = values.get('--reason')?.trim();
  if (!operator || operator.length > 128) throw new Error('--operator is required (max 128)');
  if (!reason || reason.length > 500) throw new Error('--reason is required (max 500)');

  const lookup: AdminUserLookup = username
    ? { username: usernameSchema.parse(username.normalize('NFKC')) }
    : { userId: userIdSchema.parse(userId) };
  return { lookup, operator, reason };
}

export async function confirmNewPassword(prompt: HiddenPrompt): Promise<string> {
  const first = passwordSchema.parse(await prompt('请输入新密码: '));
  const second = await prompt('请再次输入新密码: ');
  if (first !== second) throw new Error('两次输入的密码不一致');
  return first;
}

export function promptHidden(
  label: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    return Promise.reject(new Error('密码必须在交互式 TTY 中输入'));
  }

  output.write(label);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.off('keypress', onKeypress);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
    };
    const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('操作已取消'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (!key.ctrl && character && value.length < 128) value += character;
    };

    input.on('keypress', onKeypress);
  });
}

async function run(): Promise<SetAdminPasswordResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const args = parsePasswordSetArguments(process.argv.slice(2));
  const newPassword = await confirmNewPassword((label) => promptHidden(label));
  const database = createPrismaClient(databaseUrl);
  try {
    return await new AdminPasswordService(database, new PasswordService()).setPassword({
      ...args,
      newPassword,
    });
  } finally {
    await database.$disconnect();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  run()
    .then((result) => {
      process.stdout.write(
        `Password updated for ${result.userId}; revoked ${result.sessionsRevoked} session(s).\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : '操作失败'}\n`);
      process.exitCode = 1;
    });
}
