import { z } from 'zod';

import { actionProposalIdSchema, projectIdSchema, taskIdSchema } from './ids.js';
import { createProjectInputSchema } from './projects.js';
import { createTaskInputSchema, updateTaskChangesSchema } from './tasks.js';

const utcDateTimeSchema = z.string().datetime({ offset: true });

export const agentRequestStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RESULT_PERSISTED',
  'SETTLING',
  'SUCCEEDED',
  'FAILED',
  'RELEASED',
]);

export const actionProposalStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'EXECUTED',
  'DISMISSED',
  'STALE',
]);

const createTaskMutationSchema = z
  .object({
    type: z.literal('CREATE_TASK'),
    clientRef: z.string().min(1).max(64),
    input: createTaskInputSchema,
  })
  .strict();

const updateTaskMutationSchema = z
  .object({
    type: z.literal('UPDATE_TASK'),
    taskId: taskIdSchema,
    expectedVersion: z.number().int().positive(),
    changes: updateTaskChangesSchema,
  })
  .strict();

const completeTaskMutationSchema = z
  .object({
    type: z.literal('COMPLETE_TASK'),
    taskId: taskIdSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

const createProjectMutationSchema = z
  .object({
    type: z.literal('CREATE_PROJECT'),
    clientRef: z.string().min(1).max(64),
    input: createProjectInputSchema,
  })
  .strict();

const assignProjectMutationSchema = z
  .object({
    type: z.literal('ASSIGN_PROJECT'),
    taskId: taskIdSchema,
    projectId: projectIdSchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const actionMutationSchema = z.discriminatedUnion('type', [
  createTaskMutationSchema,
  updateTaskMutationSchema,
  completeTaskMutationSchema,
  createProjectMutationSchema,
  assignProjectMutationSchema,
]);

export const actionProposalSchema = z
  .object({
    id: actionProposalIdSchema,
    status: actionProposalStatusSchema,
    summary: z.string().min(1).max(500),
    version: z.number().int().positive(),
    mutations: z.array(actionMutationSchema).min(1).max(50),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export type AgentRequestStatus = z.infer<typeof agentRequestStatusSchema>;
export type ActionMutation = z.infer<typeof actionMutationSchema>;
export type ActionProposal = z.infer<typeof actionProposalSchema>;
