import { projectSchema, taskSchema } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import {
  createTaskFormValues,
  createTaskProjectOptions,
  createTaskUpdateInput,
} from './task-form-model';

const archivedTask = taskSchema.parse({
  id: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
  userId: '018f31f2-5be2-7d12-8ad8-0bb1830f92d4',
  projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
  project: {
    id: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
    name: '旧工作',
    colorKey: 'pink',
    status: 'ARCHIVED',
  },
  title: '写周报',
  description: '',
  status: 'TODO',
  priority: 'HIGH',
  scheduledAt: null,
  deadlineAt: null,
  reminderAt: null,
  completedAt: null,
  deletedAt: null,
  source: 'MANUAL',
  version: 3,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

const activeProject = projectSchema.parse({
  id: '018f31f2-7c27-7587-85f0-a62f4cc8e5c2',
  userId: archivedTask.userId,
  name: '新工作',
  colorKey: 'teal',
  status: 'ACTIVE',
  archivedAt: null,
  taskCount: 0,
  version: 1,
  createdAt: '2026-07-14T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
});

describe('task form model', () => {
  it('shows the current archived project alongside active reassignment choices', () => {
    expect(createTaskProjectOptions(archivedTask, [activeProject])).toEqual([
      { id: '', label: '未归属' },
      { id: archivedTask.projectId, label: '旧工作（已归档）' },
      { id: activeProject.id, label: '新工作' },
    ]);
  });

  it('submits only actual changes with the version captured when the form opened', () => {
    const values = createTaskFormValues(archivedTask, 'Asia/Shanghai');

    expect(
      createTaskUpdateInput(archivedTask, { ...values, title: '写月报' }, 'Asia/Shanghai'),
    ).toEqual({ version: 3, changes: { title: '写月报' } });
  });

  it('does not send an unchanged archived project id back through active-project validation', () => {
    const values = createTaskFormValues(archivedTask, 'Asia/Shanghai');

    expect(createTaskUpdateInput(archivedTask, values, 'Asia/Shanghai')).toBeNull();
  });

  it('allows an archived task to be deliberately reassigned to an active project', () => {
    const values = createTaskFormValues(archivedTask, 'Asia/Shanghai');

    expect(
      createTaskUpdateInput(
        archivedTask,
        { ...values, projectId: activeProject.id },
        'Asia/Shanghai',
      ),
    ).toEqual({ version: 3, changes: { projectId: activeProject.id } });
  });
});
