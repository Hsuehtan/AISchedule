import type { TransactionScope } from '../../platform/database/unit-of-work.js';

export const AGENT_PROJECTS_PORT = Symbol('AgentProjectsPort');

export interface AgentProjectSnapshot {
  readonly id: string;
  readonly name: string;
  readonly version: number;
}

export interface AgentProjectsPort {
  findActiveAgentProjectName(
    scope: TransactionScope,
    input: Readonly<{ userId: string; projectId: string }>,
  ): Promise<string | null>;

  listAgentCandidates(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      limit: number;
      projectIds?: readonly string[] | undefined;
    }>,
  ): Promise<
    readonly Readonly<{
      id: string;
      name: string;
      version: number;
    }>[]
  >;

  findActiveAgentProject(
    scope: TransactionScope,
    input: Readonly<{ userId: string; projectId: string }>,
  ): Promise<AgentProjectSnapshot | null>;

  prepare(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      existingProjects: readonly Readonly<{ projectId: string; version: number }>[];
      newProjectNames: readonly string[];
    }>,
  ): Promise<void>;

  create(
    scope: TransactionScope,
    input: Readonly<{
      userId: string;
      name: string;
      sourceActionId: string;
    }>,
  ): Promise<Readonly<{ id: string }>>;
}
