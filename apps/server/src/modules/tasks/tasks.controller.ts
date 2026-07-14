import {
  createTaskInputSchema,
  taskIdSchema,
  taskListQuerySchema,
  undoOperationIdSchema,
  updateTaskInputSchema,
  versionCommandSchema,
} from '@ai-schedule/contracts';
import {
  Body,
  Controller,
  Delete,
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
import { TasksService } from './tasks.service.js';

@Controller()
@UseGuards(AuthGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Post('tasks')
  create(
    @CurrentUser() user: AuthenticatedUserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.tasks.create(
      user.id,
      requireIdempotencyKey(idempotencyKey),
      parseRequest(createTaskInputSchema, body),
    );
  }

  @Get('tasks')
  list(@CurrentUser() user: AuthenticatedUserContext, @Query() query: unknown) {
    return this.tasks.list(user.id, parseRequest(taskListQuerySchema, query));
  }

  @Get('tasks/:id')
  get(@CurrentUser() user: AuthenticatedUserContext, @Param('id') id: string) {
    return this.tasks.get(user.id, parseRequest(taskIdSchema, id));
  }

  @Patch('tasks/:id')
  update(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.tasks.update(
      user.id,
      parseRequest(taskIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      parseRequest(updateTaskInputSchema, body),
    );
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseRequest(versionCommandSchema, body);
    return this.tasks.complete(
      user.id,
      parseRequest(taskIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      input.version,
    );
  }

  @Post('tasks/:id/restore')
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parseRequest(versionCommandSchema, body);
    return this.tasks.restore(
      user.id,
      parseRequest(taskIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      input.version,
    );
  }

  @Delete('tasks/:id')
  @HttpCode(200)
  softDelete(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Query() query: Record<string, unknown>,
  ) {
    const input = parseRequest(versionCommandSchema, { version: Number(query.version) });
    return this.tasks.softDelete(
      user.id,
      parseRequest(taskIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
      input.version,
    );
  }

  @Post('undo-operations/:id/execute')
  @HttpCode(200)
  executeUndo(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.tasks.executeDeleteUndo(
      user.id,
      parseRequest(undoOperationIdSchema, id),
      requireIdempotencyKey(idempotencyKey),
    );
  }
}
