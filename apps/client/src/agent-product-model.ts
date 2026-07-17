import type {
  ActionProposalEditInput,
  AgentPublicFailureCode,
  Project,
  PublicActionMutation,
  PublicActionProposal,
  PublicAgentRequestStatus,
} from '@ai-schedule/contracts';

import { ApiRequestError } from './api-client';
import type { AgentUnavailableReason } from './app-state';
import { localDateTimeToUtc, utcToLocalDateTime } from './task-presentation';

export type AgentProjectSelection =
  | { type: 'EXISTING'; projectId: Project['id'] }
  | { type: 'NEW'; name: string }
  | { type: 'NONE' };

export type AgentProposalDraftItem = {
  deadlineAt: string;
  editable: boolean;
  id: string;
  priority: 'HIGH' | 'LOW' | 'MEDIUM';
  project: AgentProjectSelection;
  projectName: string;
  reminderAt: string;
  scheduledAt: string;
  title: string;
};

export type AgentProposalPresentation = {
  id: string;
  items: AgentProposalDraftItem[];
  summary: string;
  version: number;
};

type TaskDraftChanges = Extract<
  ActionProposalEditInput['command'],
  { type: 'UPDATE_TASK_DRAFT' }
>['changes'];

const TERMINAL_STATUSES = new Set<PublicAgentRequestStatus>(['FAILED', 'RELEASED', 'SUCCEEDED']);

const QUOTA_CODES = new Set<AgentPublicFailureCode>([
  'AGENT_DAILY_QUOTA_EXHAUSTED',
  'AGENT_POINTS_INSUFFICIENT',
]);

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function localDateTime(value: unknown, timeZone: string): string {
  if (typeof value !== 'string') return '';
  try {
    return utcToLocalDateTime(value, timeZone);
  } catch {
    return '';
  }
}

function projectSelection(
  value: Record<string, unknown>,
  projects: readonly Project[],
): { name: string; selection: AgentProjectSelection } {
  const rawProject = objectValue(value['project']);
  const rawType = rawProject?.['type'];

  if (rawProject && rawType === 'EXISTING' && typeof rawProject['projectId'] === 'string') {
    const project = projects.find((candidate) => candidate.id === rawProject['projectId']);
    if (!project) return { name: '未归属', selection: { type: 'NONE' } };
    return {
      name: project.name,
      selection: { projectId: project.id, type: 'EXISTING' },
    };
  }
  if (
    rawProject &&
    rawType === 'NEW' &&
    typeof rawProject['name'] === 'string' &&
    rawProject['name'].trim()
  ) {
    return {
      name: rawProject['name'],
      selection: { name: rawProject['name'], type: 'NEW' },
    };
  }
  if (rawType === 'NONE') return { name: '未归属', selection: { type: 'NONE' } };

  const projectId = stringValue(value, 'projectId');
  if (projectId) {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return { name: '未归属', selection: { type: 'NONE' } };
    return {
      name: project.name,
      selection: { projectId: project.id, type: 'EXISTING' },
    };
  }

  const projectName = stringValue(value, 'projectName');
  if (projectName) {
    return { name: projectName, selection: { name: projectName, type: 'NEW' } };
  }
  return { name: '未归属', selection: { type: 'NONE' } };
}

function mutationFallbackTitle(mutation: PublicActionMutation): string {
  const before = objectValue(mutation.beforeValue);
  const existingTitle = before ? stringValue(before, 'title') : null;
  if (existingTitle) return existingTitle;

  const labels: Record<PublicActionMutation['operation'], string> = {
    COMPLETE: '标记待办为完成',
    CREATE: '创建新待办',
    RESTORE: '恢复待办',
    SOFT_DELETE: '删除待办',
    UPDATE: '修改待办',
  };
  return labels[mutation.operation];
}

function presentMutation(
  mutation: PublicActionMutation,
  projects: readonly Project[],
  timeZone: string,
): AgentProposalDraftItem {
  const before = objectValue(mutation.beforeValue) ?? {};
  const value =
    mutation.operation === 'CREATE' ? mutation.afterValue : { ...before, ...mutation.afterValue };
  const project = projectSelection(value, projects);
  const rawPriority = value['priority'];
  return {
    deadlineAt: localDateTime(value['deadlineAt'], timeZone),
    editable: mutation.operation === 'CREATE',
    id: mutation.id,
    priority:
      rawPriority === 'HIGH' || rawPriority === 'LOW' || rawPriority === 'MEDIUM'
        ? rawPriority
        : 'MEDIUM',
    project: project.selection,
    projectName: project.name,
    reminderAt: localDateTime(value['reminderAt'], timeZone),
    scheduledAt: localDateTime(value['scheduledAt'], timeZone),
    title: stringValue(value, 'title') ?? mutationFallbackTitle(mutation),
  };
}

export function actionProposalPresentation(
  proposal: PublicActionProposal,
  projects: readonly Project[],
  timeZone: string,
): AgentProposalPresentation {
  const planRequiresProject = proposal.actionCode === 'CREATE_PROJECT_TASKS';
  return {
    id: proposal.id,
    items: proposal.mutations
      .filter((mutation) => mutation.targetType === 'TASK')
      .sort((left, right) => left.sequence - right.sequence)
      .map((mutation) => {
        const item = presentMutation(mutation, projects, timeZone);
        return planRequiresProject && item.project.type === 'NONE'
          ? { ...item, projectName: '请选择项目' }
          : item;
      }),
    summary: proposal.title,
    version: proposal.version,
  };
}

export function createTaskDraftChanges(
  item: AgentProposalDraftItem,
  timeZone: string,
): TaskDraftChanges {
  return {
    deadlineAt: localDateTimeToUtc(item.deadlineAt, timeZone),
    priority: item.priority,
    project: item.project,
    reminderAt: localDateTimeToUtc(item.reminderAt, timeZone),
    scheduledAt: localDateTimeToUtc(item.scheduledAt, timeZone),
    title: item.title,
  };
}

export function isAgentRequestTerminal(status: PublicAgentRequestStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function failureCode(value: unknown): string | null {
  if (value instanceof ApiRequestError) return value.code;
  const record = objectValue(value);
  return typeof record?.['code'] === 'string' ? record['code'] : null;
}

export function agentUnavailableReason(error: unknown): AgentUnavailableReason {
  const code = failureCode(error);
  return code && QUOTA_CODES.has(code as AgentPublicFailureCode) ? 'QUOTA' : 'SERVICE';
}
