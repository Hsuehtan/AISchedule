import {
  createTaskInputSchema,
  updateTaskInputSchema,
  type CreateTaskInput,
  type Project,
  type Task,
  type UpdateTaskInput,
} from '@ai-schedule/contracts';

import { localDateTimeToUtc, utcToLocalDateTime } from './task-presentation';

export type TaskFormValues = {
  deadlineAt: string;
  description: string;
  priority: Task['priority'];
  projectId: string;
  reminderAt: string;
  scheduledAt: string;
  title: string;
};

export type TaskProjectOption = { id: string; label: string };

export function createTaskFormValues(task: Task | null, timeZone: string): TaskFormValues {
  return {
    deadlineAt: utcToLocalDateTime(task?.deadlineAt ?? null, timeZone),
    description: task?.description ?? '',
    priority: task?.priority ?? 'MEDIUM',
    projectId: task?.projectId ?? '',
    reminderAt: utcToLocalDateTime(task?.reminderAt ?? null, timeZone),
    scheduledAt: utcToLocalDateTime(task?.scheduledAt ?? null, timeZone),
    title: task?.title ?? '',
  };
}

export function createTaskProjectOptions(
  task: Task | null,
  projects: Project[],
): TaskProjectOption[] {
  const activeOptions = projects.map((project) => ({ id: project.id, label: project.name }));
  const currentProject = task?.project;
  const missingCurrent =
    currentProject && !activeOptions.some((project) => project.id === currentProject.id)
      ? {
          id: currentProject.id,
          label: `${currentProject.name}${currentProject.status === 'ARCHIVED' ? '（已归档）' : ''}`,
        }
      : null;

  return [
    { id: '', label: '未归属' },
    ...(missingCurrent ? [missingCurrent] : []),
    ...activeOptions,
  ];
}

export function createTaskCreateInput(values: TaskFormValues, timeZone: string): CreateTaskInput {
  return createTaskInputSchema.parse({
    deadlineAt: localDateTimeToUtc(values.deadlineAt, timeZone),
    description: values.description,
    priority: values.priority,
    projectId: values.projectId || null,
    reminderAt: localDateTimeToUtc(values.reminderAt, timeZone),
    scheduledAt: localDateTimeToUtc(values.scheduledAt, timeZone),
    title: values.title,
  });
}

export function createTaskUpdateInput(
  taskSnapshot: Task,
  values: TaskFormValues,
  timeZone: string,
): UpdateTaskInput | null {
  const candidate = createTaskCreateInput(values, timeZone);
  const changes: Record<string, unknown> = {};

  if (candidate.title !== taskSnapshot.title) changes.title = candidate.title;
  if ((candidate.description ?? '') !== taskSnapshot.description) {
    changes.description = candidate.description ?? '';
  }
  if ((candidate.projectId ?? null) !== taskSnapshot.projectId) {
    changes.projectId = candidate.projectId ?? null;
  }
  if (candidate.priority !== taskSnapshot.priority) changes.priority = candidate.priority;
  if ((candidate.scheduledAt ?? null) !== taskSnapshot.scheduledAt) {
    changes.scheduledAt = candidate.scheduledAt ?? null;
  }
  if ((candidate.deadlineAt ?? null) !== taskSnapshot.deadlineAt) {
    changes.deadlineAt = candidate.deadlineAt ?? null;
  }
  if ((candidate.reminderAt ?? null) !== taskSnapshot.reminderAt) {
    changes.reminderAt = candidate.reminderAt ?? null;
  }

  if (Object.keys(changes).length === 0) return null;
  return updateTaskInputSchema.parse({ changes, version: taskSnapshot.version });
}
