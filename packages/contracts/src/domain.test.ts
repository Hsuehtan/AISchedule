import { describe, expect, it } from 'vitest';

import {
  actionProposalSchema,
  agentRequestStatusSchema,
  createProjectInputSchema,
  createTaskInputSchema,
  projectListResponseSchema,
  projectSchema,
  taskDeleteResponseSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskSchema,
  undoExecutionResponseSchema,
  versionCommandSchema,
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

  it('defaults every new task to MEDIUM and rejects an unset priority', () => {
    expect(createTaskInputSchema.parse({ title: '写周报' }).priority).toBe('MEDIUM');
    expect(createTaskInputSchema.safeParse({ title: '写周报', priority: 'UNSET' }).success).toBe(
      false,
    );
  });

  it('accepts only a project name when creating a project', () => {
    expect(createProjectInputSchema.parse({ name: ' 工作 ' })).toEqual({ name: '工作' });
    expect(createProjectInputSchema.safeParse({ name: '工作', colorKey: 'pink' }).success).toBe(
      false,
    );
  });

  it('requires optimistic versions on persisted tasks', () => {
    const task = taskSchema.parse({
      id: taskId,
      userId,
      projectId: null,
      project: null,
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

  it('embeds the authoritative project summary in every task response', () => {
    const task = taskSchema.parse({
      id: taskId,
      userId,
      projectId,
      project: { id: projectId, name: '工作', colorKey: 'pink', status: 'ARCHIVED' },
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
      version: 2,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
    });

    expect(task.project).toMatchObject({ name: '工作', status: 'ARCHIVED' });
    expect(taskSchema.safeParse({ ...task, project: null }).success).toBe(false);
  });

  it('locks list pagination, counts and optimistic mutation envelopes', () => {
    expect(taskListQuerySchema.parse({ limit: '20' })).toEqual({ status: 'TODO', limit: 20 });
    expect(versionCommandSchema.parse({ version: 3 })).toEqual({ version: 3 });

    const task = taskSchema.parse({
      id: taskId,
      userId,
      projectId: null,
      project: null,
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

    expect(
      taskListResponseSchema.parse({
        items: [task],
        pageInfo: { nextCursor: null },
        counts: { todo: 1, completed: 0 },
      }).counts.todo,
    ).toBe(1);

    const deleteResponse = taskDeleteResponseSchema.parse({
      task: { ...task, deletedAt: '2026-07-13T12:00:01.000Z', version: 2 },
      undoOperation: {
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a67',
        expiresAt: '2026-07-13T12:00:04.000Z',
      },
    });
    expect(deleteResponse.undoOperation.expiresAt).toBe('2026-07-13T12:00:04.000Z');

    expect(
      undoExecutionResponseSchema.parse({
        task: { ...task, version: 3 },
        undoOperation: {
          id: deleteResponse.undoOperation.id,
          status: 'EXECUTED',
          executedAt: '2026-07-13T12:00:02.000Z',
        },
      }).undoOperation.status,
    ).toBe('EXECUTED');
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

  it('returns paginated projects with server-derived task counts', () => {
    expect(
      projectListResponseSchema.parse({
        items: [
          {
            id: projectId,
            userId,
            name: '工作',
            colorKey: 'pink',
            status: 'ACTIVE',
            archivedAt: null,
            taskCount: 2,
            version: 1,
            createdAt: '2026-07-13T12:00:00.000Z',
            updatedAt: '2026-07-13T12:00:00.000Z',
          },
        ],
        pageInfo: { nextCursor: null },
      }).items[0]?.taskCount,
    ).toBe(2);
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
