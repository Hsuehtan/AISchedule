import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  loginWithUsernameSchema,
  normalizeUsername,
  registerWithUsernameSchema,
  type SessionResponse,
} from '@ai-schedule/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  APPLICATION_OPTIONS,
  type ResolvedApplicationOptions,
} from '../../platform/application-options.js';
import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { AuthRateLimitPolicy } from './auth-rate-limiter.js';
import {
  AuthService,
  SESSION_COOKIE_NAME,
  UsernameAlreadyExistsError,
  type IssuedSession,
} from './auth.service.js';
@Controller('auth')
export class AuthController {
  private readonly loginLimiter = new AuthRateLimitPolicy({
    ip: { limit: 50, windowMs: 15 * 60 * 1_000, maxEntries: 10_000 },
    identity: { limit: 10, windowMs: 15 * 60 * 1_000, maxEntries: 10_000 },
  });
  private readonly registerLimiter = new AuthRateLimitPolicy({
    ip: { limit: 10, windowMs: 60 * 60 * 1_000, maxEntries: 10_000 },
    identity: { limit: 5, windowMs: 60 * 60 * 1_000, maxEntries: 10_000 },
  });

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APPLICATION_OPTIONS) private readonly options: ResolvedApplicationOptions,
  ) {}

  @Post('username/register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = this.parseInput(registerWithUsernameSchema, body);
    this.consume(this.registerLimiter, request.ip, normalizeUsername(input.username));

    try {
      const issued = await this.auth.register(input);
      this.setSessionCookie(reply, issued);
      return { user: issued.user };
    } catch (error) {
      if (error instanceof UsernameAlreadyExistsError) {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'USERNAME_ALREADY_EXISTS',
          '用户名已被使用',
        );
      }
      throw error;
    }
  }

  @Post('username/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = this.parseInput(loginWithUsernameSchema, body);
    this.consume(this.loginLimiter, request.ip, normalizeUsername(input.username));
    const issued = await this.auth.login(input);

    if (!issued) {
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CREDENTIALS',
        '用户名或密码错误',
      );
    }

    this.setSessionCookie(reply, issued);
    return { user: issued.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.revokeSession(request.cookies[SESSION_COOKIE_NAME]);
    reply.clearCookie(SESSION_COOKIE_NAME, this.baseCookieOptions());
    return { loggedOut: true as const };
  }

  @Get('session')
  async session(@Req() request: FastifyRequest): Promise<SessionResponse> {
    const session = await this.auth.resolveSession(request.cookies[SESSION_COOKIE_NAME]);
    if (!session) return { authenticated: false, user: null, expiresAt: null };

    return {
      authenticated: true,
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  private parseInput<T>(schema: ZodType<T>, body: unknown): T {
    const candidate = this.normalizeUsernameField(body);
    const result = schema.safeParse(candidate);
    if (result.success) return result.data;

    throw new ApiHttpException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', '请检查输入', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  private normalizeUsernameField(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('username' in body)) return body;
    const username = (body as { username?: unknown }).username;
    if (typeof username !== 'string') return body;
    return { ...body, username: username.normalize('NFKC') };
  }

  private consume(limiter: AuthRateLimitPolicy, ip: string, normalizedUsername: string): void {
    const result = limiter.consume(ip, normalizedUsername);
    if (result.allowed) return;

    throw new ApiHttpException(
      HttpStatus.TOO_MANY_REQUESTS,
      'AUTH_RATE_LIMITED',
      '尝试次数过多，请稍后重试',
      {
        retryAfterSeconds: result.retryAfterSeconds,
      },
    );
  }

  private setSessionCookie(reply: FastifyReply, issued: IssuedSession): void {
    reply.setCookie(SESSION_COOKIE_NAME, issued.token, {
      ...this.baseCookieOptions(),
      expires: issued.expiresAt,
    });
  }

  private baseCookieOptions() {
    return {
      path: '/',
      httpOnly: true,
      secure: this.options.isProduction,
      sameSite: 'lax' as const,
    };
  }
}
