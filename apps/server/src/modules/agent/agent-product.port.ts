import type {
  AgentRequestResponse,
  ConversationMessagesQuery,
  ConversationMessagesResponse,
  ConversationViewedInput,
  ConversationViewedResponse,
} from '@ai-schedule/contracts';

import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_PRODUCT_PORT = Symbol('AgentProductPort');
export const AGENT_RUNTIME_AVAILABILITY = Symbol('AgentRuntimeAvailability');

export interface AgentRuntimeAvailability {
  readonly available: boolean;
}

export interface AgentProductPort {
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
}
