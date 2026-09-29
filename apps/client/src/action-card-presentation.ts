import type { Project, PublicActionMutation, PublicActionProposal } from '@ai-schedule/contracts';

export type ActionCardRow = { label: string; value: string };
export type ActionCardView = {
  id: string;
  title: string;
  status: PublicActionProposal['status'];
  rows: ActionCardRow[];
  removableItems?: { id: string; title: string }[];
};

const FIELD_LABEL: Record<string, string> = {
  title: '标题',
  description: '说明',
  priority: '优先级',
  project: '所属项目',
  projectId: '所属项目',
  scheduledAt: '计划时间',
  deadlineAt: '截止时间',
  reminderAt: '提醒时间',
  status: '完成状态',
  deleted: '删除状态',
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function projectName(value: unknown, projects: readonly Project[]): string {
  if (value === null) return '未归属';
  if (value === undefined) return '未指定';
  if (typeof value === 'string') {
    return projects.find((project) => project.id === value)?.name ?? '项目不可用';
  }
  const selection = record(value);
  if (selection['type'] === 'NONE') return '未归属';
  if (selection['type'] === 'NEW' && typeof selection['name'] === 'string') {
    return selection['name'];
  }
  return selection['projectId'] === undefined
    ? '项目不可用'
    : projectName(selection['projectId'], projects);
}

function displayValue(
  key: string,
  value: unknown,
  projects: readonly Project[],
  timeZone: string,
): string {
  if (key === 'project' || key === 'projectId') return projectName(value, projects);
  if (value === null || value === '') return '无';
  if (key === 'priority')
    return typeof value === 'string'
      ? (({ HIGH: '高', MEDIUM: '中', LOW: '低' } as Record<string, string>)[value] ?? '未指定')
      : '未指定';
  if (key === 'status') return value === 'COMPLETED' ? '已完成' : '待完成';
  if (key === 'deleted') return value === true ? '已删除' : '未删除';
  if (key.endsWith('At') && typeof value === 'string') {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value));
    } catch {
      return '时间不可用';
    }
  }
  return typeof value === 'string' ? value : '已调整';
}

function mutationRows(
  mutation: PublicActionMutation,
  projects: readonly Project[],
  timeZone: string,
): ActionCardRow[] {
  const before = record(mutation.beforeValue);
  const after = record(mutation.afterValue);
  const name =
    typeof before['title'] === 'string'
      ? before['title']
      : typeof after['title'] === 'string'
        ? after['title']
        : mutation.targetType === 'PROJECT' && typeof after['name'] === 'string'
          ? after['name']
          : '待办';
  const target = mutation.targetType === 'PROJECT' ? `项目「${name}」` : `待办「${name}」`;
  const rows: ActionCardRow[] = [{ label: '操作对象', value: target }];
  if (mutation.targetType === 'PROJECT') {
    rows.push({ label: '字段变化', value: `新建项目「${name}」` });
    rows.push({ label: '界面影响', value: '项目列表将出现新项目' });
    return rows;
  }
  if (mutation.operation === 'CREATE') {
    const fields = ['title', 'project', 'priority', 'scheduledAt', 'deadlineAt', 'reminderAt'];
    rows.push({
      label: '字段变化',
      value: fields
        .filter((key) => key in after)
        .map((key) => `${FIELD_LABEL[key]}：${displayValue(key, after[key], projects, timeZone)}`)
        .join('；'),
    });
    rows.push({ label: '界面影响', value: '待完成列表将出现新待办' });
  } else if (mutation.operation === 'COMPLETE' || mutation.operation === 'RESTORE') {
    rows.push({
      label: '字段变化',
      value: `完成状态：${mutation.operation === 'COMPLETE' ? '待完成 → 已完成' : '已完成 → 待完成'}`,
    });
    rows.push({
      label: '界面影响',
      value: mutation.operation === 'COMPLETE' ? '移至已完成列表' : '移至待完成列表',
    });
  } else if (mutation.operation === 'SOFT_DELETE') {
    rows.push({ label: '字段变化', value: '删除状态：未删除 → 已删除' });
    rows.push({ label: '界面影响', value: '待办从当前列表移除，可在 3 秒内撤销' });
  } else {
    const oldValue = (key: string) =>
      key === 'project' ? (before['project'] ?? before['projectId']) : before[key];
    const keys = Object.keys(after).filter(
      (key) =>
        key in FIELD_LABEL &&
        displayValue(key, oldValue(key), projects, timeZone) !==
          displayValue(key, after[key], projects, timeZone),
    );
    rows.push({
      label: '字段变化',
      value:
        keys
          .map(
            (key) =>
              `${FIELD_LABEL[key]}：${displayValue(key, oldValue(key), projects, timeZone)} → ${displayValue(key, after[key], projects, timeZone)}`,
          )
          .join('；') || '待办信息将更新',
    });
    rows.push({ label: '界面影响', value: '待办列表将显示更新后的信息' });
  }
  return rows;
}

export function presentActionCard(
  proposal: PublicActionProposal,
  projects: readonly Project[],
  timeZone: string,
): ActionCardView {
  const mutations = [...proposal.mutations].sort((a, b) => a.sequence - b.sequence);
  const removableItems =
    proposal.actionCode === 'ORGANIZE_TASKS'
      ? mutations
          .filter((mutation) => mutation.targetType === 'TASK' && mutation.operation === 'UPDATE')
          .map((mutation) => ({
            id: mutation.id,
            title:
              typeof record(mutation.beforeValue)['title'] === 'string'
                ? (record(mutation.beforeValue)['title'] as string)
                : '待办',
          }))
      : [];
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    rows: mutations.flatMap((mutation) => mutationRows(mutation, projects, timeZone)),
    ...(removableItems.length > 1 ? { removableItems } : {}),
  };
}
