import { describe, expect, it } from 'vitest';

import {
  actionProposalSchema,
  agentRequestStatusSchema,
  createTaskInputSchema,
  projectSchema,
  taskSchema,
} from './index.js';

const userId = '018f47be-1972-7d58-9d67-4ddc5eb78a63';
const taskId = '018f47be-1972-7d58-9d67-4ddc5eb78a64';
const projectId = '018f47be-1972-7d58-9d67-4ddc5eb78a65';
const proposalId = '018f47be-1972-7d58-9d67-4ddc5eb78a66';

describe('task and project contracts', () => {
  it('validates create input without allowing ownership fields', () => {
    expect(
      createTaskInputSchema.parse({
        title: '写周报',
        projectId,
        priority: 'HIGH',
        deadlineAt: '2026-07-14T12:00:00.000Z',
      }),
    ).toMatchObject({ title: '写周报', priority: 'HIGH' });

    expect(createTaskInputSchema.safeParse({ title: '写周报', userId }).success).toBe(false);
  });

  it('requires optimistic versions on persisted tasks', () => {
    const task = taskSchema.parse({
      id: taskId,
      userId,
      projectId: null,
      title: '写周报',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      scheduledAt: null,
      deadlineAt: null,
      reminderAt: null,
      completedAt: null,
      deletedAt: null,
      source: 'MANUAL',
      version: 1,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
    });

    expect(task.version).toBe(1);
    expect(taskSchema.safeParse({ ...task, version: 0 }).success).toBe(false);
  });

  it('represents active and archived projects explicitly', () => {
    expect(
      projectSchema.parse({
        id: projectId,
        userId,
        name: '工作',
        colorKey: 'pink',
        status: 'ACTIVE',
        archivedAt: null,
        taskCount: 1,
        version: 1,
        createdAt: '2026-07-13T12:00:00.000Z',
        updatedAt: '2026-07-13T12:00:00.000Z',
      }).status,
    ).toBe('ACTIVE');
  });
});

describe('Agent contracts', () => {
  it('locks the asynchronous request states', () => {
    expect(agentRequestStatusSchema.parse('RESULT_PERSISTED')).toBe('RESULT_PERSISTED');
    expect(agentRequestStatusSchema.safeParse('DONE').success).toBe(false);
  });

  it('accepts a server-owned, versioned proposal and rejects unknown mutations', () => {
    const proposal = {
      id: proposalId,
      status: 'READY',
      summary: '创建一项待办',
      version: 1,
      mutations: [
        {
          type: 'CREATE_TASK',
          clientRef: 'draft-1',
          input: { title: '准备发布说明', priority: 'MEDIUM' },
        },
      ],
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
    };

    expect(actionProposalSchema.parse(proposal).mutations).toHaveLength(1);
    expect(
      actionProposalSchema.safeParse({
        ...proposal,
        mutations: [{ type: 'DROP_DATABASE' }],
      }).success,
    ).toBe(false);
  });
});
