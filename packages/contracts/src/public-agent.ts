import { z } from 'zod';

import { requestIdSchema } from './errors.js';
import {
  actionProposalIdSchema,
  agentRequestIdSchema,
  conversationIdSchema,
  projectIdSchema,
  taskIdSchema,
  undoOperationIdSchema,
} from './ids.js';
import { taskPrioritySchema } from './tasks.js';

const utcDateTimeSchema = z.string().datetime({ offset: true });
const positiveVersionSchema = z.number().int().positive();
const boundedTextSchema = z.string().trim().min(1).max(500);
const displayTextSchema = z.string().min(1).max(4_000);
const jsonObjectSchema = z.record(z.string(), z.json());

export const agentMessageIdSchema = z.uuid().brand<'AgentMessageId'>();
export const actionMutationIdSchema = z.uuid().brand<'ActionMutationId'>();
export const actionExecutionIdSchema = z.uuid().brand<'ActionExecutionId'>();

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value.trim().length > 0, '幂等键不能只包含空白');

export const agentWriteHeadersSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const publicAgentRequestStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RESULT_PERSISTED',
  'SETTLING',
  'SUCCEEDED',
  'FAILED',
  'RELEASED',
]);

export const agentMessageRoleSchema = z.enum(['USER', 'ASSISTANT', 'SYSTEM']);
export const agentMessageTypeSchema = z.enum([
  'USER_INPUT',
  'AI_REPLY',
  'QUESTION',
  'ACTION_CONFIRM',
]);
export const agentInputModeSchema = z.enum(['TEXT', 'VOICE', 'CHOICE', 'SYSTEM']);
export const agentInteractionStatusSchema = z.enum(['PENDING', 'ANSWERED', 'SUPERSEDED', 'CLOSED']);
export const agentQuestionKindSchema = z.enum(['CLARIFICATION', 'CANDIDATES']);
export const agentQuestionNextStepSchema = z.enum([
  'DETERMINISTIC',
  'AGENT_STANDARD_TURN',
  'AGENT_PLAN_GENERATION',
]);

const userInputContentSchema = z
  .object({
    type: z.literal('USER_INPUT'),
    text: boundedTextSchema,
  })
  .strict();

const aiReplyContentSchema = z
  .object({
    type: z.literal('AI_REPLY'),
    text: displayTextSchema,
    canGeneratePlan: z.boolean(),
  })
  .strict();

const questionOptionContextSchema = z
  .object({
    projectName: z.string().min(1).max(40).nullable().optional(),
    scheduledAt: utcDateTimeSchema.nullable().optional(),
    deadlineAt: utcDateTimeSchema.nullable().optional(),
  })
  .strict();

export const agentQuestionOptionSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(300).optional(),
    context: questionOptionContextSchema.optional(),
  })
  .strict();

const questionContentFor = (questionKind: 'CLARIFICATION' | 'CANDIDATES') =>
  z
    .object({
      type: z.literal('QUESTION'),
      questionKind: z.literal(questionKind),
      prompt: z.string().min(1).max(500),
      options: z.array(agentQuestionOptionSchema).min(2).max(10),
      allowFreeText: z.boolean(),
      nextStep: agentQuestionNextStepSchema,
    })
    .strict();

const actionConfirmContentSchema = z
  .object({
    type: z.literal('ACTION_CONFIRM'),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1_000),
  })
  .strict();

const messageBaseSchema = z.object({
  id: agentMessageIdSchema,
  conversationId: conversationIdSchema,
  replyToId: agentMessageIdSchema.nullable(),
  aiRequestId: agentRequestIdSchema.nullable(),
  version: positiveVersionSchema,
  createdAt: utcDateTimeSchema,
});

const userInputMessageSchema = messageBaseSchema
  .extend({
    role: z.literal('USER'),
    messageType: z.literal('USER_INPUT'),
    inputMode: z.enum(['TEXT', 'VOICE', 'CHOICE']),
    content: userInputContentSchema,
    proposalId: z.null(),
    interactionStatus: z.null(),
  })
  .strict();

const aiReplyMessageSchema = messageBaseSchema
  .extend({
    role: z.literal('ASSISTANT'),
    messageType: z.literal('AI_REPLY'),
    inputMode: z.literal('SYSTEM'),
    content: aiReplyContentSchema,
    proposalId: z.null(),
    interactionStatus: z.null(),
  })
  .strict();

