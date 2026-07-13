import { z } from 'zod';

export const userIdSchema = z.uuid().brand<'UserId'>();
export const taskIdSchema = z.uuid().brand<'TaskId'>();
export const projectIdSchema = z.uuid().brand<'ProjectId'>();
export const conversationIdSchema = z.uuid().brand<'ConversationId'>();
export const agentRequestIdSchema = z.uuid().brand<'AgentRequestId'>();
export const actionProposalIdSchema = z.uuid().brand<'ActionProposalId'>();
export const undoOperationIdSchema = z.uuid().brand<'UndoOperationId'>();

export type UserId = z.infer<typeof userIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type ConversationId = z.infer<typeof conversationIdSchema>;
export type AgentRequestId = z.infer<typeof agentRequestIdSchema>;
export type ActionProposalId = z.infer<typeof actionProposalIdSchema>;
export type UndoOperationId = z.infer<typeof undoOperationIdSchema>;
