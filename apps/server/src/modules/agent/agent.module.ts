import { AgentContextController } from '../../platform/agent/agent-context.controller.js';
import { Module } from '@nestjs/common';
import type { ExecuteRequest } from './agent-runtime.port.js';

import {
  APPLICATION_OPTIONS,
  type ResolvedApplicationOptions,
} from '../../platform/application-options.js';
import {
  AgentServiceClient,
  AgentServiceClientError,
} from '../../platform/agent/python-agent.client.js';
import { PrismaAgentPersistence } from '../../platform/agent/prisma-agent.persistence.js';
import { PrismaAgentActionExecutionAdapter } from '../../platform/agent/prisma-agent-action-execution.adapter.js';
import { PrismaAgentRecoveryAdapter } from '../../platform/agent/prisma-agent-recovery.adapter.js';
import { PrismaSmartInboxReadAdapter } from '../../platform/agent/prisma-smart-inbox-read.adapter.js';
import { PgBossAgentJobQueueAdapter } from '../../platform/queue/agent-job-queue.adapter.js';
import {
  AGENT_RECOVERY_OPTIONS,
  AgentRecoveryCoordinator,
} from '../../platform/queue/agent-recovery.coordinator.js';
import { AgentQueueRuntime } from '../../platform/queue/agent-queue.runtime.js';
import { PgBossQueue } from '../../platform/queue/pg-boss.queue.js';
import { UsersModule } from '../users/users.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AGENT_ACTION_EXECUTION_PORT } from './agent-action-execution.port.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import { AGENT_ADMISSION_PORT } from './agent-admission.port.js';
import { AgentAdmissionService } from './agent-admission.service.js';
import { AGENT_APPLICATION_PORT } from './agent-application.port.js';
import { AgentApplicationService } from './agent-application.service.js';
import { AGENT_JOB_QUEUE_PORT } from './agent-job-queue.port.js';
import { AGENT_PRODUCT_PORT, AGENT_RUNTIME_AVAILABILITY } from './agent-product.port.js';
import { AGENT_INFERENCE_PORT, AGENT_RUN_PORT } from './agent-runtime.port.js';
import { AgentWorker } from './agent-worker.js';
import { AGENT_RECOVERY_PORT } from './agent-recovery.port.js';
import { AgentController } from './agent.controller.js';
import { SMART_INBOX_READ_PORT } from './smart-inbox.port.js';
import { SmartInboxService } from './smart-inbox.service.js';

@Module({
  imports: [UsersModule, TasksModule, ProjectsModule],
  controllers: [AgentController, AgentContextController],
  providers: [
    AgentAdmissionService,
    AgentApplicationService,
    AgentActionExecutor,
    SmartInboxService,
    AgentWorker,
    PrismaAgentPersistence,
    PrismaAgentActionExecutionAdapter,
    PrismaAgentRecoveryAdapter,
    PrismaSmartInboxReadAdapter,
    PgBossAgentJobQueueAdapter,
    AgentRecoveryCoordinator,
    AgentQueueRuntime,
    {
      provide: AGENT_RUNTIME_AVAILABILITY,
      inject: [APPLICATION_OPTIONS],
      useFactory: (options: ResolvedApplicationOptions) => ({
        available:
          options.agentService !== undefined && options.agentContextServiceToken !== undefined,
      }),
    },
    {
      provide: AGENT_INFERENCE_PORT,
      inject: [APPLICATION_OPTIONS],
      useFactory: (options: ResolvedApplicationOptions) =>
        options.agentService
          ? new AgentServiceClient(options.agentService)
          : new DisabledAgentInference(),
    },
    {
      provide: PgBossQueue,
      inject: [APPLICATION_OPTIONS],
      useFactory: (options: ResolvedApplicationOptions) => new PgBossQueue(options.databaseUrl),
    },
    {
      provide: AGENT_RECOVERY_OPTIONS,
      inject: [APPLICATION_OPTIONS],
      useFactory: (options: ResolvedApplicationOptions) => options.agentRecovery,
    },
    { provide: AGENT_ADMISSION_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_PRODUCT_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_RUN_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_RECOVERY_PORT, useExisting: PrismaAgentRecoveryAdapter },
    { provide: AGENT_JOB_QUEUE_PORT, useExisting: PgBossAgentJobQueueAdapter },
    { provide: AGENT_ACTION_EXECUTION_PORT, useExisting: PrismaAgentActionExecutionAdapter },
    { provide: SMART_INBOX_READ_PORT, useExisting: PrismaSmartInboxReadAdapter },
    { provide: AGENT_APPLICATION_PORT, useExisting: AgentApplicationService },
  ],
})
export class AgentModule {}

class DisabledAgentInference {
  execute(request: ExecuteRequest): Promise<never> {
    void request;
    return Promise.reject(new AgentServiceClientError('UNAVAILABLE'));
  }
}
