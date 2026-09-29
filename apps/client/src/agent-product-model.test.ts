import {
  publicActionProposalSchema,
  projectSchema,
  type PublicActionProposal,
} from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  actionProposalPresentation,
  agentUnavailableReason,
  createTaskDraftChanges,
  isAgentRequestTerminal,
} from './agent-product-model';

const project = projectSchema.parse({
  archivedAt: null,
  colorKey: 'pink',
  createdAt: '2026-07-17T12:00:00.000Z',
  id: '018f47be-1972-7d58-9d67-4ddc5eb78a60',
  name: '面试',
  status: 'ACTIVE',
  taskCount: 0,
  updatedAt: '2026-07-17T12:00:00.000Z',
  userId: '018f47be-1972-7d58-9d67-4ddc5eb78a61',
  version: 1,
});

function proposal(value: unknown): PublicActionProposal {
  return publicActionProposalSchema.parse(value);
}

describe('Agent product model', () => {
  it('maps task mutations to safe editable rows without exposing opaque JSON directly', () => {
    const value = proposal({
      actionCode: 'CREATE_PROJECT_TASKS',
      presentation: 'PLAN',
      conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
      createdAt: '2026-07-17T12:00:00.000Z',
      expiresAt: '2026-07-24T12:00:00.000Z',
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
      lastDismissedAt: null,
      mutations: [
        {
          afterValue: { name: '面试' },
          beforeValue: null,
          fieldSource: 'AGENT_SUGGESTION',
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
          operation: 'CREATE',
          sequence: 1,
          targetId: null,
          targetType: 'PROJECT',
          targetVersion: null,
        },
        {
          afterValue: {
            deadlineAt: null,
            priority: 'HIGH',
            project: { projectId: project.id, type: 'EXISTING' },
            reminderAt: '2026-07-19T01:30:00.000Z',
            scheduledAt: '2026-07-18T01:00:00.000Z',
            title: '整理项目经历',
          },
          beforeValue: null,
          fieldSource: 'AGENT_SUGGESTION',
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
          operation: 'CREATE',
          sequence: 2,
          targetId: null,
          targetType: 'TASK',
          targetVersion: null,
        },
      ],
      status: 'AWAITING_CONFIRMATION',
      title: '产品经理面试计划',
      updatedAt: '2026-07-17T12:00:00.000Z',
      version: 3,
    });

    expect(actionProposalPresentation(value, [project], 'Asia/Shanghai')).toEqual({
      id: value.id,
      items: [
        {
          deadlineAt: '',
          editable: true,
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
          priority: 'HIGH',
          project: { projectId: project.id, type: 'EXISTING' },
          projectName: '面试',
          reminderAt: '2026-07-19 09:30',
          scheduledAt: '2026-07-18 09:00',
          title: '整理项目经历',
        },
      ],
      summary: '产品经理面试计划',
      version: 3,
    });
  });

  it('turns a locally edited row into the strict UTC proposal command shape', () => {
    expect(
      createTaskDraftChanges(
        {
          deadlineAt: '',
          editable: true,
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
          priority: 'LOW',
          project: { name: '求职', type: 'NEW' },
          projectName: '求职',
          reminderAt: '2026-07-19 09:30',
          scheduledAt: '2026-07-18 09:00',
          title: '模拟回答',
        },
        'Asia/Shanghai',
      ),
    ).toEqual({
      deadlineAt: null,
      priority: 'LOW',
      project: { name: '求职', type: 'NEW' },
      reminderAt: '2026-07-19T01:30:00.000Z',
      scheduledAt: '2026-07-18T01:00:00.000Z',
      title: '模拟回答',
    });
  });

  it('uses persisted before-values for a read-only completion action', () => {
    const value = proposal({
      actionCode: 'COMPLETE_TASK',
      presentation: 'ACTION',
      conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
      createdAt: '2026-07-17T12:00:00.000Z',
      expiresAt: '2026-07-24T12:00:00.000Z',
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a66',
      lastDismissedAt: null,
      mutations: [
        {
          afterValue: { status: 'COMPLETED' },
          beforeValue: {
            title: '完成项目复盘',
            priority: 'HIGH',
            projectId: project.id,
            scheduledAt: null,
            deadlineAt: null,
            reminderAt: null,
          },
          fieldSource: 'AGENT_SUGGESTION',
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a67',
          operation: 'COMPLETE',
          sequence: 1,
          targetId: '018f47be-1972-7d58-9d67-4ddc5eb78a68',
          targetType: 'TASK',
          targetVersion: 1,
        },
      ],
      status: 'AWAITING_CONFIRMATION',
      title: '完成待办',
      updatedAt: '2026-07-17T12:00:00.000Z',
      version: 1,
    });

    expect(actionProposalPresentation(value, [project], 'Asia/Shanghai').items[0]).toMatchObject({
      editable: false,
      priority: 'HIGH',
      projectName: '面试',
      title: '完成项目复盘',
    });
  });

  it('only treats finished run states as terminal', () => {
    expect(isAgentRequestTerminal('RESULT_PERSISTED')).toBe(false);
    expect(isAgentRequestTerminal('SETTLING')).toBe(false);
    expect(isAgentRequestTerminal('SUCCEEDED')).toBe(true);
    expect(isAgentRequestTerminal('FAILED')).toBe(true);
    expect(isAgentRequestTerminal('RELEASED')).toBe(true);
  });

  it('distinguishes genuine quota errors from generic service failures', () => {
    expect(
      agentUnavailableReason(
        new ApiRequestError({
          code: 'AGENT_POINTS_INSUFFICIENT',
          message: '额度不足',
          status: 429,
        }),
      ),
    ).toBe('QUOTA');
    expect(agentUnavailableReason({ code: 'AGENT_DAILY_QUOTA_EXHAUSTED' })).toBe('QUOTA');
    expect(agentUnavailableReason({ code: 'AGENT_SERVICE_UNAVAILABLE' })).toBe('SERVICE');
  });
});
