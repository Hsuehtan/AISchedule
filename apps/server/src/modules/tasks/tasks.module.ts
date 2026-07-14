import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../platform/idempotency/idempotency.module.js';
import { UsersModule } from '../users/users.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [UsersModule, IdempotencyModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
