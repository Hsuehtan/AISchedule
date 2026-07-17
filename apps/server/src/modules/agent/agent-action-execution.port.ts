import type { ActionProposalConfirmResponse } from '@ai-schedule/contracts';

import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_ACTION_EXECUTION_PORT = Symbol('AgentActionExecutionPort');

export type ExecutableActionCode =
  | 'COMPLETE_TASK'
  | 'CREATE_PROJECT_TASKS'
  | 'CREATE_TASK'
  | 'DELETE_TASK'
  | 'ORGANIZE_TASKS'
  | 'RESTORE_TASK'
  | 'UPDATE_TASK';

export interface ExecutableActionMutation {
  readonly id: string;
  readonly sequence: number;
  readonly operation: 'COMPLETE' | 'CREATE' | 'RESTORE' | 'SOFT_DELETE' | 'UPDATE';
  readonly targetType: 'PROJECT' | 'TASK';
  readonly targetId: string | null;
  readonly targetVersion: number | null;
  readonly afterValue: Readonly<Record<string, unknown>>;
}

export interface ExecutableActionProposal {
  readonly id: string;
  readonly userId: string;
  readonly actionCode: ExecutableActionCode;
  readonly version: number;
  readonly mutations: readonly ExecutableActionMutation[];
}

export interface ActionExecutionResult {
  readonly projectId: string | null;
  readonly taskIds: readonly string[];
  readonly undoOperationId: string | null;
  readonly undoExpiresAt: string | null;
}

export type ActionExecutionFailureCode =
  | 'ACTION_EXECUTION_FAILED'
  | 'ACTION_PROJECT_NAME_CONFLICT'
  | 'ACTION_TARGET_NOT_FOUND'
  | 'ACTION_TARGET_VERSION_CONFLICT';

export interface AgentActionExecutionPort {
  claim(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      proposalVersion: number;
      idempotencyKey: string;
      confirmedAt: Date;
    }>,
  ): Promise<
    | Readonly<{ kind: 'REPLAY'; response: ActionProposalConfirmResponse }>
    | Readonly<{
        kind: 'REJECTED';
        error: Readonly<{
          code: 'ACTION_PROPOSAL_NOT_EXECUTABLE';
          message: string;
        }>;
      }>
    | Readonly<{
        kind: 'CLAIMED';
        executionId: string;
        proposal: ExecutableActionProposal;
      }>
  >;

  complete(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      executionId: string;
      result: ActionExecutionResult;
      executedAt: Date;
    }>,
  ): Promise<ActionProposalConfirmResponse>;

  fail(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      proposalId: string;
      executionId: string;
      error: Readonly<{ code: ActionExecutionFailureCode; message: string }>;
      failedAt: Date;
    }>,
  ): Promise<ActionProposalConfirmResponse>;
}

export class ActionTargetNotFoundError extends Error {
  constructor() {
    super('The action target does not exist or is not owned by the user');
    this.name = 'ActionTargetNotFoundError';
  }
}

export class ActionTargetVersionConflictError extends Error {
  constructor() {
    super('The action target version no longer matches');
    this.name = 'ActionTargetVersionConflictError';
  }
}

export class ActionProjectNameConflictError extends Error {
  constructor() {
    super('An active project with this name already exists');
    this.name = 'ActionProjectNameConflictError';
  }
}
