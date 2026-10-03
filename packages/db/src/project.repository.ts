import { ProjectStatus, RecordSource, TaskStatus } from './generated/prisma/client.js';
import type { Prisma } from './generated/prisma/client.js';
import type { DatabaseClient } from './client.js';
import {
  OptimisticWriteConflictError,
  RepositoryInvalidStateError,
  RepositoryNameConflictError,
  RepositoryRecordNotFoundError,
} from './repository.errors.js';

export const PROJECT_COLOR_KEYS = ['pink', 'teal', 'purple', 'amber', 'cyan', 'slate'] as const;

export type ProjectColorKey = (typeof PROJECT_COLOR_KEYS)[number];

export interface CreateProjectRecord {
  readonly name: string;
  readonly source?: (typeof RecordSource)[keyof typeof RecordSource] | undefined;
  readonly sourceActionId?: string | undefined;
}

export interface ListProjectRecordsInput {
  readonly status?: (typeof ProjectStatus)[keyof typeof ProjectStatus] | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

type RepositoryClient = DatabaseClient | Prisma.TransactionClient;

function isDatabaseClient(client: RepositoryClient): client is DatabaseClient {
  return '$transaction' in client;
}

function withTransaction<T>(
  client: RepositoryClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return isDatabaseClient(client) ? client.$transaction(operation) : operation(client);
}

const projectTaskCount = {
  tasks: {
    where: {
      status: TaskStatus.TODO,
      deletedAt: null,
    },
  },
} satisfies Prisma.ProjectCountOutputTypeSelect;

export function normalizeProjectName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function projectWithTaskCount<T extends { _count: { tasks: number } }>(project: T) {
  const { _count, ...record } = project;
  return { ...record, taskCount: _count.tasks };
}

async function findProjectWithCount(client: RepositoryClient, userId: string, projectId: string) {
  const project = await client.project.findFirst({
    where: { id: projectId, userId },
    include: { _count: { select: projectTaskCount } },
  });

  if (!project) {
    throw new RepositoryRecordNotFoundError('Project');
  }

  return projectWithTaskCount(project);
}

async function classifyProjectWriteFailure(
  client: RepositoryClient,
  userId: string,
  projectId: string,
  version: number,
): Promise<never> {
  const project = await client.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    throw new RepositoryRecordNotFoundError('Project');
  }
  if (project.version !== version) {
    throw new OptimisticWriteConflictError();
  }
  throw new RepositoryInvalidStateError(project.status);
}

function selectProjectColor(
  usage: ReadonlyArray<{ colorKey: string; _count: { _all: number } }>,
): ProjectColorKey {
  const counts = new Map<ProjectColorKey, number>(PROJECT_COLOR_KEYS.map((color) => [color, 0]));
  for (const entry of usage) {
    if (PROJECT_COLOR_KEYS.includes(entry.colorKey as ProjectColorKey)) {
      counts.set(entry.colorKey as ProjectColorKey, entry._count._all);
    }
  }

  return PROJECT_COLOR_KEYS.reduce((selected, color) =>
    (counts.get(color) ?? 0) < (counts.get(selected) ?? 0) ? color : selected,
  );
}

