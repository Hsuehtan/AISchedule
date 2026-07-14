import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiHttpException } from './api-http.exception.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(allowedOrigins: readonly string[]) {
    this.allowedOrigins = new Set(allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    if (origin === undefined) {
      if (request.headers.cookie === undefined) return true;
      throw new ApiHttpException(
        HttpStatus.FORBIDDEN,
        'ORIGIN_REQUIRED',
        '携带 Cookie 的写请求必须提供 Origin',
      );
    }
    if (this.allowedOrigins.has(origin)) return true;

    throw new ApiHttpException(HttpStatus.FORBIDDEN, 'ORIGIN_NOT_ALLOWED', '请求来源不被允许');
  }
}
