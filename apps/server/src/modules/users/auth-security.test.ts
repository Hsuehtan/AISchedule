import { describe, expect, it } from 'vitest';

import { AuthRateLimiter, AuthRateLimitPolicy } from './auth-rate-limiter.js';
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

  it('limits an IP independently even when every attempt uses a different username', () => {
    const policy = new AuthRateLimitPolicy({
      ip: { limit: 2, windowMs: 10_000, maxEntries: 10 },
      identity: { limit: 10, windowMs: 10_000, maxEntries: 10 },
    });

    expect(policy.consume('192.0.2.10', 'alice').allowed).toBe(true);
    expect(policy.consume('192.0.2.10', 'bob').allowed).toBe(true);
    expect(policy.consume('192.0.2.10', 'carol')).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
  });

  it('limits a normalized username independently across different IP addresses', () => {
    const policy = new AuthRateLimitPolicy({
      ip: { limit: 10, windowMs: 10_000, maxEntries: 10 },
      identity: { limit: 2, windowMs: 10_000, maxEntries: 10 },
    });

    expect(policy.consume('192.0.2.10', 'alice').allowed).toBe(true);
    expect(policy.consume('192.0.2.11', 'alice').allowed).toBe(true);
    expect(policy.consume('192.0.2.12', 'alice')).toEqual({
      allowed: false,
      retryAfterSeconds: 10,
    });
  });

  it('removes expired keys during the next sweep', () => {
    let now = 1_000;
    const limiter = new AuthRateLimiter({
      limit: 10,
      windowMs: 10_000,
      maxEntries: 2,
      now: () => now,
    });

    expect(limiter.consume('alice').allowed).toBe(true);
    expect(limiter.consume('bob').allowed).toBe(true);
    expect(limiter.entryCount).toBe(2);

    now += 10_001;
    expect(limiter.consume('carol').allowed).toBe(true);
    expect(limiter.entryCount).toBe(1);
  });

  it('fails closed without exceeding its configured key capacity', () => {
    const limiter = new AuthRateLimiter({
      limit: 10,
      windowMs: 10_000,
      maxEntries: 2,
    });

    expect(limiter.consume('alice').allowed).toBe(true);
    expect(limiter.consume('bob').allowed).toBe(true);
    expect(limiter.consume('carol')).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect(limiter.entryCount).toBe(2);
  });
});
