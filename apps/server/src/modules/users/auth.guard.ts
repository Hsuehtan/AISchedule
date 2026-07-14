import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { AuthService, SESSION_COOKIE_NAME } from './auth.service.js';

export interface AuthenticatedUserContext {
  readonly id: string;
  readonly credentialVersion: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUser?: AuthenticatedUserContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.auth.resolveSession(request.cookies[SESSION_COOKIE_NAME]);
    if (!session) {
      throw new ApiHttpException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }

    request.authenticatedUser = {
      id: session.userId,
      credentialVersion: session.credentialVersion,
    };
    return true;
  }
}
