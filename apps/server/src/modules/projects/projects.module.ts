import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../platform/idempotency/idempotency.module.js';
import { UsersModule } from '../users/users.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [UsersModule, IdempotencyModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
