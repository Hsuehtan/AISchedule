import {
  actionProposalCancelInputSchema,
  actionProposalConfirmInputSchema,
  actionProposalDismissInputSchema,
  actionProposalEditInputSchema,
  actionProposalIdSchema,
  agentMessageIdSchema,
  agentRequestIdSchema,
  agentTurnInputSchema,
  agentWriteHeadersSchema,
  conversationIdSchema,
  conversationMessagesQuerySchema,
  conversationViewedInputSchema,
  messageAnswerInputSchema,
  planGenerationInputSchema,
  smartInboxOrganizeInputSchema,
  smartInboxQuerySchema,
  type ActionProposalConfirmResponse,
  type ActionProposalMutationResponse,
  type ActionProposalResponse,
  type AgentRequestResponse,
  type AgentTurnQueuedResponse,
  type ConversationMessagesResponse,
  type ConversationViewedResponse,
  type MessageAnswerResponse,
  type PlanGenerationQueuedResponse,
  type SmartInboxOrganizeQueuedResponse,
  type SmartInboxResponse,
} from '@ai-schedule/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { parseRequest } from '../../platform/http/zod-parse.js';
import { requireIdempotencyKey } from '../../platform/idempotency/idempotency.service.js';
import { AuthGuard, type AuthenticatedUserContext } from '../users/auth.guard.js';
import { CurrentUser } from '../users/current-user.js';
import { AGENT_APPLICATION_PORT, type AgentApplicationPort } from './agent-application.port.js';
import { callAgentApplication } from './agent-http-error.adapter.js';

@Controller()
@UseGuards(AuthGuard)
export class AgentController {
  constructor(@Inject(AGENT_APPLICATION_PORT) private readonly application: AgentApplicationPort) {}

  @Post('agent/turns')
  @HttpCode(HttpStatus.ACCEPTED)
  createTurn(
    @CurrentUser() user: AuthenticatedUserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<AgentTurnQueuedResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const input = parseRequest(agentTurnInputSchema, body);
    return callAgentApplication(() =>
      this.application.createTurn({
        userId: user.id,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Post('agent/plan-generations')
  @HttpCode(HttpStatus.ACCEPTED)
  generatePlan(
    @CurrentUser() user: AuthenticatedUserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<PlanGenerationQueuedResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const input = parseRequest(planGenerationInputSchema, body);
    return callAgentApplication(() =>
      this.application.generatePlan({
        userId: user.id,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Get('agent/requests/:id')
  getRequest(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
  ): Promise<AgentRequestResponse> {
    const requestId = parseRequest(agentRequestIdSchema, id);
    return callAgentApplication(() => this.application.getRequest({ userId: user.id, requestId }));
  }

  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Query() rawQuery: unknown,
  ): Promise<ConversationMessagesResponse> {
    const conversationId = parseRequest(conversationIdSchema, id);
    const query = parseRequest(conversationMessagesQuerySchema, rawQuery);
    return callAgentApplication(() =>
      this.application.listMessages({ userId: user.id, conversationId, query }),
    );
  }

  @Post('conversations/:id/viewed')
  @HttpCode(HttpStatus.OK)
  markConversationViewed(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ConversationViewedResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const conversationId = parseRequest(conversationIdSchema, id);
    const input = parseRequest(conversationViewedInputSchema, body);
    return callAgentApplication(() =>
      this.application.markConversationViewed({
        userId: user.id,
        conversationId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Post('conversations/:id/messages/:messageId/answers')
  @HttpCode(HttpStatus.OK)
  async answerMessage(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Param('messageId') rawMessageId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MessageAnswerResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const conversationId = parseRequest(conversationIdSchema, id);
    const messageId = parseRequest(agentMessageIdSchema, rawMessageId);
    const input = parseRequest(messageAnswerInputSchema, body);
    const response = await callAgentApplication(() =>
      this.application.answerMessage({
        userId: user.id,
        conversationId,
        messageId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
    reply.status(response.outcome === 'QUEUED' ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return response;
  }

  @Patch('action-proposals/:id')
  editProposal(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ActionProposalMutationResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const proposalId = parseRequest(actionProposalIdSchema, id);
    const input = parseRequest(actionProposalEditInputSchema, body);
    return callAgentApplication(() =>
      this.application.editProposal({
        userId: user.id,
        proposalId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Get('action-proposals/:id')
  getProposal(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
  ): Promise<ActionProposalResponse> {
    const proposalId = parseRequest(actionProposalIdSchema, id);
    return callAgentApplication(() =>
      this.application.getProposal({ userId: user.id, proposalId }),
    );
  }

  @Post('action-proposals/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismissProposal(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ActionProposalMutationResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const proposalId = parseRequest(actionProposalIdSchema, id);
    const input = parseRequest(actionProposalDismissInputSchema, body);
    return callAgentApplication(() =>
      this.application.dismissProposal({
        userId: user.id,
        proposalId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Post('action-proposals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelProposal(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ActionProposalMutationResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const proposalId = parseRequest(actionProposalIdSchema, id);
    const input = parseRequest(actionProposalCancelInputSchema, body);
    return callAgentApplication(() =>
      this.application.cancelProposal({
        userId: user.id,
        proposalId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Post('action-proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmProposal(
    @CurrentUser() user: AuthenticatedUserContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ActionProposalConfirmResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const proposalId = parseRequest(actionProposalIdSchema, id);
    const input = parseRequest(actionProposalConfirmInputSchema, body);
    return callAgentApplication(() =>
      this.application.confirmProposal({
        userId: user.id,
        proposalId,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  @Get('smart-inbox')
  getSmartInbox(
    @CurrentUser() user: AuthenticatedUserContext,
    @Query() rawQuery: unknown,
  ): Promise<SmartInboxResponse> {
    const query = parseRequest(smartInboxQuerySchema, rawQuery);
    return callAgentApplication(() => this.application.getSmartInbox({ userId: user.id, query }));
  }

  @Post('smart-inbox/organize')
  @HttpCode(HttpStatus.ACCEPTED)
  organizeSmartInbox(
    @CurrentUser() user: AuthenticatedUserContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<SmartInboxOrganizeQueuedResponse> {
    const headers = this.parseWriteHeaders(idempotencyKey);
    const input = parseRequest(smartInboxOrganizeInputSchema, body);
    return callAgentApplication(() =>
      this.application.organizeSmartInbox({
        userId: user.id,
        idempotencyKey: headers.idempotencyKey,
        input,
      }),
    );
  }

  private parseWriteHeaders(idempotencyKey: string | undefined) {
    return parseRequest(agentWriteHeadersSchema, {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
  }
}
