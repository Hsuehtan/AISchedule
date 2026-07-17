import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../platform/idempotency/idempotency.module.js';
import { UsersModule } from '../users/users.module.js';
import { AGENT_PROJECTS_PORT } from './agent-projects.port.js';
import { PrismaAgentProjectsAdapter } from './prisma-agent-projects.adapter.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [UsersModule, IdempotencyModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    PrismaAgentProjectsAdapter,
    { provide: AGENT_PROJECTS_PORT, useExisting: PrismaAgentProjectsAdapter },
  ],
  exports: [AGENT_PROJECTS_PORT],
})
export class ProjectsModule {}
