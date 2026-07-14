import { Controller, Get, HttpStatus, Inject, UseGuards } from '@nestjs/common';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { AuthGuard, type AuthenticatedUserContext } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.js';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('me')
  async me(@CurrentUser() currentUser: AuthenticatedUserContext) {
    const user = await this.auth.getUser(currentUser.id);
    if (!user) {
      throw new ApiHttpException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }
    return { user };
  }
}