const questionMessageFor = (questionKind: 'CLARIFICATION' | 'CANDIDATES') =>
  messageBaseSchema
    .extend({
      role: z.literal('ASSISTANT'),
      messageType: z.literal('QUESTION'),
      inputMode: z.literal('SYSTEM'),
      content: questionContentFor(questionKind),
      proposalId: z.null(),
      interactionStatus: agentInteractionStatusSchema,
    })
    .strict();

const actionConfirmMessageSchema = messageBaseSchema
  .extend({
    role: z.literal('ASSISTANT'),
    messageType: z.literal('ACTION_CONFIRM'),
    inputMode: z.literal('SYSTEM'),
    content: actionConfirmContentSchema,
    proposalId: actionProposalIdSchema,
    interactionStatus: z.null(),
  })
  .strict();

export const agentMessageSchema = z.union([
  userInputMessageSchema,
  aiReplyMessageSchema,
  questionMessageFor('CLARIFICATION'),
  questionMessageFor('CANDIDATES'),
  actionConfirmMessageSchema,
]);

export const publicActionCodeSchema = z.enum([
  'CREATE_TASK',
  'CREATE_PROJECT_TASKS',
  'ORGANIZE_TASKS',
  'UPDATE_TASK',
  'COMPLETE_TASK',
  'RESTORE_TASK',
  'DELETE_TASK',
]);

export const publicActionProposalStatusSchema = z.enum([
  'DRAFT',
  'AWAITING_CONFIRMATION',
  'SUPERSEDED',
  'CANCELLED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
]);

export const publicActionMutationOperationSchema = z.enum([
  'CREATE',
  'UPDATE',
  'COMPLETE',
  'RESTORE',
  'SOFT_DELETE',
]);
export const publicActionTargetTypeSchema = z.enum(['PROJECT', 'TASK']);
export const publicActionFieldSourceSchema = z.enum(['USER', 'AGENT_SUGGESTION', 'INFERRED']);

export const publicActionMutationSchema = z
  .object({
    id: actionMutationIdSchema,
    sequence: z.number().int().positive(),
    operation: publicActionMutationOperationSchema,
    targetType: publicActionTargetTypeSchema,
    targetId: z.uuid().nullable(),
    targetVersion: positiveVersionSchema.nullable(),
    beforeValue: jsonObjectSchema.nullable(),
    afterValue: jsonObjectSchema,
    fieldSource: publicActionFieldSourceSchema,
  })
  .strict()
  .superRefine((mutation, context) => {
    if (mutation.operation === 'CREATE' && mutation.targetId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: '创建变更不能引用已有目标',
      });
    }

    if (
      mutation.operation === 'CREATE' &&
      (mutation.targetVersion !== null || mutation.beforeValue !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetVersion'],
        message: '创建变更不能携带目标版本或变更前快照',
      });
    }

    if (mutation.operation !== 'CREATE' && mutation.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: '非创建变更必须引用已有目标',
      });
    }

    if (
      mutation.operation !== 'CREATE' &&
      (mutation.targetVersion === null || mutation.beforeValue === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetVersion'],
        message: '非创建变更必须携带目标版本和变更前快照',
      });
    }
  });

