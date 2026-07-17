// This file is generated from internal-agent/v1/openapi.yaml. Do not edit.
// Contract SHA-256: bb4002ea8d7488f6492c99f8bf191eb8791167059d14f2ec364cc3351dcd54ed
import { z } from 'zod';

export const MESSAGE_CONTENT_MAX_BYTES = 12288;
export const MAX_TASK_CANDIDATES = 50;
export const MAX_PROJECT_CANDIDATES = 30;

const unicodeCodePointLength = (value: string): number => Array.from(value).length;

export const resultTypeSchema = z.enum(["REPLY", "CLARIFICATION", "CANDIDATES", "PLAN", "ACTION_PROPOSAL"]);
export type ResultType = z.infer<typeof resultTypeSchema>;

export const capabilityCodeSchema = z.enum(["agent.standardTurn", "agent.planGeneration"]);
export type CapabilityCode = z.infer<typeof capabilityCodeSchema>;

export const messageRoleSchema = z.enum(["USER", "ASSISTANT"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const candidateKindSchema = z.enum(["TASK", "PROJECT"]);
export type CandidateKind = z.infer<typeof candidateKindSchema>;

export const prioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Priority = z.infer<typeof prioritySchema>;

export const nextStepSchema = z.enum(["DETERMINISTIC", "AGENT_STANDARD", "AGENT_PLAN"]);
export type NextStep = z.infer<typeof nextStepSchema>;

export const actionCodeSchema = z.enum(["CREATE_TASK", "CREATE_PROJECT_TASKS", "ORGANIZE_TASKS", "UPDATE_TASK", "COMPLETE_TASK", "RESTORE_TASK", "DELETE_TASK"]);
export type ActionCode = z.infer<typeof actionCodeSchema>;

export const healthResponseSchema = z.object({
  "status": z.enum(["ok"]),
}).strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorCodeSchema = z.enum(["UNAUTHORIZED", "REQUEST_TOO_LARGE", "VALIDATION_ERROR", "CONCURRENCY_LIMIT", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "PROVIDER_OUTPUT_INVALID", "INTERNAL_ERROR"]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const resolutionMetadataSchema = z.object({
  "provider": z.enum(["DEEPSEEK"]),
  "model": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 100, { message: 'Must contain at most 100 Unicode code point(s)' }),
  "promptVersion": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 64, { message: 'Must contain at most 64 Unicode code point(s)' }),
  "providerSchemaVersion": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 64, { message: 'Must contain at most 64 Unicode code point(s)' }),
  "repairAttempts": z.number().int().min(0).max(1),
}).strict();
export type ResolutionMetadata = z.infer<typeof resolutionMetadataSchema>;

export const replyResultSchema = z.object({
  "type": z.literal("REPLY"),
  "text": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 2000, { message: 'Must contain at most 2000 Unicode code point(s)' }),
  "offerPlan": z.boolean(),
}).strict();
export type ReplyResult = z.infer<typeof replyResultSchema>;

export const candidateOptionSchema = z.object({
  "optionId": z.string().regex(new RegExp("^opt_[a-f0-9]{16}$", 'u')),
  "candidateRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "label": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 200, { message: 'Must contain at most 200 Unicode code point(s)' }),
}).strict();
export type CandidateOption = z.infer<typeof candidateOptionSchema>;

export const noProjectSelectionSchema = z.object({
  "type": z.literal("NONE"),
}).strict();
export type NoProjectSelection = z.infer<typeof noProjectSelectionSchema>;

export const existingProjectSelectionSchema = z.object({
  "type": z.literal("EXISTING"),
  "candidateRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
}).strict();
export type ExistingProjectSelection = z.infer<typeof existingProjectSelectionSchema>;

export const newProjectSelectionSchema = z.object({
  "type": z.literal("NEW"),
  "name": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 50, { message: 'Must contain at most 50 Unicode code point(s)' }),
}).strict();
export type NewProjectSelection = z.infer<typeof newProjectSelectionSchema>;

export const organizeTaskMutationSchema = z.object({
  "operation": z.literal("ORGANIZE_TASK"),
  "targetRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "projectRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "expectedVersion": z.number().int().min(1),
}).strict();
export type OrganizeTaskMutation = z.infer<typeof organizeTaskMutationSchema>;

export const completeTaskMutationSchema = z.object({
  "operation": z.literal("COMPLETE_TASK"),
  "targetRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "expectedVersion": z.number().int().min(1),
}).strict();
export type CompleteTaskMutation = z.infer<typeof completeTaskMutationSchema>;

