import { Module } from '@nestjs/common';
import type { ExecuteRequest } from '@ai-schedule/contracts/internal-agent/v1';

import {
  APPLICATION_OPTIONS,
  type ResolvedApplicationOptions,
} from '../../platform/application-options.js';
import {
  AgentServiceClient,
  AgentServiceClientError,
} from '../../platform/agent/python-agent.client.js';
import { PrismaAgentPersistence } from '../../platform/agent/prisma-agent.persistence.js';
import { PgBossAgentJobQueueAdapter } from '../../platform/queue/agent-job-queue.adapter.js';
import { AgentQueueRuntime } from '../../platform/queue/agent-queue.runtime.js';
import { PgBossQueue } from '../../platform/queue/pg-boss.queue.js';
import { UsersModule } from '../users/users.module.js';
import { AGENT_ADMISSION_PORT } from './agent-admission.port.js';
import { AgentAdmissionService } from './agent-admission.service.js';
import { AGENT_APPLICATION_PORT } from './agent-application.port.js';
import { AgentApplicationService } from './agent-application.service.js';
import { AGENT_JOB_QUEUE_PORT } from './agent-job-queue.port.js';
import { AGENT_PRODUCT_PORT, AGENT_RUNTIME_AVAILABILITY } from './agent-product.port.js';
import { AGENT_INFERENCE_PORT, AGENT_RUN_PORT } from './agent-runtime.port.js';
import { AgentWorker } from './agent-worker.js';
import { AgentController } from './agent.controller.js';

@Module({
  imports: [UsersModule],
  controllers: [AgentController],
  providers: [
    AgentAdmissionService,
    AgentApplicationService,
    AgentWorker,
    PrismaAgentPersistence,
    PgBossAgentJobQueueAdapter,
    AgentQueueRuntime,
    {
      provide: AGENT_RUNTIME_AVAILABILITY,
      inject: [APPLICATION_OPTIONS],
      useFactory: (options: ResolvedApplicationOptions) => ({
        available: options.agentService !== undefined,
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
    { provide: AGENT_ADMISSION_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_PRODUCT_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_RUN_PORT, useExisting: PrismaAgentPersistence },
    { provide: AGENT_JOB_QUEUE_PORT, useExisting: PgBossAgentJobQueueAdapter },
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
