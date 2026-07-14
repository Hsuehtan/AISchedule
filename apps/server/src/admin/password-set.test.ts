import { EventEmitter } from 'node:events';
import type { ReadStream, WriteStream } from 'node:tty';

import { describe, expect, it, vi } from 'vitest';

import { AdminUserNotFoundError } from './admin-password.service.js';
import { confirmNewPassword, parsePasswordSetArguments, promptHidden } from './password-set.js';

describe('admin password-set CLI', () => {
  it('reports a meaningful error when the target user cannot be found', () => {
    expect(new AdminUserNotFoundError().message).toBe('未找到目标用户');
  });

  it('requires one user lookup, an operator and a reason without accepting plaintext password args', () => {
    expect(
      parsePasswordSetArguments([
        '--username',
        'Alice_01',
        '--operator',
        'haon',
        '--reason',
        '用户申诉处理',
      ]),
    ).toEqual({
      lookup: { username: 'Alice_01' },
      operator: 'haon',
      reason: '用户申诉处理',
    });

    expect(() =>
      parsePasswordSetArguments([
        '--user-id',
        '018f47be-1972-7d58-9d67-4ddc5eb78a63',
        '--operator',
        'haon',
        '--reason',
        'test',
        '--password',
        'must-not-appear',
      ]),
    ).toThrow(/password/i);
  });

  it('reads a hidden password twice and rejects a mismatch', async () => {
    const matchingPrompt = vi
      .fn<[string], Promise<string>>()
      .mockResolvedValueOnce('new-password')
      .mockResolvedValueOnce('new-password');
    await expect(confirmNewPassword(matchingPrompt)).resolves.toBe('new-password');
    expect(matchingPrompt).toHaveBeenCalledTimes(2);

    const mismatchPrompt = vi
      .fn<[string], Promise<string>>()
      .mockResolvedValueOnce('new-password')
      .mockResolvedValueOnce('different-password');
    await expect(confirmNewPassword(mismatchPrompt)).rejects.toThrow('两次输入的密码不一致');
  });

  it('does not echo password characters while reading from a TTY', async () => {
    class FakeInput extends EventEmitter {
      isRaw = false;
      isTTY = true;
      paused = false;

      pause() {
        this.paused = true;
        return this;
      }

      resume() {
        this.paused = false;
        return this;
      }

      setRawMode(mode: boolean) {
        this.isRaw = mode;
        return this;
      }
    }
    class FakeOutput {
      readonly chunks: string[] = [];
      readonly isTTY = true;

      write(chunk: string) {
        this.chunks.push(chunk);
        return true;
      }
    }

    const input = new FakeInput();
    const output = new FakeOutput();
    const result = promptHidden(
      '新密码: ',
      input as unknown as ReadStream,
      output as unknown as WriteStream,
    );
    for (const character of 'secret-value') {
      input.emit('keypress', character, { name: character });
    }
    input.emit('keypress', '\r', { name: 'return' });

    await expect(result).resolves.toBe('secret-value');
    expect(output.chunks.join('')).toBe('新密码: \n');
    expect(input.isRaw).toBe(false);
    expect(input.paused).toBe(true);
  });
});