export const publicActionProposalSchema = z
  .object({
    id: actionProposalIdSchema,
    conversationId: conversationIdSchema,
    actionCode: publicActionCodeSchema,
    title: z.string().min(1).max(200),
    status: publicActionProposalStatusSchema,
    version: positiveVersionSchema,
    mutations: z.array(publicActionMutationSchema).min(1).max(50),
    lastDismissedAt: utcDateTimeSchema.nullable(),
    expiresAt: utcDateTimeSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export const agentTurnInputSchema = z
  .object({
    conversationId: conversationIdSchema.optional(),
    input: z
      .object({
        mode: z.literal('TEXT'),
        text: boundedTextSchema,
        replyTo: z
          .object({
            messageId: agentMessageIdSchema,
            version: positiveVersionSchema,
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

const planGenerationSourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('MESSAGE'),
      messageId: agentMessageIdSchema,
      version: positiveVersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PROPOSAL'),
      proposalId: actionProposalIdSchema,
      version: positiveVersionSchema,
    })
    .strict(),
]);

export const planGenerationInputSchema = z
  .object({
    source: planGenerationSourceSchema,
    instruction: boundedTextSchema.optional(),
  })
  .strict();

export const agentTurnQueuedResponseSchema = z
  .object({
    requestId: agentRequestIdSchema,
    conversationId: conversationIdSchema,
    status: z.literal('QUEUED'),
    pollAfterMs: z.number().int().min(250).max(30_000),
  })
  .strict();

export const planGenerationQueuedResponseSchema = agentTurnQueuedResponseSchema;

const agentSettledResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REPLY'), message: aiReplyMessageSchema }).strict(),
  z
    .object({
      type: z.literal('CLARIFICATION'),
      message: questionMessageFor('CLARIFICATION'),
    })
    .strict(),
  z
    .object({
      type: z.literal('CANDIDATES'),
      message: questionMessageFor('CANDIDATES'),
    })
    .strict(),
  z.object({ type: z.literal('PLAN'), proposal: publicActionProposalSchema }).strict(),
  z.object({ type: z.literal('ACTION_PROPOSAL'), proposal: publicActionProposalSchema }).strict(),
]);

export const agentPublicFailureCodeSchema = z.enum([
  'AGENT_DAILY_QUOTA_EXHAUSTED',
  'AGENT_POINTS_INSUFFICIENT',
  'AGENT_CAPABILITY_DISABLED',
  'AGENT_SERVICE_UNAVAILABLE',
  'AGENT_REQUEST_EXPIRED',
  'AGENT_RESULT_UNAVAILABLE',
]);

const agentRequestFailureSchema = z
  .object({
    code: agentPublicFailureCodeSchema,
    message: z.string().min(1).max(200),
    canRetry: z.boolean(),
  })
  .strict();

const pendingAgentRequestSchema = (
  status: 'QUEUED' | 'RUNNING' | 'RESULT_PERSISTED' | 'SETTLING',
) =>
  z
    .object({
      requestId: agentRequestIdSchema,
      conversationId: conversationIdSchema,
      status: z.literal(status),
      pollAfterMs: z.number().int().min(250).max(30_000),
    })
    .strict();

const succeededAgentRequestSchema = z
  .object({
    requestId: agentRequestIdSchema,
    conversationId: conversationIdSchema,
    status: z.literal('SUCCEEDED'),
    result: agentSettledResultSchema,
    completedAt: utcDateTimeSchema,
  })
  .strict();

const terminalAgentRequestSchema = (status: 'FAILED' | 'RELEASED') =>
  z
    .object({
      requestId: agentRequestIdSchema,
      conversationId: conversationIdSchema,
      status: z.literal(status),
      failure: agentRequestFailureSchema,
      completedAt: utcDateTimeSchema,
    })
    .strict();

export const agentRequestResponseSchema = z
  .discriminatedUnion('status', [
    pendingAgentRequestSchema('QUEUED'),
    pendingAgentRequestSchema('RUNNING'),
    pendingAgentRequestSchema('RESULT_PERSISTED'),
    pendingAgentRequestSchema('SETTLING'),
    succeededAgentRequestSchema,
    terminalAgentRequestSchema('FAILED'),
    terminalAgentRequestSchema('RELEASED'),
  ])
  .superRefine((request, context) => {
    if (request.status !== 'SUCCEEDED') return;

    const resultConversationId =
      request.result.type === 'REPLY' ||
      request.result.type === 'CLARIFICATION' ||
      request.result.type === 'CANDIDATES'
        ? request.result.message.conversationId
        : request.result.proposal.conversationId;

    if (resultConversationId !== request.conversationId) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: '结果必须属于当前会话',
      });
    }
  });

