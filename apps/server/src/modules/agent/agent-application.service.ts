import type {
  ActionProposalConfirmResponse,
  ActionProposalMutationResponse,
  ActionProposalResponse,
  AgentRequestResponse,
  AgentTurnQueuedResponse,
  ConversationMessagesResponse,
  ConversationViewedResponse,
  MessageAnswerResponse,
  PlanGenerationQueuedResponse,
  SmartInboxOrganizeQueuedResponse,
  SmartInboxResponse,
} from '@ai-schedule/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';
import { UNIT_OF_WORK, type UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AgentAdmissionService } from './agent-admission.service.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import type { AgentApplicationPort } from './agent-application.port.js';
import {
  AGENT_PRODUCT_PORT,
  AGENT_RUNTIME_AVAILABILITY,
  type AgentProductPort,
  type AgentRuntimeAvailability,
} from './agent-product.port.js';
import { SmartInboxService } from './smart-inbox.service.js';

@Injectable()
export class AgentApplicationService implements AgentApplicationPort {
  constructor(
    @Inject(AgentAdmissionService) private readonly admission: AgentAdmissionService,
    @Inject(AGENT_PRODUCT_PORT) private readonly products: AgentProductPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(AGENT_RUNTIME_AVAILABILITY)
    private readonly runtimeAvailability: AgentRuntimeAvailability,
    @Inject(AgentActionExecutor) private readonly actionExecutor: AgentActionExecutor,
    @Inject(SmartInboxService) private readonly smartInbox: SmartInboxService,
  ) {}

  createTurn(
    command: Parameters<AgentApplicationPort['createTurn']>[0],
  ): Promise<AgentTurnQueuedResponse> {
    this.assertRuntimeAvailable();
    return this.admission.createTurn(command);
  }

  generatePlan(
    command: Parameters<AgentApplicationPort['generatePlan']>[0],
  ): Promise<PlanGenerationQueuedResponse> {
    this.assertRuntimeAvailable();
    return this.admission.generatePlan(command);
  }

  getRequest(
    query: Parameters<AgentApplicationPort['getRequest']>[0],
  ): Promise<AgentRequestResponse> {
    return this.products.getRequest(query);
  }

  listMessages(
    query: Parameters<AgentApplicationPort['listMessages']>[0],
  ): Promise<ConversationMessagesResponse> {
    return this.products.listMessages(query);
  }

  markConversationViewed(
    command: Parameters<AgentApplicationPort['markConversationViewed']>[0],
  ): Promise<ConversationViewedResponse> {
    return this.unitOfWork.run((scope) =>
      this.products.markConversationViewed(scope, {
        userId: command.userId,
        conversationId: command.conversationId,
        idempotencyKey: command.idempotencyKey,
        request: command.input,
      }),
    );
  }

  answerMessage(
    command: Parameters<AgentApplicationPort['answerMessage']>[0],
  ): Promise<MessageAnswerResponse> {
    return this.answerMessageResolved(command);
  }

  getProposal(
    query: Parameters<AgentApplicationPort['getProposal']>[0],
  ): Promise<ActionProposalResponse> {
    return this.products.getProposal(query);
  }

  editProposal(
    command: Parameters<AgentApplicationPort['editProposal']>[0],
  ): Promise<ActionProposalMutationResponse> {
    return this.unitOfWork.run((scope) =>
      this.products.editProposal(scope, {
        userId: command.userId,
        proposalId: command.proposalId,
        idempotencyKey: command.idempotencyKey,
        request: command.input,
      }),
    );
  }

  dismissProposal(
    command: Parameters<AgentApplicationPort['dismissProposal']>[0],
  ): Promise<ActionProposalMutationResponse> {
    return this.unitOfWork.run((scope) =>
      this.products.dismissProposal(scope, {
        userId: command.userId,
        proposalId: command.proposalId,
        idempotencyKey: command.idempotencyKey,
        request: command.input,
      }),
    );
  }

  cancelProposal(
    command: Parameters<AgentApplicationPort['cancelProposal']>[0],
  ): Promise<ActionProposalMutationResponse> {
    return this.unitOfWork.run((scope) =>
      this.products.cancelProposal(scope, {
        userId: command.userId,
        proposalId: command.proposalId,
        idempotencyKey: command.idempotencyKey,
        request: command.input,
      }),
    );
  }

  confirmProposal(
    command: Parameters<AgentApplicationPort['confirmProposal']>[0],
  ): Promise<ActionProposalConfirmResponse> {
    return this.actionExecutor.confirm({
      userId: command.userId,
      proposalId: command.proposalId,
      proposalVersion: command.input.version,
      idempotencyKey: command.idempotencyKey,
    });
  }

  getSmartInbox(
    query: Parameters<AgentApplicationPort['getSmartInbox']>[0],
  ): Promise<SmartInboxResponse> {
    return this.smartInbox.get(query);
  }

  organizeSmartInbox(
    command: Parameters<AgentApplicationPort['organizeSmartInbox']>[0],
  ): Promise<SmartInboxOrganizeQueuedResponse> {
    return this.organizeSmartInboxResolved(command);
  }

  private assertRuntimeAvailable(): void {
    if (!this.runtimeAvailability.available) {
      throw new ApiHttpException(503, 'AGENT_SERVICE_UNAVAILABLE', '智能处理暂不可用');
    }
  }

  private async answerMessageResolved(
    command: Parameters<AgentApplicationPort['answerMessage']>[0],
  ): Promise<MessageAnswerResponse> {
    const replay = await this.products.replayAnswer({
      userId: command.userId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      idempotencyKey: command.idempotencyKey,
      request: command.input,
    });
    if (replay) return replay;
    const resolution = await this.products.inspectAnswer({
      userId: command.userId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      request: command.input,
    });
    if (resolution.nextStep === 'DETERMINISTIC') {
      return this.unitOfWork.run((scope) =>
        this.products.answerDeterministically(scope, {
          userId: command.userId,
          conversationId: command.conversationId,
          messageId: command.messageId,
          idempotencyKey: command.idempotencyKey,
          request: command.input,
        }),
      );
    }
    this.assertRuntimeAvailable();
    const request = await this.admission.answerMessage({
      userId: command.userId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      idempotencyKey: command.idempotencyKey,
      input: command.input,
      nextStep: resolution.nextStep,
    });
    return { outcome: 'QUEUED', request };
  }

  private async organizeSmartInboxResolved(
    command: Parameters<AgentApplicationPort['organizeSmartInbox']>[0],
  ): Promise<SmartInboxOrganizeQueuedResponse> {
    await this.smartInbox.assertOrganizeEligible({
      userId: command.userId,
      scope: command.input.scope,
    });
    this.assertRuntimeAvailable();
    return this.admission.organize(command);
  }
}
