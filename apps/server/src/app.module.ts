import { DynamicModule, Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ApplicationConfigModule } from './platform/application-config.module.js';
import {
  resolveApplicationOptions,
  type ApplicationOptions,
} from './platform/application-options.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { loadRuntimeConfiguration } from './runtime-config.js';

@Module({
  controllers: [HealthController],
})
export class AppModule {
  static register(options: ApplicationOptions): DynamicModule {
    const resolved = resolveApplicationOptions(options);
    const runtime = loadRuntimeConfiguration(resolved.configRoot);

    return {
      module: AppModule,
      imports: [
        ApplicationConfigModule.register(resolved, runtime),
        DatabaseModule.register(resolved.databaseUrl),
        UsersModule,
        TasksModule,
        ProjectsModule,
        AgentModule,
      ],
    };
  }
}
