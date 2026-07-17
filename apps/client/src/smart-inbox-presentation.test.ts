import type { SmartInboxItem } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import { presentSmartInboxItem } from './smart-inbox-presentation';

const resumeAction = {
  type: 'RESUME_CONVERSATION',
  conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
  messageId: null,
  proposalId: null,
  requestId: null,
} as const;

describe('Smart Inbox presentation', () => {
  it.each([
    ['AWAITING_CONFIRMATION', '查看确认'],
    ['AWAITING_CLARIFICATION', '继续回答'],
    ['PROCESSING', '查看进度'],
    ['EXECUTION_FAILED', '查看详情'],
    ['UNREAD_REPLY', '查看回复'],
  ] as const)('maps %s to a stable action label', (kind, actionLabel) => {
    const item = {
      action: {
        ...resumeAction,
        messageId:
          kind === 'AWAITING_CLARIFICATION' ? '018f47be-1972-7d58-9d67-4ddc5eb78a65' : null,
        proposalId:
          kind === 'AWAITING_CONFIRMATION' ? '018f47be-1972-7d58-9d67-4ddc5eb78a66' : null,
        requestId: kind === 'PROCESSING' ? '018f47be-1972-7d58-9d67-4ddc5eb78a67' : null,
      },
      body: '来自服务端的摘要',
      kind,
      title: '摘要标题',
    } as SmartInboxItem;

    expect(presentSmartInboxItem(item)).toEqual({
      actionAriaLabel: `${actionLabel}：摘要标题`,
      actionLabel,
      body: '来自服务端的摘要',
    });
  });

  it.each([
    ['ORGANIZE_TASKS', '一键整理'],
    ['CURRENT_SCOPE', '告诉 Agent'],
    ['EMPTY_SCOPE', '创建待办'],
    ['DEFAULT', '开始处理'],
  ] as const)('maps %s without exposing internal values', (kind, actionLabel) => {
    const action =
      kind === 'ORGANIZE_TASKS'
        ? { type: 'ORGANIZE_TASKS' as const, scope: { type: 'ALL' as const } }
        : kind === 'EMPTY_SCOPE'
          ? { type: 'CREATE_TASK' as const }
          : { type: 'START_AGENT' as const };
    const item = { action, body: '正文', kind, title: '标题' } as SmartInboxItem;

    expect(presentSmartInboxItem(item).actionLabel).toBe(actionLabel);
  });
});
