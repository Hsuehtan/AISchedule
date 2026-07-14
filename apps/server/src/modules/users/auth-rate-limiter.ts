export interface AuthRateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

interface RateLimitWindow {
  count: number;
  startedAt: number;
}

export class AuthRateLimiter {
  private readonly attempts = new Map<string, RateLimitWindow>();
  private readonly now: () => number;

  constructor(private readonly options: AuthRateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    const existing = this.attempts.get(key);
    const window =
      existing && now - existing.startedAt < this.options.windowMs
        ? existing
        : { count: 0, startedAt: now };

    window.count += 1;
    this.attempts.set(key, window);

    if (window.count <= this.options.limit) return { allowed: true, retryAfterSeconds: 0 };

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.options.windowMs - now) / 1_000)),
    };
  }
}
