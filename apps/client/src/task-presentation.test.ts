import { taskSchema } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import {
  formatTaskDeadlineAndReminder,
  formatTaskSchedule,
  localDateTimeToUtc,
  priorityPresentation,
  presentTask,
  utcToLocalDateTime,
} from './task-presentation';

describe('task presentation', () => {
  it('maps the only three priorities to red, yellow and green semantics', () => {
    expect(priorityPresentation.HIGH).toEqual({ color: 'red', label: '高优先级' });
    expect(priorityPresentation.MEDIUM).toEqual({ color: 'yellow', label: '中优先级' });
    expect(priorityPresentation.LOW).toEqual({ color: 'green', label: '低优先级' });
  });

  it('takes the left project identity and right priority from separate task fields', () => {
    const presented = presentTask(
      taskSchema.parse({
        id: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
        userId: '018f31f2-5be2-7d12-8ad8-0bb1830f92d4',
        projectId: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
        project: {
          id: '018f31f2-7c27-7587-85f0-a62f4cc8e5c1',
          name: '工作',
          colorKey: 'teal',
          status: 'ACTIVE',
        },
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
        version: 1,
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
      }),
      'Asia/Shanghai',
      new Date('2026-06-25T00:00:00.000Z'),
    );

    expect(presented.project).toEqual({ color: 'teal', name: '工作' });
    expect(presented.priority).toBe('high');
  });

  it('formats UTC task times in the user timezone without creating reminder behavior', () => {
    const now = new Date('2026-06-25T00:00:00.000Z');

    expect(formatTaskSchedule('2026-06-25T01:30:00.000Z', 'Asia/Shanghai', now)).toBe('09:30');
    expect(
      formatTaskDeadlineAndReminder(
        '2026-06-26T12:00:00.000Z',
        '2026-06-26T11:00:00.000Z',
        'Asia/Shanghai',
        now,
      ),
    ).toBe('明天20:00截止 · 明天19:00提醒');
  });

  it('renders explicit empty time values', () => {
    const now = new Date('2026-06-25T00:00:00.000Z');

    expect(formatTaskSchedule(null, 'Asia/Shanghai', now)).toBe('待定');
    expect(formatTaskDeadlineAndReminder(null, null, 'Asia/Shanghai', now)).toBe(
      '无截止时间 · 无提醒',
    );
  });

  it('round trips editable local values through UTC in the user timezone', () => {
    expect(localDateTimeToUtc('2026-07-14 09:30', 'Asia/Shanghai')).toBe(
      '2026-07-14T01:30:00.000Z',
    );
    expect(utcToLocalDateTime('2026-07-14T01:30:00.000Z', 'Asia/Shanghai')).toBe(
      '2026-07-14 09:30',
    );
    expect(localDateTimeToUtc('', 'Asia/Shanghai')).toBeNull();
  });
});
