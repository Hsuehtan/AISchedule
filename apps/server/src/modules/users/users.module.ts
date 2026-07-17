import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { AI_POINTS_PORT } from './points/ai-points.port.js';
import { AiPointsService } from './points/ai-points.service.js';
import { CapabilityRegistryService } from './points/capability-registry.service.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    AuthGuard,
    PasswordService,
    CapabilityRegistryService,
    AiPointsService,
    { provide: AI_POINTS_PORT, useExisting: AiPointsService },
  ],
  exports: [AuthService, AuthGuard, AI_POINTS_PORT],
})
export class UsersModule {}
