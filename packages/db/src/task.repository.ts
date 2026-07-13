import { RecordSource, TaskPriority } from './generated/prisma/client';
import type { DatabaseClient } from './client';

export interface CreateTaskRecord {
  readonly title: string;
  readonly description?: string;
  readonly projectId?: string | null;
  readonly priority?: (typeof TaskPriority)[keyof typeof TaskPriority];
  readonly scheduledAt?: Date | null;
  readonly deadlineAt?: Date | null;
  readonly reminderAt?: Date | null;
  readonly source?: (typeof RecordSource)[keyof typeof RecordSource];
  readonly sourceActionId?: string;
}

export class TaskRepository {
  constructor(private readonly db: DatabaseClient) {}

  create(userId: string, input: CreateTaskRecord) {
    return this.db.task.create({
      data: {
        userId,
        title: input.title.trim(),
        description: input.description ?? '',
        priority: input.priority ?? TaskPriority.MEDIUM,
        source: input.source ?? RecordSource.MANUAL,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.scheduledAt === undefined ? {} : { scheduledAt: input.scheduledAt }),
        ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
        ...(input.reminderAt === undefined ? {} : { reminderAt: input.reminderAt }),
        ...(input.sourceActionId === undefined ? {} : { sourceActionId: input.sourceActionId }),
      },
    });
  }

  listActiveByUser(userId: string) {
    return this.db.task.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
    });
  }
}
