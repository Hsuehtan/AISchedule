import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { contextReadRequestSchema } from '@ai-schedule/contracts/internal-agent/v2';
import { APPLICATION_OPTIONS, type ResolvedApplicationOptions } from '../application-options.js';
import { DatabaseUnitOfWork } from '../database/unit-of-work.js';
import { ApiHttpException } from '../http/api-http.exception.js';
import { PrismaAgentPersistence } from './prisma-agent.persistence.js';

@Controller('internal/v2/agent/context')
export class AgentContextController {
  constructor(
    @Inject(APPLICATION_OPTIONS) private readonly options: ResolvedApplicationOptions,
    @Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork,
    @Inject(PrismaAgentPersistence) private readonly persistence: PrismaAgentPersistence,
  ) {}

  @Post('read')
  @HttpCode(200)
  async read(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const token = this.options.agentContextServiceToken;
    const supplied = Buffer.from(authorization ?? '');
    const expected = Buffer.from(`Bearer ${token ?? ''}`);
    if (!token || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ApiHttpException(401, 'AGENT_CONTEXT_UNAUTHORIZED', '服务认证失败');
    }
    const parsed = contextReadRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new ApiHttpException(422, 'AGENT_CONTEXT_INVALID_REQUEST', '上下文请求无效');
    return this.unitOfWork.run((scope) => this.persistence.context.read(scope, parsed.data, token));
  }
}
