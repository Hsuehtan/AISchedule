import {
  archiveProjectInputSchema,
  createProjectInputSchema,
  projectIdSchema,
  projectListQuerySchema,
  updateProjectInputSchema,
} from '@ai-schedule/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { parseRequest } from '../../platform/http/zod-parse.js';
import { requireIdempotencyKey } from '../../platform/idempotency/idempotency.service.js';
import { AuthGuard, type AuthenticatedUserContext } from '../users/auth.guard.js';
import { CurrentUser } from '../users/current-user.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.projects.create(
      user.id,
      requireIdempotencyKey(idempotencyKey),
      parseRequest(createProjectInputSchema, body),
    );
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUserContext, @Query() query: unknown) {
    return this.projects.list(user.id, parseRequest(projectListQuerySchema, query));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.projects.update(
      user.id,
      parseRequest(projectIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      parseRequest(updateProjectInputSchema, body),
    );
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.projects.archive(
      user.id,
      parseRequest(projectIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      parseRequest(archiveProjectInputSchema, body),
    );
  }
}
