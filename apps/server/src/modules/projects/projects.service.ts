import type {
  ArchiveProjectInput,
  CreateProjectInput,
  ProjectListQuery,
  UpdateProjectInput,
} from '@ai-schedule/contracts';
import { ProjectRepository } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/database.service.js';
import { rethrowProjectRepositoryError } from '../../platform/http/repository-error.js';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { presentProject } from './project.presenter.js';

@Injectable()
export class ProjectsService {
  private readonly repository: ProjectRepository;

  constructor(
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {
    this.repository = new ProjectRepository(database.client);
  }

  create(userId: string, key: string, input: CreateProjectInput) {
    return this.idempotency.execute({
      userId,
      scope: 'PROJECT_CREATE',
      key,
      request: input,
      responseStatus: 201,
      operation: async ({ transaction }) => {
        try {
          return {
            project: presentProject(await new ProjectRepository(transaction).create(userId, input)),
          };
        } catch (error) {
          rethrowProjectRepositoryError(error);
        }
      },
    });
  }

  async list(userId: string, input: ProjectListQuery) {
    try {
      const page = await this.repository.list(userId, input);
      return {
        items: page.items.map(presentProject),
        pageInfo: { nextCursor: page.nextCursor },
      };
    } catch (error) {
      rethrowProjectRepositoryError(error);
    }
  }

  update(userId: string, projectId: string, key: string, input: UpdateProjectInput) {
    return this.idempotency.execute({
      userId,
      scope: `PROJECT_UPDATE:${projectId}`,
      key,
      request: input,
      responseStatus: 200,
      operation: async ({ transaction }) => {
        try {
          return {
            project: presentProject(
              await new ProjectRepository(transaction).updateName(
                userId,
                projectId,
                input.version,
                input.changes.name,
              ),
            ),
          };
        } catch (error) {
          rethrowProjectRepositoryError(error);
        }
      },
    });
  }

  archive(userId: string, projectId: string, key: string, input: ArchiveProjectInput) {
    return this.idempotency.execute({
      userId,
      scope: `PROJECT_ARCHIVE:${projectId}`,
      key,
      request: input,
      responseStatus: 200,
      operation: async ({ transaction }) => {
        try {
          return {
            project: presentProject(
              await new ProjectRepository(transaction).archive(userId, projectId, input.version),
            ),
          };
        } catch (error) {
          rethrowProjectRepositoryError(error);
        }
      },
    });
  }
}