async function lockProjectColorAllocation(client: RepositoryClient, userId: string): Promise<void> {
  await client.$queryRaw<Array<{ lock: string }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))::text AS "lock"
  `;
}

export class ProjectRepository {
  constructor(private readonly db: RepositoryClient) {}

  listAgentCandidates(
    userId: string,
    input: Readonly<{ limit: number; offset?: number; projectIds?: readonly string[] | undefined }>,
  ) {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new TypeError('Project candidate limit must be a positive safe integer');
    }
    if (input.projectIds && new Set(input.projectIds).size !== input.projectIds.length) {
      throw new TypeError('Project candidate IDs must be unique');
    }
    return this.db.project.findMany({
      where: {
        userId,
        status: ProjectStatus.ACTIVE,
        ...(input.projectIds === undefined ? {} : { id: { in: [...input.projectIds] } }),
      },
      select: { id: true, name: true, version: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.limit,
      skip: input.offset ?? 0,
    });
  }

  async findActiveAgentProjectName(userId: string, projectId: string): Promise<string | null> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, userId, status: ProjectStatus.ACTIVE },
      select: { name: true },
    });
    return project?.name ?? null;
  }

  async findActiveAgentProject(userId: string, projectId: string) {
    return this.db.project.findFirst({
      where: { id: projectId, userId, status: ProjectStatus.ACTIVE },
      select: { id: true, name: true, version: true },
    });
  }

  async prepareWrite(
    userId: string,
    input: Readonly<{
      activeProjects: readonly Readonly<{ projectId: string; version: number }>[];
      newProjectNames: readonly string[];
    }>,
  ): Promise<void> {
    const activeProjects = [...input.activeProjects].sort((left, right) =>
      left.projectId.localeCompare(right.projectId),
    );
    const normalizedNames = input.newProjectNames.map(normalizeProjectName);
    if (
      new Set(activeProjects.map(({ projectId }) => projectId)).size !== activeProjects.length ||
      new Set(normalizedNames).size !== normalizedNames.length
    ) {
      throw new TypeError('Project write preparation requires unique targets and names');
    }

    return withTransaction(this.db, async (transaction) => {
      if (normalizedNames.length > 0) {
        await lockProjectColorAllocation(transaction, userId);
      }
      for (const project of activeProjects) {
        const rows = await transaction.$queryRaw<Array<{ status: string; version: number }>>`
          SELECT "status"::text AS "status", "version"
          FROM "projects"
          WHERE "id" = ${project.projectId}::uuid
            AND "user_id" = ${userId}::uuid
          FOR UPDATE
        `;
        if (!rows[0] || rows[0].status !== ProjectStatus.ACTIVE) {
          throw new RepositoryRecordNotFoundError('Project');
        }
        if (rows[0].version !== project.version) throw new OptimisticWriteConflictError();
      }
      for (const nameNormalized of normalizedNames) {
        const existing = await transaction.project.findFirst({
          where: { userId, nameNormalized, status: ProjectStatus.ACTIVE },
          select: { id: true },
        });
        if (existing) throw new RepositoryNameConflictError('Project');
      }
    });
  }

  create(userId: string, input: CreateProjectRecord) {
    const name = input.name.trim();

    return withTransaction(this.db, async (transaction) => {
      // Project colors are allocated from aggregate state. A transaction-scoped advisory
      // lock serializes one user's allocation without upgrading the FK KEY SHARE lock held
      // by the idempotency row insert (which could deadlock with another concurrent create).
      await lockProjectColorAllocation(transaction, userId);
      const usage = await transaction.project.groupBy({
        by: ['colorKey'],
        where: { userId, status: ProjectStatus.ACTIVE },
        _count: { _all: true },
      });
      const colorKey = selectProjectColor(usage);
      const project = await transaction.project.create({
        data: {
          userId,
          name,
          nameNormalized: normalizeProjectName(name),
          colorKey,
          source: input.source ?? RecordSource.MANUAL,
          ...(input.sourceActionId === undefined ? {} : { sourceActionId: input.sourceActionId }),
        },
      });

      return { ...project, taskCount: 0 };
    });
  }

  async list(userId: string, input: ListProjectRecordsInput = {}) {
    const limit = input.limit ?? 50;
    const projects = await this.db.project.findMany({
      where: { userId, status: input.status ?? ProjectStatus.ACTIVE },
      include: { _count: { select: projectTaskCount } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(input.cursor === undefined ? {} : { cursor: { id: input.cursor }, skip: 1 }),
    });

    const hasNextPage = projects.length > limit;
    const page = hasNextPage ? projects.slice(0, limit) : projects;
    return {
      items: page.map(projectWithTaskCount),
      nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async updateName(userId: string, projectId: string, version: number, value: string) {
    const name = value.trim();
    return withTransaction(this.db, async (transaction) => {
      const result = await transaction.project.updateMany({
        where: {
          id: projectId,
          userId,
          version,
          status: ProjectStatus.ACTIVE,
        },
        data: {
          name,
          nameNormalized: normalizeProjectName(name),
          version: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        await classifyProjectWriteFailure(transaction, userId, projectId, version);
      }

      return findProjectWithCount(transaction, userId, projectId);
    });
  }

  async archive(userId: string, projectId: string, version: number) {
    const archivedAt = new Date();
    return withTransaction(this.db, async (transaction) => {
      const result = await transaction.project.updateMany({
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
        await classifyProjectWriteFailure(transaction, userId, projectId, version);
      }

      return findProjectWithCount(transaction, userId, projectId);
    });
  }
}
