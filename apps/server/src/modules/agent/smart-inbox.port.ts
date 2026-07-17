import type { SmartInboxScope } from '@ai-schedule/contracts';

export const SMART_INBOX_READ_PORT = Symbol('SmartInboxReadPort');
export const SMART_INBOX_CLOCK = Symbol('SmartInboxClock');

export type SmartInboxResumeTarget = Readonly<{
  body: string;
  conversationId: string;
  messageId: string | null;
  occurredAt: Date;
  proposalId: string | null;
  requestId: string | null;
  title: string;
}>;

export type SmartInboxGlobalState = Readonly<{
  awaitingConfirmation: SmartInboxResumeTarget | null;
  awaitingClarification: SmartInboxResumeTarget | null;
  processing: SmartInboxResumeTarget | null;
  executionFailed: SmartInboxResumeTarget | null;
  unreadReply: SmartInboxResumeTarget | null;
}>;

export type SmartInboxScopeState = Readonly<{
  organizeCandidateCount: number;
  projectName: string | null;
  scope: SmartInboxScope;
  todoCount: number;
}>;

export interface SmartInboxReadPort {
  loadGlobalState(input: Readonly<{ now: Date; userId: string }>): Promise<SmartInboxGlobalState>;
  loadScopeState(
    input: Readonly<{ scope: SmartInboxScope; userId: string }>,
  ): Promise<SmartInboxScopeState>;
}
