type ProjectRecord = {
  id: string;
  name: string;
  colorKey: string;
  status: string;
};

export type TaskRecord = {
  id: string;
  userId: string;
  projectId: string | null;
  project: ProjectRecord | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  scheduledAt: Date | null;
  deadlineAt: Date | null;
  reminderAt: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  source: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function presentTask(task: TaskRecord) {
  return {
    id: task.id,
    userId: task.userId,
    projectId: task.projectId,
    project:
      task.project === null
        ? null
        : {
            id: task.project.id,
            name: task.project.name,
            colorKey: task.project.colorKey,
            status: task.project.status,
          },
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    scheduledAt: iso(task.scheduledAt),
    deadlineAt: iso(task.deadlineAt),
    reminderAt: iso(task.reminderAt),
    completedAt: iso(task.completedAt),
    deletedAt: iso(task.deletedAt),
    source: task.source,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
