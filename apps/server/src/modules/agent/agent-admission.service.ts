import { randomUUID } from 'node:crypto';

import type {
  AgentTurnInput,
  AgentTurnQueuedResponse,
  MessageAnswerInput,
  PlanGenerationInput,
  SmartInboxOrganizeInput,
} from '@ai-schedule/contracts';
import { agentRequestIdSchema, conversationIdSchema } from '@ai-schedule/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/database/unit-of-work.js';
import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import {
  AI_POINTS_PORT,
  AiCapabilityUnavailableError,
  InsufficientAiPointsError,
  type AiPointsPort,
} from '../users/points/ai-points.port.js';
import {
  AGENT_ADMISSION_PORT,
  type AgentAdmissionPort,
  type AgentRunSource,
} from './agent-admission.port.js';
import { AGENT_JOB_QUEUE_PORT, type AgentJobQueuePort } from './agent-job-queue.port.js';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const RECOVERY_WAIT_MS = 60_000;
const CANDIDATE_RETENTION_AFTER_RECOVERY_MS = 60_000;
export const AGENT_ADMISSION_CLOCK = Symbol('AgentAdmissionClock');
export const AGENT_RUN_ID_FACTORY = Symbol('AgentRunIdFactory');

type AdmissionProfile = Readonly<{
  allowedResultTypes: readonly (
    | 'ACTION_PROPOSAL'
    | 'CANDIDATES'
    | 'CLARIFICATION'
    | 'PLAN'
    | 'REPLY'
  )[];
  capabilityCode: 'agent.planGeneration' | 'agent.standardTurn';
  endpointCode: 'agent.plan-generation' | 'agent.turn';
  executeTimeoutMs: number;
  idempotencyScope: string;
  runDeadlineMs: number;
}>;

const STANDARD_PROFILE: AdmissionProfile = {
  allowedResultTypes: ['REPLY', 'CLARIFICATION', 'CANDIDATES', 'ACTION_PROPOSAL'],
  capabilityCode: 'agent.standardTurn',
  endpointCode: 'agent.turn',
  executeTimeoutMs: 35_000,
  idempotencyScope: 'agent.turn',
  runDeadlineMs: 40_000,
};

const PLAN_PROFILE: AdmissionProfile = {
  allowedResultTypes: ['CLARIFICATION', 'PLAN'],
  capabilityCode: 'agent.planGeneration',
  endpointCode: 'agent.plan-generation',
  executeTimeoutMs: 65_000,
  idempotencyScope: 'agent.plan-generation',
  runDeadlineMs: 70_000,
};

const ORGANIZE_PROFILE: AdmissionProfile = {
  ...STANDARD_PROFILE,
  allowedResultTypes: ['ACTION_PROPOSAL'],
  idempotencyScope: 'smart-inbox.organize',
};

