import type {
  ActionProposalEditInput,
  ActionProposalMutationResponse,
  ActionProposalResponse,
  ActionProposalCancelInput,
  ActionProposalDismissInput,
  AgentRequestResponse,
  ConversationMessagesQuery,
  ConversationMessagesResponse,
  ConversationViewedInput,
  ConversationViewedResponse,
  MessageAnswerInput,
  MessageAnswerResponse,
} from '@ai-schedule/contracts';

import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_PRODUCT_PORT = Symbol('AgentProductPort');
export const AGENT_RUNTIME_AVAILABILITY = Symbol('AgentRuntimeAvailability');

export interface AgentRuntimeAvailability {
  readonly available: boolean;
}

export interface AgentProductPort {
  replayAnswer(
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      idempotencyKey: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<MessageAnswerResponse | null>;
  inspectAnswer(
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<
    Readonly<{
      nextStep: 'DETERMINISTIC' | 'AGENT_PLAN_GENERATION' | 'AGENT_STANDARD_TURN';
    }>
  >;
  answerDeterministically(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      conversationId: string;
      messageId: string;
      idempotencyKey: string;
      request: MessageAnswerInput;
    }>,
  ): Promise<MessageAnswerResponse>;
  getRequest(input: Readonly<{ userId: string; requestId: string }>): Promise<AgentRequestResponse>;
  listMessages(
    input: Readonly<{
      userId: string;
      conversationId: string;
      query: ConversationMessagesQuery;
    }>,
  ): Promise<ConversationMessagesResponse>;
  markConversationViewed(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      conversationId: string;
      idempotencyKey: string;
      request: ConversationViewedInput;
    }>,
  ): Promise<ConversationViewedResponse>;
  getProposal(
    input: Readonly<{ userId: string; proposalId: string }>,
  ): Promise<ActionProposalResponse>;
  editProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: ActionProposalEditInput;
    }>,
  ): Promise<ActionProposalMutationResponse>;
  dismissProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: ActionProposalDismissInput;
    }>,
  ): Promise<ActionProposalMutationResponse>;
  cancelProposal(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      idempotencyKey: string;
      request: ActionProposalCancelInput;
    }>,
  ): Promise<ActionProposalMutationResponse>;
}
