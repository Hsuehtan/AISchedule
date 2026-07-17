import {
  actionProposalCancelInputSchema,
  actionProposalCancelResponseSchema,
  actionProposalConfirmInputSchema,
  actionProposalConfirmResponseSchema,
  actionProposalDismissInputSchema,
  actionProposalDismissResponseSchema,
  actionProposalEditInputSchema,
  actionProposalIdSchema,
  actionProposalMutationResponseSchema,
  agentMessageIdSchema,
  agentRequestIdSchema,
  agentRequestResponseSchema,
  agentTurnInputSchema,
  agentTurnQueuedResponseSchema,
  agentWriteHeadersSchema,
  archiveProjectInputSchema,
  authResponseSchema,
  conversationIdSchema,
  conversationMessagesQuerySchema,
  conversationMessagesResponseSchema,
  conversationViewedInputSchema,
  conversationViewedResponseSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  loginWithUsernameSchema,
  logoutResponseSchema,
  messageAnswerInputSchema,
  messageAnswerResponseSchema,
  planGenerationInputSchema,
  planGenerationQueuedResponseSchema,
  projectListQuerySchema,
  projectListResponseSchema,
  projectMutationResponseSchema,
  registerWithUsernameSchema,
  sessionResponseSchema,
  smartInboxOrganizeInputSchema,
  smartInboxOrganizeQueuedResponseSchema,
  smartInboxQuerySchema,
  smartInboxResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMutationResponseSchema,
  taskDeleteResponseSchema,
  undoExecutionResponseSchema,
  updateProjectInputSchema,
  updateTaskInputSchema,
  versionCommandSchema,
  type ActionProposalConfirmResponse,
  type ActionProposalMutationResponse,
  type AgentRequestResponse,
  type AgentTurnQueuedResponse,
  type ArchiveProjectInput,
  type AuthResponse,
  type ConversationMessagesResponse,
  type ConversationViewedResponse,
  type CreateProjectInput,
  type CreateTaskInput,
  type LoginWithUsernameInput,
  type MessageAnswerResponse,
  type PlanGenerationQueuedResponse,
  type ProjectListResponse,
  type ProjectMutationResponse,
  type PublicUser,
  type RegisterWithUsernameInput,
  type SessionResponse,
  type SmartInboxOrganizeQueuedResponse,
  type SmartInboxResponse,
  type TaskDeleteResponse,
  type TaskListResponse,
  type TaskMutationResponse,
  type UndoExecutionResponse,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from '@ai-schedule/contracts';
import type { z } from 'zod';

import type { ApiClient } from './api-client';

type TaskListRequest = {
  cursor?: string;
  limit?: number;
  projectId?: string;
  status?: 'COMPLETED' | 'TODO';
};

type ProjectListRequest = {
  cursor?: string;
  limit?: number;
  status?: 'ACTIVE' | 'ARCHIVED';
};

type ConversationMessagesRequest = {
  cursor?: string;
  limit?: number;
};

type SmartInboxRequest = {
  projectId?: string;
};

type AgentTurnRequest = z.input<typeof agentTurnInputSchema>;
type PlanGenerationRequest = z.input<typeof planGenerationInputSchema>;
type ConversationViewedRequest = z.input<typeof conversationViewedInputSchema>;
type MessageAnswerRequest = z.input<typeof messageAnswerInputSchema>;
type ActionProposalEditRequest = z.input<typeof actionProposalEditInputSchema>;
type ActionProposalDismissRequest = z.input<typeof actionProposalDismissInputSchema>;
type ActionProposalCancelRequest = z.input<typeof actionProposalCancelInputSchema>;
type ActionProposalConfirmRequest = z.input<typeof actionProposalConfirmInputSchema>;
type SmartInboxOrganizeRequest = z.input<typeof smartInboxOrganizeInputSchema>;

function parseAgentIdempotencyKey(idempotencyKey: string): string {
  return agentWriteHeadersSchema.parse({ idempotencyKey }).idempotencyKey;
}

export class ScheduleApi {
  readonly #client: ApiClient;

  constructor(client: ApiClient) {
    this.#client = client;
  }

  session(): Promise<SessionResponse> {
    return this.#client.request<SessionResponse>('/auth/session', {
      handleUnauthorized: false,
      responseSchema: sessionResponseSchema,
    });
  }

  register(input: RegisterWithUsernameInput): Promise<AuthResponse> {
    return this.#client.request<AuthResponse>('/auth/username/register', {
      body: registerWithUsernameSchema.parse(input),
      handleUnauthorized: false,
      method: 'POST',
      responseSchema: authResponseSchema,
    });
  }

  login(input: LoginWithUsernameInput): Promise<AuthResponse> {
    return this.#client.request<AuthResponse>('/auth/username/login', {
      body: loginWithUsernameSchema.parse(input),
      handleUnauthorized: false,
      method: 'POST',
      responseSchema: authResponseSchema,
    });
  }

  async logout(): Promise<void> {
    await this.#client.request('/auth/logout', {
      method: 'POST',
      responseSchema: logoutResponseSchema,
    });
  }

  async me(): Promise<PublicUser> {
    const response = await this.#client.request<AuthResponse>('/users/me', {
      responseSchema: authResponseSchema,
    });
    return response.user;
  }

  listTasks(input: TaskListRequest): Promise<TaskListResponse> {
    const query = taskListQuerySchema.parse(input);
    return this.#client.request<TaskListResponse>('/tasks', {
      query,
      responseSchema: taskListResponseSchema,
    });
  }

  task(taskId: string): Promise<TaskMutationResponse> {
    return this.#client.request<TaskMutationResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
      responseSchema: taskMutationResponseSchema,
    });
  }

  createTask(input: CreateTaskInput, idempotencyKey: string): Promise<TaskMutationResponse> {
    return this.#client.request<TaskMutationResponse>('/tasks', {
      body: createTaskInputSchema.parse(input),
      idempotencyKey,
      idempotent: true,
      method: 'POST',
      responseSchema: taskMutationResponseSchema,
    });
  }

  updateTask(
    taskId: string,
    input: UpdateTaskInput,
    idempotencyKey: string,
  ): Promise<TaskMutationResponse> {
    return this.#client.request<TaskMutationResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
      body: updateTaskInputSchema.parse(input),
      idempotencyKey,
      idempotent: true,
      method: 'PATCH',
      responseSchema: taskMutationResponseSchema,
    });
  }

  completeTask(
    taskId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<TaskMutationResponse> {
    return this.#client.request<TaskMutationResponse>(
      `/tasks/${encodeURIComponent(taskId)}/complete`,
      {
        body: versionCommandSchema.parse({ version }),
        idempotencyKey,
        idempotent: true,
        method: 'POST',
        responseSchema: taskMutationResponseSchema,
      },
    );
  }

  restoreTask(
    taskId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<TaskMutationResponse> {
    return this.#client.request<TaskMutationResponse>(
      `/tasks/${encodeURIComponent(taskId)}/restore`,
      {
        body: versionCommandSchema.parse({ version }),
        idempotencyKey,
        idempotent: true,
        method: 'POST',
        responseSchema: taskMutationResponseSchema,
      },
    );
  }

  deleteTask(taskId: string, version: number, idempotencyKey: string): Promise<TaskDeleteResponse> {
    return this.#client.request<TaskDeleteResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
      idempotent: true,
      idempotencyKey,
      method: 'DELETE',
      query: { version },
      responseSchema: taskDeleteResponseSchema,
    });
  }

  executeUndo(operationId: string, idempotencyKey: string): Promise<UndoExecutionResponse> {
    return this.#client.request<UndoExecutionResponse>(
      `/undo-operations/${encodeURIComponent(operationId)}/execute`,
      {
        idempotent: true,
        idempotencyKey,
        method: 'POST',
        responseSchema: undoExecutionResponseSchema,
      },
    );
  }

  listProjects(input: ProjectListRequest = {}): Promise<ProjectListResponse> {
    const query = projectListQuerySchema.parse(input);
    return this.#client.request<ProjectListResponse>('/projects', {
      query,
      responseSchema: projectListResponseSchema,
    });
  }

  createProject(
    input: CreateProjectInput,
    idempotencyKey: string,
  ): Promise<ProjectMutationResponse> {
    return this.#client.request<ProjectMutationResponse>('/projects', {
      body: createProjectInputSchema.parse(input),
      idempotencyKey,
      idempotent: true,
      method: 'POST',
      responseSchema: projectMutationResponseSchema,
    });
  }

  updateProject(
    projectId: string,
    input: UpdateProjectInput,
    idempotencyKey: string,
  ): Promise<ProjectMutationResponse> {
    return this.#client.request<ProjectMutationResponse>(
      `/projects/${encodeURIComponent(projectId)}`,
      {
        body: updateProjectInputSchema.parse(input),
        idempotencyKey,
        idempotent: true,
        method: 'PATCH',
        responseSchema: projectMutationResponseSchema,
      },
    );
  }

  archiveProject(
    projectId: string,
    input: ArchiveProjectInput,
    idempotencyKey: string,
  ): Promise<ProjectMutationResponse> {
    return this.#client.request<ProjectMutationResponse>(
      `/projects/${encodeURIComponent(projectId)}/archive`,
      {
        body: archiveProjectInputSchema.parse(input),
        idempotencyKey,
        idempotent: true,
        method: 'POST',
        responseSchema: projectMutationResponseSchema,
      },
    );
  }

  createAgentTurn(
    input: AgentTurnRequest,
    idempotencyKey: string,
  ): Promise<AgentTurnQueuedResponse> {
    return this.#client.request<AgentTurnQueuedResponse>('/agent/turns', {
      body: agentTurnInputSchema.parse(input),
      idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
      idempotent: true,
      method: 'POST',
      responseSchema: agentTurnQueuedResponseSchema,
    });
  }

  createPlanGeneration(
    input: PlanGenerationRequest,
    idempotencyKey: string,
  ): Promise<PlanGenerationQueuedResponse> {
    return this.#client.request<PlanGenerationQueuedResponse>('/agent/plan-generations', {
      body: planGenerationInputSchema.parse(input),
      idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
      idempotent: true,
      method: 'POST',
      responseSchema: planGenerationQueuedResponseSchema,
    });
  }

  getAgentRequest(requestId: string): Promise<AgentRequestResponse> {
    const parsedRequestId = agentRequestIdSchema.parse(requestId);
    return this.#client.request<AgentRequestResponse>(
      `/agent/requests/${encodeURIComponent(parsedRequestId)}`,
      { responseSchema: agentRequestResponseSchema },
    );
  }

  listConversationMessages(
    conversationId: string,
    input: ConversationMessagesRequest = {},
  ): Promise<ConversationMessagesResponse> {
    const parsedConversationId = conversationIdSchema.parse(conversationId);
    const query = conversationMessagesQuerySchema.parse(input);
    return this.#client.request<ConversationMessagesResponse>(
      `/conversations/${encodeURIComponent(parsedConversationId)}/messages`,
      { query, responseSchema: conversationMessagesResponseSchema },
    );
  }

  markConversationViewed(
    conversationId: string,
    input: ConversationViewedRequest,
    idempotencyKey: string,
  ): Promise<ConversationViewedResponse> {
    const parsedConversationId = conversationIdSchema.parse(conversationId);
    return this.#client.request<ConversationViewedResponse>(
      `/conversations/${encodeURIComponent(parsedConversationId)}/viewed`,
      {
        body: conversationViewedInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'POST',
        responseSchema: conversationViewedResponseSchema,
      },
    );
  }

  answerConversationMessage(
    conversationId: string,
    messageId: string,
    input: MessageAnswerRequest,
    idempotencyKey: string,
  ): Promise<MessageAnswerResponse> {
    const parsedConversationId = conversationIdSchema.parse(conversationId);
    const parsedMessageId = agentMessageIdSchema.parse(messageId);
    return this.#client.request<MessageAnswerResponse>(
      `/conversations/${encodeURIComponent(parsedConversationId)}/messages/${encodeURIComponent(parsedMessageId)}/answers`,
      {
        body: messageAnswerInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'POST',
        responseSchema: messageAnswerResponseSchema,
      },
    );
  }

  editActionProposal(
    proposalId: string,
    input: ActionProposalEditRequest,
    idempotencyKey: string,
  ): Promise<ActionProposalMutationResponse> {
    const parsedProposalId = actionProposalIdSchema.parse(proposalId);
    return this.#client.request<ActionProposalMutationResponse>(
      `/action-proposals/${encodeURIComponent(parsedProposalId)}`,
      {
        body: actionProposalEditInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'PATCH',
        responseSchema: actionProposalMutationResponseSchema,
      },
    );
  }

  dismissActionProposal(
    proposalId: string,
    input: ActionProposalDismissRequest,
    idempotencyKey: string,
  ): Promise<ActionProposalMutationResponse> {
    const parsedProposalId = actionProposalIdSchema.parse(proposalId);
    return this.#client.request<ActionProposalMutationResponse>(
      `/action-proposals/${encodeURIComponent(parsedProposalId)}/dismiss`,
      {
        body: actionProposalDismissInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'POST',
        responseSchema: actionProposalDismissResponseSchema,
      },
    );
  }

  cancelActionProposal(
    proposalId: string,
    input: ActionProposalCancelRequest,
    idempotencyKey: string,
  ): Promise<ActionProposalMutationResponse> {
    const parsedProposalId = actionProposalIdSchema.parse(proposalId);
    return this.#client.request<ActionProposalMutationResponse>(
      `/action-proposals/${encodeURIComponent(parsedProposalId)}/cancel`,
      {
        body: actionProposalCancelInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'POST',
        responseSchema: actionProposalCancelResponseSchema,
      },
    );
  }

  confirmActionProposal(
    proposalId: string,
    input: ActionProposalConfirmRequest,
    idempotencyKey: string,
  ): Promise<ActionProposalConfirmResponse> {
    const parsedProposalId = actionProposalIdSchema.parse(proposalId);
    return this.#client.request<ActionProposalConfirmResponse>(
      `/action-proposals/${encodeURIComponent(parsedProposalId)}/confirm`,
      {
        body: actionProposalConfirmInputSchema.parse(input),
        idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
        idempotent: true,
        method: 'POST',
        responseSchema: actionProposalConfirmResponseSchema,
      },
    );
  }

  getSmartInbox(input: SmartInboxRequest = {}): Promise<SmartInboxResponse> {
    const query = smartInboxQuerySchema.parse(input);
    return this.#client.request<SmartInboxResponse>('/smart-inbox', {
      query,
      responseSchema: smartInboxResponseSchema,
    });
  }

  organizeSmartInbox(
    input: SmartInboxOrganizeRequest,
    idempotencyKey: string,
  ): Promise<SmartInboxOrganizeQueuedResponse> {
    return this.#client.request<SmartInboxOrganizeQueuedResponse>('/smart-inbox/organize', {
      body: smartInboxOrganizeInputSchema.parse(input),
      idempotencyKey: parseAgentIdempotencyKey(idempotencyKey),
      idempotent: true,
      method: 'POST',
      responseSchema: smartInboxOrganizeQueuedResponseSchema,
    });
  }
}
