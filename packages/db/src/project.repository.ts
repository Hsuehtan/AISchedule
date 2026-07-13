import { ProjectStatus, RecordSource } from './generated/prisma/client';
import type { DatabaseClient } from './client';

export interface CreateProjectRecord {
  readonly name: string;
  readonly colorKey: string;
  readonly source?: (typeof RecordSource)[keyof typeof RecordSource];
  readonly sourceActionId?: string;
}

export class OptimisticWriteConflictError extends Error {
  constructor() {
    super('The record version no longer matches');
    this.name = 'OptimisticWriteConflictError';
  }
}

export function normalizeProjectName(value: string): string {
  return value.normalize('NFKC').trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export class ProjectRepository {
  constructor(private readonly db: DatabaseClient) {}

  create(userId: string, input: CreateProjectRecord) {
    const name = input.name.trim();

    return this.db.project.create({
      data: {
        userId,
        name,
        nameNormalized: normalizeProjectName(name),
        colorKey: input.colorKey,
        source: input.source ?? RecordSource.MANUAL,
        ...(input.sourceActionId === undefined
          ? {}
          : { sourceActionId: input.sourceActionId }),
      },
    });
  }

  async archive(userId: string, projectId: string, version: number) {
    const archivedAt = new Date();
    const result = await this.db.project.updateMany({
      where: {
        id: projectId,
        userId,
        version,
        status: ProjectStatus.ACTIVE,
      },
      data: {
        status: ProjectStatus.ARCHIVED,
        archivedAt,
        version: { increment: 1 },
      },
    });

    if (result.count !== 1) {
      throw new OptimisticWriteConflictError();
    }

    return this.db.project.findFirstOrThrow({ where: { id: projectId, userId } });
  }
}
