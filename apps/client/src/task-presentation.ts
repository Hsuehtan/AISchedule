import type { Task } from '@ai-schedule/contracts';

export type PresentedTask = {
  meta: string;
  priority: 'high' | 'medium' | 'low';
  project: { color: NonNullable<Task['project']>['colorKey']; name: string };
  time: string;
};

export const priorityPresentation: Record<
  Task['priority'],
  { color: 'red' | 'yellow' | 'green'; label: string }
> = {
  HIGH: { color: 'red', label: '高优先级' },
  MEDIUM: { color: 'yellow', label: '中优先级' },
  LOW: { color: 'green', label: '低优先级' },
};

type ZonedParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function getZonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    month: Number(values.month),
    year: Number(values.year),
  };
}

function calendarDay(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function relativeDateTime(value: string, timeZone: string, now: Date): string {
  const target = getZonedParts(new Date(value), timeZone);
  const current = getZonedParts(now, timeZone);
  const dayDifference = calendarDay(target) - calendarDay(current);
  const time = `${pad(target.hour)}:${pad(target.minute)}`;

  if (dayDifference === 0) return `今天${time}`;
  if (dayDifference === 1) return `明天${time}`;
  if (dayDifference > 1 && dayDifference < 7) {
    const weekday = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      weekday: 'short',
    }).format(new Date(value));
    return `${weekday}${time}`;
  }
  return `${target.month}月${target.day}日 ${time}`;
}

export function formatTaskSchedule(
  scheduledAt: string | null,
  timeZone: string,
  now = new Date(),
): string {
  if (!scheduledAt) return '待定';
  const target = getZonedParts(new Date(scheduledAt), timeZone);
  const current = getZonedParts(now, timeZone);
  const dayDifference = calendarDay(target) - calendarDay(current);

  if (dayDifference === 0) return `${pad(target.hour)}:${pad(target.minute)}`;
  if (dayDifference === 1) return '明天';
  if (dayDifference > 1 && dayDifference < 7) {
    return new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(
      new Date(scheduledAt),
    );
  }
  return `${target.month}月${target.day}日`;
}

export function formatTaskDeadlineAndReminder(
  deadlineAt: string | null,
  reminderAt: string | null,
  timeZone: string,
  now = new Date(),
): string {
  const deadline = deadlineAt ? `${relativeDateTime(deadlineAt, timeZone, now)}截止` : '无截止时间';
  const reminder = reminderAt ? `${relativeDateTime(reminderAt, timeZone, now)}提醒` : '无提醒';
  return `${deadline} · ${reminder}`;
}

export function presentTask(task: Task, timeZone: string, now = new Date()): PresentedTask {
  return {
    meta: formatTaskDeadlineAndReminder(task.deadlineAt, task.reminderAt, timeZone, now),
    priority: task.priority === 'HIGH' ? 'high' : task.priority === 'MEDIUM' ? 'medium' : 'low',
    project: task.project
      ? { color: task.project.colorKey, name: task.project.name }
      : { color: 'cyan', name: '未归属' },
    time: formatTaskSchedule(task.scheduledAt, timeZone, now),
  };
}

export function utcToLocalDateTime(value: string | null, timeZone: string): string {
  if (!value) return '';
  const parts = getZonedParts(new Date(value), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localDateTimeToUtc(value: string, timeZone: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) throw new Error('时间格式应为 YYYY-MM-DD HH:mm');

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const desired = {
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    month: Number(monthText),
    year: Number(yearText),
  };
  const desiredEpoch = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let candidateEpoch = desiredEpoch;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = getZonedParts(new Date(candidateEpoch), timeZone);
    const observedEpoch = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    candidateEpoch += desiredEpoch - observedEpoch;
  }

  const resolved = getZonedParts(new Date(candidateEpoch), timeZone);
  if (
    resolved.year !== desired.year ||
    resolved.month !== desired.month ||
    resolved.day !== desired.day ||
    resolved.hour !== desired.hour ||
    resolved.minute !== desired.minute
  ) {
    throw new Error('该本地时间在当前时区不可用');
  }

  return new Date(candidateEpoch).toISOString();
}
