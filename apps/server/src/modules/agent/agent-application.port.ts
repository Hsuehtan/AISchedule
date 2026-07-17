import type {
  ActionProposalConfirmInput,
  ActionProposalConfirmResponse,
  ActionProposalEditInput,
  ActionProposalMutationResponse,
  ActionProposalCancelInput,
  ActionProposalDismissInput,
  ActionProposalId,
  AgentMessageId,
  AgentRequestId,
  AgentRequestResponse,
  AgentTurnInput,
  AgentTurnQueuedResponse,
  ConversationId,
  ConversationMessagesQuery,
  ConversationMessagesResponse,
  ConversationViewedInput,
  ConversationViewedResponse,
  MessageAnswerInput,
  MessageAnswerResponse,
  PlanGenerationInput,
  PlanGenerationQueuedResponse,
  SmartInboxOrganizeInput,
  SmartInboxOrganizeQueuedResponse,
  SmartInboxQuery,
  SmartInboxResponse,
} from '@ai-schedule/contracts';

export const AGENT_APPLICATION_PORT = Symbol('AgentApplicationPort');

type UserCommand<TInput> = Readonly<{
  userId: string;
  idempotencyKey: string;
  input: TInput;
}>;

export interface AgentApplicationPort {
  createTurn(command: UserCommand<AgentTurnInput>): Promise<AgentTurnQueuedResponse>;
  generatePlan(command: UserCommand<PlanGenerationInput>): Promise<PlanGenerationQueuedResponse>;
  getRequest(
    query: Readonly<{ userId: string; requestId: AgentRequestId }>,
  ): Promise<AgentRequestResponse>;
  listMessages(
    query: Readonly<{
      userId: string;
      conversationId: ConversationId;
      query: ConversationMessagesQuery;
    }>,
  ): Promise<ConversationMessagesResponse>;
  markConversationViewed(
    command: UserCommand<ConversationViewedInput> & Readonly<{ conversationId: ConversationId }>,
  ): Promise<ConversationViewedResponse>;
  answerMessage(
    command: UserCommand<MessageAnswerInput> &
      Readonly<{
        conversationId: ConversationId;
        messageId: AgentMessageId;
      }>,
  ): Promise<MessageAnswerResponse>;
  editProposal(
    command: UserCommand<ActionProposalEditInput> & Readonly<{ proposalId: ActionProposalId }>,
  ): Promise<ActionProposalMutationResponse>;
  dismissProposal(
    command: UserCommand<ActionProposalDismissInput> & Readonly<{ proposalId: ActionProposalId }>,
  ): Promise<ActionProposalMutationResponse>;
  cancelProposal(
    command: UserCommand<ActionProposalCancelInput> & Readonly<{ proposalId: ActionProposalId }>,
  ): Promise<ActionProposalMutationResponse>;
  confirmProposal(
    command: UserCommand<ActionProposalConfirmInput> & Readonly<{ proposalId: ActionProposalId }>,
  ): Promise<ActionProposalConfirmResponse>;
  getSmartInbox(
    query: Readonly<{ userId: string; query: SmartInboxQuery }>,
  ): Promise<SmartInboxResponse>;
  organizeSmartInbox(
    command: UserCommand<SmartInboxOrganizeInput>,
  ): Promise<SmartInboxOrganizeQueuedResponse>;
}
