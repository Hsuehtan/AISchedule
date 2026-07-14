import { describe, expect, it } from 'vitest';

import { presentTask } from './task.presenter.js';

describe('presentTask', () => {
  it('serializes UTC fields and keeps project identity separate from priority', () => {
    const timestamp = new Date('2026-07-14T01:30:00.000Z');
    expect(
      presentTask({
        id: 'task-id',
        userId: 'user-id',
        projectId: 'project-id',
        project: {
          id: 'project-id',
          name: '工作',
          colorKey: 'purple',
          status: 'ACTIVE',
        },
        title: '写周报',
        description: '',
        status: 'TODO',
        priority: 'HIGH',
        scheduledAt: timestamp,
        deadlineAt: null,
        reminderAt: timestamp,
        completedAt: null,
        deletedAt: null,
        source: 'MANUAL',
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({
      priority: 'HIGH',
      project: { name: '工作', colorKey: 'purple' },
      scheduledAt: '2026-07-14T01:30:00.000Z',
      reminderAt: '2026-07-14T01:30:00.000Z',
    });
  });
});