@Injectable()
export class AgentAdmissionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AI_POINTS_PORT) private readonly points: AiPointsPort,
    @Inject(AGENT_ADMISSION_PORT) private readonly persistence: AgentAdmissionPort,
    @Inject(AGENT_JOB_QUEUE_PORT) private readonly jobs: AgentJobQueuePort,
    @Optional()
    @Inject(AGENT_ADMISSION_CLOCK)
    private readonly now: () => Date = () => new Date(),
    @Optional()
    @Inject(AGENT_RUN_ID_FACTORY)
    private readonly createRunId: () => string = randomUUID,
  ) {}

  createTurn(
    input: Readonly<{
      userId: string;
      idempotencyKey: string;
      input: AgentTurnInput;
    }>,
  ): Promise<AgentTurnQueuedResponse> {
    return this.admit(input, STANDARD_PROFILE, { kind: 'TURN', input: input.input });
  }

  generatePlan(
    input: Readonly<{
      userId: string;
      idempotencyKey: string;
      input: PlanGenerationInput;
    }>,
  ): Promise<AgentTurnQueuedResponse> {
    return this.admit(input, PLAN_PROFILE, { kind: 'PLAN', input: input.input });
  }

  answerMessage(
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      idempotencyKey: string;
      input: MessageAnswerInput;
      nextStep: 'AGENT_PLAN_GENERATION' | 'AGENT_STANDARD_TURN';
    }>,
  ): Promise<AgentTurnQueuedResponse> {
    const profile = input.nextStep === 'AGENT_PLAN_GENERATION' ? PLAN_PROFILE : STANDARD_PROFILE;
    return this.admit(
      {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        input: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          ...input.input,
        },
      },
      { ...profile, idempotencyScope: 'agent.message-answer' },
      {
        kind: 'ANSWER',
        input: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          expectedNextStep: input.nextStep,
          answer: input.input,
        },
      },
    );
  }

  organize(
    input: Readonly<{
      userId: string;
      idempotencyKey: string;
      input: SmartInboxOrganizeInput;
    }>,
  ): Promise<AgentTurnQueuedResponse> {
    return this.admit(input, ORGANIZE_PROFILE, { kind: 'ORGANIZE', input: input.input });
  }

  private async admit(
    command: Readonly<{ userId: string; idempotencyKey: string; input: unknown }>,
    profile: AdmissionProfile,
    source: AgentRunSource,
  ): Promise<AgentTurnQueuedResponse> {
    const admittedAt = this.now();
    const runId = this.createRunId();
    const runDeadlineAt = new Date(admittedAt.getTime() + profile.runDeadlineMs);
    const recoveryEligibleAt = new Date(runDeadlineAt.getTime() + RECOVERY_WAIT_MS);

    try {
      return await this.unitOfWork.run(async (scope) => {
        const claim = await this.persistence.claimIdempotency(scope, {
          userId: command.userId,
          scope: profile.idempotencyScope,
          key: command.idempotencyKey,
          request: command.input,
          expiresAt: new Date(admittedAt.getTime() + IDEMPOTENCY_TTL_MS),
        });
        if (claim.kind === 'REPLAY') return claim.response;

        const created = await this.persistence.createRun(scope, {
          runId,
          userId: command.userId,
          idempotencyKey: command.idempotencyKey,
          capabilityCode: profile.capabilityCode,
          endpointCode: profile.endpointCode,
          allowedResultTypes: profile.allowedResultTypes,
          source,
          timing: {
            executeTimeoutAt: new Date(admittedAt.getTime() + profile.executeTimeoutMs),
            runDeadlineAt,
            recoveryEligibleAt,
            candidateExpiresAt: new Date(
              recoveryEligibleAt.getTime() + CANDIDATE_RETENTION_AFTER_RECOVERY_MS,
            ),
          },
        });
        const reservation = await this.points.reserve(scope, {
          userId: command.userId,
          capabilityCode: profile.capabilityCode,
          endpointCode: profile.endpointCode,
          requestId: runId,
        });
        await this.persistence.attachReservation(scope, {
          runId,
          userId: command.userId,
          reservationId: reservation.reservationId,
        });
        await this.jobs.enqueue(scope, { runId });

        const response: AgentTurnQueuedResponse = {
          requestId: agentRequestIdSchema.parse(runId),
          conversationId: conversationIdSchema.parse(created.conversationId),
          status: 'QUEUED',
          pollAfterMs: 1_000,
        };
        await this.persistence.completeIdempotency(scope, {
          userId: command.userId,
          scope: profile.idempotencyScope,
          key: command.idempotencyKey,
          response,
        });
        return response;
      });
    } catch (error) {
      if (error instanceof InsufficientAiPointsError) {
        throw new ApiHttpException(429, 'AGENT_POINTS_INSUFFICIENT', '今天的智能处理额度已用完', {
          canRetryTomorrow: true,
        });
      }
      if (error instanceof AiCapabilityUnavailableError) {
        throw new ApiHttpException(503, 'AGENT_CAPABILITY_DISABLED', '智能处理暂不可用');
      }
      throw error;
    }
  }
}
