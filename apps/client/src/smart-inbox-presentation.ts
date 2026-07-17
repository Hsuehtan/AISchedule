import type { SmartInboxItem } from '@ai-schedule/contracts';

export type SmartInboxPresentation = {
  actionAriaLabel: string;
  actionLabel: string;
  body: string;
};

const ACTION_LABEL: Record<SmartInboxItem['kind'], string> = {
  AWAITING_CONFIRMATION: '查看确认',
  AWAITING_CLARIFICATION: '继续回答',
  PROCESSING: '查看进度',
  EXECUTION_FAILED: '查看详情',
  UNREAD_REPLY: '查看回复',
  ORGANIZE_TASKS: '一键整理',
  CURRENT_SCOPE: '告诉 Agent',
  EMPTY_SCOPE: '创建待办',
  DEFAULT: '开始处理',
};

export function presentSmartInboxItem(item: SmartInboxItem): SmartInboxPresentation {
  const actionLabel = ACTION_LABEL[item.kind];
  return {
    actionAriaLabel: `${actionLabel}：${item.title}`,
    actionLabel,
    body: item.body,
  };
}