export const restoreTaskMutationSchema = z.object({
  "operation": z.literal("RESTORE_TASK"),
  "targetRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "expectedVersion": z.number().int().min(1),
}).strict();
export type RestoreTaskMutation = z.infer<typeof restoreTaskMutationSchema>;

export const deleteTaskMutationSchema = z.object({
  "operation": z.literal("DELETE_TASK"),
  "targetRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "expectedVersion": z.number().int().min(1),
}).strict();
export type DeleteTaskMutation = z.infer<typeof deleteTaskMutationSchema>;

export const errorDetailSchema = z.object({
  "code": errorCodeSchema,
  "message": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 160, { message: 'Must contain at most 160 Unicode code point(s)' }),
  "requestId": z.string().uuid().nullable().optional(),
}).strict();
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const internalMessageSchema = z.object({
  "role": messageRoleSchema,
  "content": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 4000, { message: 'Must contain at most 4000 Unicode code point(s)' }),
}).strict();
export type InternalMessage = z.infer<typeof internalMessageSchema>;

export const candidateContextSchema = z.object({
  "candidateRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "kind": candidateKindSchema,
  "label": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 200, { message: 'Must contain at most 200 Unicode code point(s)' }),
  "version": z.number().int().min(1),
  "priority": prioritySchema.nullable().optional(),
  "scheduledAt": z.string().datetime({ offset: true }).nullable().optional(),
  "deadlineAt": z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
export type CandidateContext = z.infer<typeof candidateContextSchema>;

export const clarificationOptionSchema = z.object({
  "optionId": z.string().regex(new RegExp("^opt_[a-f0-9]{16}$", 'u')),
  "label": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 120, { message: 'Must contain at most 120 Unicode code point(s)' }),
  "nextStep": nextStepSchema,
}).strict();
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>;

export const candidatesResultSchema = z.object({
  "type": z.literal("CANDIDATES"),
  "question": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 500, { message: 'Must contain at most 500 Unicode code point(s)' }),
  "options": z.array(candidateOptionSchema).min(2).max(10),
}).strict();
export type CandidatesResult = z.infer<typeof candidatesResultSchema>;

export const taskProjectSelectionSchema = z.discriminatedUnion("type", [noProjectSelectionSchema, existingProjectSelectionSchema]);
export type TaskProjectSelection = z.infer<typeof taskProjectSelectionSchema>;

export const planProjectSelectionSchema = z.discriminatedUnion("type", [existingProjectSelectionSchema, newProjectSelectionSchema]);
export type PlanProjectSelection = z.infer<typeof planProjectSelectionSchema>;

export const taskDraftSchema = z.object({
  "clientRef": z.string().regex(new RegExp("^draft_[a-f0-9]{16}$", 'u')),
  "title": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 200, { message: 'Must contain at most 200 Unicode code point(s)' }),
  "description": z.string().refine((value) => unicodeCodePointLength(value) <= 2000, { message: 'Must contain at most 2000 Unicode code point(s)' }).nullable(),
  "priority": prioritySchema,
  "scheduledAt": z.string().datetime({ offset: true }).nullable(),
  "deadlineAt": z.string().datetime({ offset: true }).nullable(),
  "reminderAt": z.string().datetime({ offset: true }).nullable(),
}).strict();
export type TaskDraft = z.infer<typeof taskDraftSchema>;

export const taskChangesSchema = z.object({
  "title": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 200, { message: 'Must contain at most 200 Unicode code point(s)' }).optional(),
  "description": z.string().refine((value) => unicodeCodePointLength(value) <= 2000, { message: 'Must contain at most 2000 Unicode code point(s)' }).nullable().optional(),
  "priority": prioritySchema.optional(),
  "scheduledAt": z.string().datetime({ offset: true }).nullable().optional(),
  "deadlineAt": z.string().datetime({ offset: true }).nullable().optional(),
  "reminderAt": z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length >= 1, { message: 'Must contain at least 1 field(s)' });
export type TaskChanges = z.infer<typeof taskChangesSchema>;

