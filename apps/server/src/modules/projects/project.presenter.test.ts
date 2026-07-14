import { describe, expect, it } from 'vitest';

import { presentProject } from './project.presenter.js';

describe('presentProject', () => {
  it('serializes archived state and the server-derived open task count', () => {
    const timestamp = new Date('2026-07-14T03:00:00.000Z');
    expect(
      presentProject({
        id: 'project-id',
        userId: 'user-id',
        name: '工作',
        colorKey: 'pink',
        status: 'ARCHIVED',
        archivedAt: timestamp,
        taskCount: 2,
        version: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ).toMatchObject({
      name: '工作',
      status: 'ARCHIVED',
      archivedAt: '2026-07-14T03:00:00.000Z',
      taskCount: 2,
    });
  });
});
