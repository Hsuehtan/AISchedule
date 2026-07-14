export interface AuthRateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface AuthRateLimitPolicyOptions {
  readonly ip: AuthRateLimiterOptions;
  readonly identity: AuthRateLimiterOptions;
}

export interface AuthRateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface RateLimitWindow {
  count: number;
  startedAt: number;
}

export class AuthRateLimiter {
  private readonly attempts = new Map<string, RateLimitWindow>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private nextExpiryAt = Number.POSITIVE_INFINITY;

  constructor(private readonly options: AuthRateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error('auth rate limit must be a positive integer');
    }
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error('auth rate limit windowMs must be a positive integer');
    }
    const maxEntries = options.maxEntries ?? 10_000;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('auth rate limit maxEntries must be a positive integer');
    }

    this.now = options.now ?? Date.now;
    this.maxEntries = maxEntries;
  }

  get entryCount(): number {
    this.removeExpired(this.now());
    return this.attempts.size;
  }

  consume(key: string): AuthRateLimitResult {
    const now = this.now();
    this.removeExpired(now);
    let window = this.attempts.get(key);

    if (!window) {
      if (this.attempts.size >= this.maxEntries) {
        return {
          allowed: false,
          retryAfterSeconds: this.retryAfterSeconds(now, this.nextExpiryAt),
        };
      }

      window = { count: 0, startedAt: now };
      this.attempts.set(key, window);
      this.nextExpiryAt = Math.min(this.nextExpiryAt, now + this.options.windowMs);
    }

    window.count += 1;

    if (window.count <= this.options.limit) return { allowed: true, retryAfterSeconds: 0 };

    return {
      allowed: false,
      retryAfterSeconds: this.retryAfterSeconds(now, window.startedAt + this.options.windowMs),
    };
  }

  private removeExpired(now: number): void {
    if (now < this.nextExpiryAt) return;

    let nextExpiryAt = Number.POSITIVE_INFINITY;
    for (const [key, window] of this.attempts) {
      const expiresAt = window.startedAt + this.options.windowMs;
      if (expiresAt <= now) {
        this.attempts.delete(key);
      } else {
        nextExpiryAt = Math.min(nextExpiryAt, expiresAt);
      }
    }
    this.nextExpiryAt = nextExpiryAt;
  }

  private retryAfterSeconds(now: number, expiresAt: number): number {
    if (!Number.isFinite(expiresAt)) return Math.max(1, Math.ceil(this.options.windowMs / 1_000));
    return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
  }
}

export class AuthRateLimitPolicy {
  private readonly ipLimiter: AuthRateLimiter;
  private readonly identityLimiter: AuthRateLimiter;

  constructor(options: AuthRateLimitPolicyOptions) {
    this.ipLimiter = new AuthRateLimiter(options.ip);
    this.identityLimiter = new AuthRateLimiter(options.identity);
  }

  consume(ip: string, normalizedIdentity: string): AuthRateLimitResult {
    const ipResult = this.ipLimiter.consume(ip);
    if (!ipResult.allowed) return ipResult;

    return this.identityLimiter.consume(normalizedIdentity);
  }
}
