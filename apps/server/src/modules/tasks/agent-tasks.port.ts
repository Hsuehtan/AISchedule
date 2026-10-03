import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_TASKS_PORT = Symbol('AgentTasksPort');

export type AgentTaskTargetState = 'COMPLETED' | 'TODO';

export interface AgentTaskTarget {
  readonly taskId: string;
  readonly version: number;
  readonly expectedStatus?: AgentTaskTargetState | undefined;
}

export interface AgentTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly projectId: string | null;
  readonly priority: 'HIGH' | 'LOW' | 'MEDIUM';
  readonly scheduledAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly reminderAt: Date | null;
}

export interface AgentTaskChanges {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly priority?: 'HIGH' | 'LOW' | 'MEDIUM' | undefined;
  readonly scheduledAt?: Date | null | undefined;
  readonly deadlineAt?: Date | null | undefined;
  readonly reminderAt?: Date | null | undefined;
}

export interface AgentTaskSnapshot {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly version: number;
  readonly status: AgentTaskTargetState;
  readonly priority: 'HIGH' | 'LOW' | 'MEDIUM';
  readonly projectId: string | null;
  readonly scheduledAt: Date | null;
  readonly deadlineAt: Date | null;
  readonly reminderAt: Date | null;
}

export interface AgentTasksPort {
  getAgentScopeCounts(
    scope: TransactionScope,
    input: Readonly<{ userId: string; projectId?: string | undefined }>,
  ): Promise<Readonly<{ todoCount: number; unprojectedTodoCount: number }>>;

  listAgentCandidates(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      limit: number;
      offset?: number;
      onlyUnassigned: boolean;
      statuses: readonly AgentTaskTargetState[];
    }>,
  ): Promise<
    readonly Readonly<{
      id: string;
      title: string;
      version: number;
      status: AgentTaskTargetState;
      priority: 'HIGH' | 'LOW' | 'MEDIUM';
      scheduledAt: Date | null;
      deadlineAt: Date | null;
    }>[]
  >;

  findAgentTask(
    scope: TransactionScope,
    input: Readonly<{ userId: string; taskId: string }>,
  ): Promise<AgentTaskSnapshot | null>;

  prepare(
    scope: TransactionScope,
    input: Readonly<{ userId: string; targets: readonly AgentTaskTarget[] }>,
  ): Promise<void>;

  create(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      sourceActionId: string;
      draft: AgentTaskDraft;
    }>,
  ): Promise<Readonly<{ id: string }>>;

  update(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      taskId: string;
      version: number;
      changes: AgentTaskChanges;
    }>,
  ): Promise<Readonly<{ id: string }>>;

  complete(
    scope: TransactionScope,
    input: Readonly<{ userId: string; taskId: string; version: number }>,
  ): Promise<Readonly<{ id: string }>>;

  restore(
    scope: TransactionScope,
    input: Readonly<{ userId: string; taskId: string; version: number }>,
  ): Promise<Readonly<{ id: string }>>;

  softDeleteMany(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      executionId: string;
      sourceOperationId: string;
      targets: readonly Readonly<{ taskId: string; version: number }>[];
    }>,
  ): Promise<
    Readonly<{
      taskIds: readonly string[];
      undoOperation: Readonly<{ id: string; expiresAt: Date }>;
    }>
  >;
}
