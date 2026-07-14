import {
  archiveProjectInputSchema,
  authResponseSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  loginWithUsernameSchema,
  logoutResponseSchema,
  projectListQuerySchema,
  projectListResponseSchema,
  projectMutationResponseSchema,
  registerWithUsernameSchema,
  sessionResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskMutationResponseSchema,
  taskDeleteResponseSchema,
  undoExecutionResponseSchema,
  updateProjectInputSchema,
  updateTaskInputSchema,
  versionCommandSchema,
  type ArchiveProjectInput,
  type AuthResponse,
  type CreateProjectInput,
  type CreateTaskInput,
  type LoginWithUsernameInput,
  type ProjectListResponse,
  type ProjectMutationResponse,
  type PublicUser,
  type RegisterWithUsernameInput,
  type SessionResponse,
  type TaskDeleteResponse,
  type TaskListResponse,
  type TaskMutationResponse,
  type UndoExecutionResponse,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from '@ai-schedule/contracts';

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
}
