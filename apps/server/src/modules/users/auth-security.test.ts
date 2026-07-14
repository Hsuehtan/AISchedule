import { describe, expect, it } from 'vitest';

import { AuthRateLimiter } from './auth-rate-limiter.js';
import { PasswordService } from './password.service.js';
import { createSessionToken, hashSessionToken } from './session-token.js';

describe('authentication security primitives', () => {
  it('hashes passwords without trimming user input', async () => {
    const passwords = new PasswordService();
    const hash = await passwords.hash(' pass word ');

    await expect(passwords.verify(hash, ' pass word ')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'pass word')).resolves.toBe(false);
  });

  it('generates a 256-bit opaque token and stores only a stable SHA-256 digest', () => {
    const token = createSessionToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('limits repeated attempts without permanently locking the key', () => {
    let now = 1_000;
    const limiter = new AuthRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

    expect(limiter.consume('login:alice')).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume('login:alice')).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume('login:alice')).toEqual({ allowed: false, retryAfterSeconds: 10 });

    now += 10_001;
    expect(limiter.consume('login:alice')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});
