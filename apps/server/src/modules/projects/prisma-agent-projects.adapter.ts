import {
  OptimisticWriteConflictError,
  ProjectRepository,
  RepositoryNameConflictError,
  RepositoryRecordNotFoundError,
} from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import { DatabaseUnitOfWork, type TransactionScope } from '../../platform/database/unit-of-work.js';
import {
  ActionProjectNameConflictError,
  ActionTargetNotFoundError,
  ActionTargetVersionConflictError,
} from '../agent/agent-action-execution.port.js';
import type { AgentProjectsPort } from './agent-projects.port.js';

@Injectable()
export class PrismaAgentProjectsAdapter implements AgentProjectsPort {
  constructor(@Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork) {}

  findActiveAgentProjectName(
    scope: TransactionScope,
    input: Parameters<AgentProjectsPort['findActiveAgentProjectName']>[1],
  ): ReturnType<AgentProjectsPort['findActiveAgentProjectName']> {
    return this.repository(scope).findActiveAgentProjectName(input.userId, input.projectId);
  }

  listAgentCandidates(
    scope: TransactionScope,
    input: Parameters<AgentProjectsPort['listAgentCandidates']>[1],
  ): ReturnType<AgentProjectsPort['listAgentCandidates']> {
    return this.repository(scope).listAgentCandidates(input.userId, {
      limit: input.limit,
      ...(input.projectIds === undefined ? {} : { projectIds: input.projectIds }),
    });
  }

  findActiveAgentProject(
    scope: TransactionScope,
    input: Parameters<AgentProjectsPort['findActiveAgentProject']>[1],
  ): ReturnType<AgentProjectsPort['findActiveAgentProject']> {
    return this.repository(scope).findActiveAgentProject(input.userId, input.projectId);
  }

  async prepare(
    scope: TransactionScope,
    input: Parameters<AgentProjectsPort['prepare']>[1],
  ): Promise<void> {
    try {
      await this.repository(scope).prepareWrite(input.userId, {
        activeProjects: input.existingProjects,
        newProjectNames: input.newProjectNames,
      });
    } catch (error) {
      rethrowProjectActionError(error);
    }
  }

  async create(
    scope: TransactionScope,
    input: Parameters<AgentProjectsPort['create']>[1],
  ): Promise<Readonly<{ id: string }>> {
    try {
      const project = await this.repository(scope).create(input.userId, {
        name: input.name,
        source: 'AGENT',
        sourceActionId: input.sourceActionId,
      });
      return { id: project.id };
    } catch (error) {
      rethrowProjectActionError(error);
    }
  }

  private repository(scope: TransactionScope): ProjectRepository {
    return new ProjectRepository(this.unitOfWork.clientFor(scope));
  }
}

function rethrowProjectActionError(error: unknown): never {
  if (error instanceof RepositoryRecordNotFoundError) throw new ActionTargetNotFoundError();
  if (error instanceof OptimisticWriteConflictError) throw new ActionTargetVersionConflictError();
  if (error instanceof RepositoryNameConflictError || prismaCode(error) === 'P2002') {
    throw new ActionProjectNameConflictError();
  }
  throw error;
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
