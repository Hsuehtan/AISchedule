import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../platform/idempotency/idempotency.module.js';
import { UsersModule } from '../users/users.module.js';
import { AGENT_TASKS_PORT } from './agent-tasks.port.js';
import { PrismaAgentTasksAdapter } from './prisma-agent-tasks.adapter.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [UsersModule, IdempotencyModule],
  controllers: [TasksController],
  providers: [
    TasksService,
    PrismaAgentTasksAdapter,
    { provide: AGENT_TASKS_PORT, useExisting: PrismaAgentTasksAdapter },
  ],
  exports: [AGENT_TASKS_PORT],
})
export class TasksModule {}