export const conversationMessagesQuerySchema = z
  .object({
    cursor: agentMessageIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const conversationMessagesResponseSchema = z
  .object({
    items: z.array(agentMessageSchema),
    pageInfo: z
      .object({
        nextCursor: agentMessageIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const conversationViewedInputSchema = z
  .object({
    lastViewedMessageId: agentMessageIdSchema,
  })
  .strict();

export const conversationViewedResponseSchema = z
  .object({
    lastViewedMessageId: agentMessageIdSchema,
    viewedAt: utcDateTimeSchema,
  })
  .strict();

const messageAnswerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('OPTION'),
      optionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    })
    .strict(),
  z
    .object({
      type: z.literal('TEXT'),
      text: boundedTextSchema,
    })
    .strict(),
]);

export const messageAnswerInputSchema = z
  .object({
    version: positiveVersionSchema,
    answer: messageAnswerSchema,
  })
  .strict();

export const messageAnswerResponseSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('DETERMINISTIC'),
      message: agentMessageSchema,
      proposal: publicActionProposalSchema.nullable(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('QUEUED'),
      request: agentTurnQueuedResponseSchema,
    })
    .strict(),
]);

const projectSelectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('EXISTING'), projectId: projectIdSchema }).strict(),
  z.object({ type: z.literal('NEW'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ type: z.literal('NONE') }).strict(),
]);

const editableTaskDraftChangesSchema = z
  .object({
    project: projectSelectionSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2_000).optional(),
    priority: taskPrioritySchema.optional(),
    scheduledAt: utcDateTimeSchema.nullable().optional(),
    deadlineAt: utcDateTimeSchema.nullable().optional(),
    reminderAt: utcDateTimeSchema.nullable().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, '至少需要修改一个字段');

export const actionProposalEditCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('SET_PROJECT'),
      project: projectSelectionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('UPDATE_TASK_DRAFT'),
      mutationId: actionMutationIdSchema,
      changes: editableTaskDraftChangesSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('REMOVE_MUTATION'),
      mutationId: actionMutationIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('REMOVE_FIELD_SUGGESTION'),
      mutationId: actionMutationIdSchema,
      field: z.enum(['PROJECT', 'SCHEDULED_AT', 'DEADLINE_AT', 'REMINDER_AT']),
    })
    .strict(),
]);

export const actionProposalEditInputSchema = z
  .object({
    version: positiveVersionSchema,
    command: actionProposalEditCommandSchema,
  })
  .strict();

const proposalVersionInputSchema = z.object({ version: positiveVersionSchema }).strict();

export const actionProposalDismissInputSchema = proposalVersionInputSchema;
export const actionProposalCancelInputSchema = proposalVersionInputSchema;
export const actionProposalConfirmInputSchema = proposalVersionInputSchema;

export const actionProposalMutationResponseSchema = z
  .object({ proposal: publicActionProposalSchema })
  .strict();
export const actionProposalResponseSchema = actionProposalMutationResponseSchema;
export const actionProposalDismissResponseSchema = actionProposalMutationResponseSchema;
export const actionProposalCancelResponseSchema = actionProposalMutationResponseSchema;

const actionExecutionResultSchema = z
  .object({
    projectId: projectIdSchema.nullable(),
    taskIds: z.array(taskIdSchema).max(50),
    undoOperationId: undoOperationIdSchema.nullable(),
    undoExpiresAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if ((result.undoOperationId === null) !== (result.undoExpiresAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['undoOperationId'],
        message: '撤销标识和到期时间必须同时存在或同时为空',
      });
    }
  });

export const actionProposalConfirmResponseSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('EXECUTED'),
      proposal: publicActionProposalSchema,
      execution: z
        .object({
          id: actionExecutionIdSchema,
          status: z.literal('SUCCEEDED'),
          executedAt: utcDateTimeSchema,
          result: actionExecutionResultSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('FAILED'),
      proposal: publicActionProposalSchema,
      execution: z
        .object({
          id: actionExecutionIdSchema,
          status: z.literal('FAILED'),
          error: z
            .object({
              code: z.enum([
                'ACTION_TARGET_VERSION_CONFLICT',
                'ACTION_TARGET_NOT_FOUND',
                'ACTION_PROJECT_NAME_CONFLICT',
                'ACTION_EXECUTION_FAILED',
              ]),
              message: z.string().min(1).max(200),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);

export const smartInboxKindSchema = z.enum([
  'AWAITING_CONFIRMATION',
  'AWAITING_CLARIFICATION',
  'PROCESSING',
  'EXECUTION_FAILED',
  'UNREAD_REPLY',
  'ORGANIZE_TASKS',
  'CURRENT_SCOPE',
  'EMPTY_SCOPE',
  'DEFAULT',
]);

export const smartInboxScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }).strict(),
  z.object({ type: z.literal('PROJECT'), projectId: projectIdSchema }).strict(),
]);

const resumeConversationActionSchema = z
  .object({
    type: z.literal('RESUME_CONVERSATION'),
    conversationId: conversationIdSchema,
    messageId: agentMessageIdSchema.nullable(),
    proposalId: actionProposalIdSchema.nullable(),
    requestId: agentRequestIdSchema.nullable(),
  })
  .strict();

const smartInboxCopySchema = {
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(300),
};

export const smartInboxItemSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('AWAITING_CONFIRMATION'),
      ...smartInboxCopySchema,
      action: resumeConversationActionSchema.refine(
        (action) => action.proposalId !== null,
        '待确认状态必须指向提案',
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('AWAITING_CLARIFICATION'),
      ...smartInboxCopySchema,
      action: resumeConversationActionSchema.refine(
        (action) => action.messageId !== null,
        '待澄清状态必须指向消息',
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('PROCESSING'),
      ...smartInboxCopySchema,
      action: resumeConversationActionSchema.refine(
        (action) => action.requestId !== null,
        '处理中状态必须指向请求',
      ),
    })
    .strict(),
  ...(['EXECUTION_FAILED', 'UNREAD_REPLY'] as const).map((kind) =>
    z
      .object({
        kind: z.literal(kind),
        ...smartInboxCopySchema,
        action: resumeConversationActionSchema,
      })
      .strict(),
  ),
  z
    .object({
      kind: z.literal('ORGANIZE_TASKS'),
      ...smartInboxCopySchema,
      action: z
        .object({
          type: z.literal('ORGANIZE_TASKS'),
          scope: smartInboxScopeSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('CURRENT_SCOPE'),
      ...smartInboxCopySchema,
      action: z.object({ type: z.literal('START_AGENT') }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('EMPTY_SCOPE'),
      ...smartInboxCopySchema,
      action: z.object({ type: z.literal('CREATE_TASK') }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('DEFAULT'),
      ...smartInboxCopySchema,
      action: z.object({ type: z.literal('START_AGENT') }).strict(),
    })
    .strict(),
]);

export const smartInboxQuerySchema = z
  .object({
    projectId: projectIdSchema.optional(),
  })
  .strict();

export const smartInboxResponseSchema = z.object({ item: smartInboxItemSchema }).strict();

export const smartInboxOrganizeInputSchema = z
  .object({
    scope: smartInboxScopeSchema,
  })
  .strict();

export const smartInboxOrganizeQueuedResponseSchema = agentTurnQueuedResponseSchema;

export const agentPublicErrorCodeSchema = z.enum([
  'AGENT_DAILY_QUOTA_EXHAUSTED',
  'AGENT_POINTS_INSUFFICIENT',
  'AGENT_CAPABILITY_DISABLED',
  'AGENT_SERVICE_UNAVAILABLE',
  'AGENT_REQUEST_NOT_FOUND',
  'AGENT_REQUEST_CONFLICT',
  'AGENT_REQUEST_EXPIRED',
  'AGENT_RESULT_UNAVAILABLE',
  'AGENT_MESSAGE_VERSION_CONFLICT',
  'ACTION_PROPOSAL_NOT_FOUND',
  'ACTION_PROPOSAL_VERSION_CONFLICT',
  'ACTION_PROPOSAL_NOT_EXECUTABLE',
  'ACTION_TARGET_VERSION_CONFLICT',
  'ACTION_EXECUTION_FAILED',
]);

export const agentPublicErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: agentPublicErrorCodeSchema,
        message: z.string().min(1).max(200),
        requestId: requestIdSchema,
        details: z
          .object({
            retryAfterMs: z.number().int().positive().optional(),
            currentVersion: positiveVersionSchema.optional(),
            canRetryTomorrow: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const agentPublicErrorHttpStatus = {
  AGENT_DAILY_QUOTA_EXHAUSTED: 429,
  AGENT_POINTS_INSUFFICIENT: 429,
  AGENT_CAPABILITY_DISABLED: 503,
  AGENT_SERVICE_UNAVAILABLE: 503,
  AGENT_REQUEST_NOT_FOUND: 404,
  AGENT_REQUEST_CONFLICT: 409,
  AGENT_REQUEST_EXPIRED: 410,
  AGENT_RESULT_UNAVAILABLE: 503,
  AGENT_MESSAGE_VERSION_CONFLICT: 409,
  ACTION_PROPOSAL_NOT_FOUND: 404,
  ACTION_PROPOSAL_VERSION_CONFLICT: 409,
  ACTION_PROPOSAL_NOT_EXECUTABLE: 409,
  ACTION_TARGET_VERSION_CONFLICT: 409,
  ACTION_EXECUTION_FAILED: 409,
} as const satisfies Record<z.infer<typeof agentPublicErrorCodeSchema>, number>;

export type AgentMessageId = z.infer<typeof agentMessageIdSchema>;
export type ActionMutationId = z.infer<typeof actionMutationIdSchema>;
export type ActionExecutionId = z.infer<typeof actionExecutionIdSchema>;
export type AgentWriteHeaders = z.infer<typeof agentWriteHeadersSchema>;
export type PublicAgentRequestStatus = z.infer<typeof publicAgentRequestStatusSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type PublicActionCode = z.infer<typeof publicActionCodeSchema>;
export type PublicActionProposalStatus = z.infer<typeof publicActionProposalStatusSchema>;
export type PublicActionMutation = z.infer<typeof publicActionMutationSchema>;
export type PublicActionProposal = z.infer<typeof publicActionProposalSchema>;
export type AgentTurnInput = z.infer<typeof agentTurnInputSchema>;
export type PlanGenerationInput = z.infer<typeof planGenerationInputSchema>;
export type AgentTurnQueuedResponse = z.infer<typeof agentTurnQueuedResponseSchema>;
export type PlanGenerationQueuedResponse = z.infer<typeof planGenerationQueuedResponseSchema>;
export type AgentRequestResponse = z.infer<typeof agentRequestResponseSchema>;
export type ConversationMessagesQuery = z.infer<typeof conversationMessagesQuerySchema>;
export type ConversationMessagesResponse = z.infer<typeof conversationMessagesResponseSchema>;
export type ConversationViewedInput = z.infer<typeof conversationViewedInputSchema>;
export type ConversationViewedResponse = z.infer<typeof conversationViewedResponseSchema>;
export type MessageAnswerInput = z.infer<typeof messageAnswerInputSchema>;
export type MessageAnswerResponse = z.infer<typeof messageAnswerResponseSchema>;
export type ActionProposalEditInput = z.infer<typeof actionProposalEditInputSchema>;
export type ActionProposalDismissInput = z.infer<typeof actionProposalDismissInputSchema>;
export type ActionProposalCancelInput = z.infer<typeof actionProposalCancelInputSchema>;
export type ActionProposalConfirmInput = z.infer<typeof actionProposalConfirmInputSchema>;
export type ActionProposalMutationResponse = z.infer<typeof actionProposalMutationResponseSchema>;
export type ActionProposalResponse = z.infer<typeof actionProposalResponseSchema>;
export type ActionProposalConfirmResponse = z.infer<typeof actionProposalConfirmResponseSchema>;
export type SmartInboxKind = z.infer<typeof smartInboxKindSchema>;
export type SmartInboxScope = z.infer<typeof smartInboxScopeSchema>;
export type SmartInboxItem = z.infer<typeof smartInboxItemSchema>;
export type SmartInboxQuery = z.infer<typeof smartInboxQuerySchema>;
export type SmartInboxResponse = z.infer<typeof smartInboxResponseSchema>;
export type SmartInboxOrganizeInput = z.infer<typeof smartInboxOrganizeInputSchema>;
export type SmartInboxOrganizeQueuedResponse = z.infer<
  typeof smartInboxOrganizeQueuedResponseSchema
>;
export type AgentPublicFailureCode = z.infer<typeof agentPublicFailureCodeSchema>;
export type AgentPublicErrorCode = z.infer<typeof agentPublicErrorCodeSchema>;
export type AgentPublicErrorEnvelope = z.infer<typeof agentPublicErrorEnvelopeSchema>;
