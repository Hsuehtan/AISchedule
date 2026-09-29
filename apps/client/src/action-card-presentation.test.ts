import { publicActionProposalSchema, projectSchema } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import { presentActionCard } from './action-card-presentation';

const project = projectSchema.parse({
  archivedAt: null,
  colorKey: 'pink',
  createdAt: '2026-07-17T12:00:00.000Z',
  id: '018f47be-1972-7d58-9d67-4ddc5eb78a60',
  name: '工作',
  status: 'ACTIVE',
  taskCount: 0,
  updatedAt: '2026-07-17T12:00:00.000Z',
  userId: '018f47be-1972-7d58-9d67-4ddc5eb78a61',
  version: 1,
});

function view(
  operation: 'CREATE' | 'UPDATE' | 'COMPLETE' | 'RESTORE' | 'SOFT_DELETE',
  beforeValue: Record<string, unknown> | null,
  afterValue: Record<string, unknown>,
) {
  const proposal = publicActionProposalSchema.parse({
    id: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
    conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
    actionCode:
      operation === 'CREATE'
        ? 'CREATE_TASK'
        : operation === 'UPDATE'
          ? 'UPDATE_TASK'
          : operation === 'COMPLETE'
            ? 'COMPLETE_TASK'
            : operation === 'RESTORE'
              ? 'RESTORE_TASK'
              : 'DELETE_TASK',
    presentation: 'ACTION',
    title: '操作草稿',
    status: 'AWAITING_CONFIRMATION',
    version: 1,
    mutations: [
      {
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
        sequence: 1,
        operation,
        targetType: 'TASK',
        targetId: operation === 'CREATE' ? null : '018f47be-1972-7d58-9d67-4ddc5eb78a65',
        targetVersion: operation === 'CREATE' ? null : 1,
        beforeValue,
        afterValue,
        fieldSource: 'AGENT_SUGGESTION',
      },
    ],
    lastDismissedAt: null,
    expiresAt: null,
    createdAt: '2026-07-17T12:00:00.000Z',
    updatedAt: '2026-07-17T12:00:00.000Z',
  });
  return presentActionCard(proposal, [project], 'Asia/Shanghai');
}

describe('Action card presentation', () => {
  it('shows actual before and after values for updates and never labels an unknown project unassigned', () => {
    const result = view(
      'UPDATE',
      { title: '周报', priority: 'LOW', projectId: project.id },
      {
        priority: 'HIGH',
        project: { type: 'EXISTING', projectId: 'unknown' },
      },
    );
    expect(result.rows).toContainEqual({
      label: '字段变化',
      value: '优先级：低 → 高；所属项目：工作 → 项目不可用',
    });
    expect(JSON.stringify(result)).not.toContain('unknown');
    expect(JSON.stringify(result)).not.toContain('未归属');
  });

  it('describes creation, completion, restoration and soft deletion effects', () => {
    expect(
      JSON.stringify(
        view('CREATE', null, {
          title: '周报',
          project: { type: 'EXISTING', projectId: project.id },
        }).rows,
      ),
    ).toContain('待完成列表将出现新待办');
    expect(
      JSON.stringify(
        view('COMPLETE', { title: '周报', status: 'TODO' }, { status: 'COMPLETED' }).rows,
      ),
    ).toContain('待完成 → 已完成');
    expect(
      JSON.stringify(
        view('RESTORE', { title: '周报', status: 'COMPLETED' }, { status: 'TODO' }).rows,
      ),
    ).toContain('已完成 → 待完成');
    expect(
      JSON.stringify(view('SOFT_DELETE', { title: '周报' }, { deleted: true }).rows),
    ).toContain('3 秒内撤销');
  });

  it('describes new projects separately and allows removing only individual organize suggestions', () => {
    const proposal = publicActionProposalSchema.parse({
      id: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
      conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a62',
      actionCode: 'ORGANIZE_TASKS',
      presentation: 'ACTION',
      title: '整理项目',
      status: 'AWAITING_CONFIRMATION',
      version: 1,
      mutations: [
        {
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
          sequence: 1,
          operation: 'CREATE',
          targetType: 'PROJECT',
          targetId: null,
          targetVersion: null,
          beforeValue: null,
          afterValue: { name: '工作' },
          fieldSource: 'AGENT_SUGGESTION',
        },
        {
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
          sequence: 2,
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: '018f47be-1972-7d58-9d67-4ddc5eb78a70',
          targetVersion: 1,
          beforeValue: { title: '周报', projectId: null },
          afterValue: { project: { type: 'EXISTING', projectId: project.id } },
          fieldSource: 'AGENT_SUGGESTION',
        },
        {
          id: '018f47be-1972-7d58-9d67-4ddc5eb78a66',
          sequence: 3,
          operation: 'UPDATE',
          targetType: 'TASK',
          targetId: '018f47be-1972-7d58-9d67-4ddc5eb78a71',
          targetVersion: 1,
          beforeValue: { title: '会议', projectId: null },
          afterValue: { project: { type: 'EXISTING', projectId: project.id } },
          fieldSource: 'AGENT_SUGGESTION',
        },
      ],
      lastDismissedAt: null,
      expiresAt: null,
      createdAt: '2026-07-17T12:00:00.000Z',
      updatedAt: '2026-07-17T12:00:00.000Z',
    });
    const result = presentActionCard(proposal, [project], 'Asia/Shanghai');
    expect(result.rows).toContainEqual({ label: '字段变化', value: '新建项目「工作」' });
    expect(result.rows).toContainEqual({ label: '字段变化', value: '所属项目：未归属 → 工作' });
    expect(result.removableItems).toEqual([
      { id: proposal.mutations[1]?.id, title: '周报' },
      { id: proposal.mutations[2]?.id, title: '会议' },
    ]);
  });
});