export const errorResponseSchema = z.object({
  "error": errorDetailSchema,
}).strict();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const executeRequestSchema = z.object({
  "contractVersion": z.literal("1.0"),
  "requestId": z.string().uuid(),
  "capabilityCode": capabilityCodeSchema,
  "deadlineAt": z.string().datetime({ offset: true }),
  "locale": z.string().regex(new RegExp("^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$", 'u')).refine((value) => unicodeCodePointLength(value) >= 2, { message: 'Must contain at least 2 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 16, { message: 'Must contain at most 16 Unicode code point(s)' }),
  "timezone": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 64, { message: 'Must contain at most 64 Unicode code point(s)' }),
  "allowedResultTypes": z.array(resultTypeSchema).min(1).max(5).refine((items) => new Set(items).size === items.length, { message: 'Must contain unique items' }),
  "messages": z.array(internalMessageSchema).min(1).max(20),
  "candidates": z.array(candidateContextSchema).max(80),
}).strict().superRefine((value, context) => {
  const messageBytes = value.messages.reduce(
    (total, message) => total + new TextEncoder().encode(message.content).byteLength,
    0,
  );
  if (messageBytes > MESSAGE_CONTENT_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['messages'],
      message: 'Message content exceeds byte limit',
    });
  }
  const candidateRefs = value.candidates.map((candidate) => candidate.candidateRef);
  if (new Set(candidateRefs).size !== candidateRefs.length) {
    context.addIssue({
      code: 'custom',
      path: ['candidates'],
      message: 'Candidate references must be unique',
    });
  }
  const taskCount = value.candidates.filter((candidate) => candidate.kind === 'TASK').length;
  const projectCount = value.candidates.length - taskCount;
  if (taskCount > MAX_TASK_CANDIDATES || projectCount > MAX_PROJECT_CANDIDATES) {
    context.addIssue({
      code: 'custom',
      path: ['candidates'],
      message: 'Candidate kind limit exceeded',
    });
  }
});
export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export const clarificationResultSchema = z.object({
  "type": z.literal("CLARIFICATION"),
  "question": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 500, { message: 'Must contain at most 500 Unicode code point(s)' }),
  "options": z.array(clarificationOptionSchema).min(2).max(5),
  "allowFreeText": z.boolean(),
}).strict();
export type ClarificationResult = z.infer<typeof clarificationResultSchema>;

export const planResultSchema = z.object({
  "type": z.literal("PLAN"),
  "title": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 200, { message: 'Must contain at most 200 Unicode code point(s)' }),
  "project": planProjectSelectionSchema,
  "tasks": z.array(taskDraftSchema).min(1).max(10),
}).strict();
export type PlanResult = z.infer<typeof planResultSchema>;

export const createTaskMutationSchema = z.object({
  "operation": z.literal("CREATE_TASK"),
  "project": taskProjectSelectionSchema,
  "task": taskDraftSchema,
}).strict();
export type CreateTaskMutation = z.infer<typeof createTaskMutationSchema>;

export const createProjectTasksMutationSchema = z.object({
  "operation": z.literal("CREATE_PROJECT_TASKS"),
  "project": planProjectSelectionSchema,
  "tasks": z.array(taskDraftSchema).min(1).max(10),
}).strict();
export type CreateProjectTasksMutation = z.infer<typeof createProjectTasksMutationSchema>;

export const updateTaskMutationSchema = z.object({
  "operation": z.literal("UPDATE_TASK"),
  "targetRef": z.string().regex(new RegExp("^cand_[a-f0-9]{32}$", 'u')),
  "expectedVersion": z.number().int().min(1),
  "changes": taskChangesSchema,
}).strict();
export type UpdateTaskMutation = z.infer<typeof updateTaskMutationSchema>;

export const actionMutationSchema = z.discriminatedUnion("operation", [createTaskMutationSchema, createProjectTasksMutationSchema, organizeTaskMutationSchema, updateTaskMutationSchema, completeTaskMutationSchema, restoreTaskMutationSchema, deleteTaskMutationSchema]);
export type ActionMutation = z.infer<typeof actionMutationSchema>;

export const actionProposalResultSchema = z.object({
  "type": z.literal("ACTION_PROPOSAL"),
  "actionCode": actionCodeSchema,
  "summary": z.string().refine((value) => unicodeCodePointLength(value) >= 1, { message: 'Must contain at least 1 Unicode code point(s)' }).refine((value) => unicodeCodePointLength(value) <= 500, { message: 'Must contain at most 500 Unicode code point(s)' }),
  "mutations": z.array(actionMutationSchema).min(1).max(20),
}).strict();
export type ActionProposalResult = z.infer<typeof actionProposalResultSchema>;

export const executeResultSchema = z.discriminatedUnion("type", [replyResultSchema, clarificationResultSchema, candidatesResultSchema, planResultSchema, actionProposalResultSchema]);
export type ExecuteResult = z.infer<typeof executeResultSchema>;

export const executeResponseSchema = z.object({
  "contractVersion": z.literal("1.0"),
  "requestId": z.string().uuid(),
  "resolved": resolutionMetadataSchema,
  "result": executeResultSchema,
}).strict();
export type ExecuteResponse = z.infer<typeof executeResponseSchema>;
