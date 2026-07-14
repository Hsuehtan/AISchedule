import { taskSchema } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import { createTaskFormValues, createTaskUpdateInput } from '../task-form-model';
import {
  DATE_TIME_YEAR_END,
  DATE_TIME_YEAR_START,
  changeDateTimePickerColumn,
  createDateTimePickerRange,
  createDateTimePickerValue,
  dateTimeSelectionFromPickerValue,
  formatDateTimeSelection,
  resolveDateTimeSelection,
} from './date-time-picker-model';

describe('date time picker model', () => {
  it('uses the current minute in the user time zone when the field is empty', () => {
    expect(
      resolveDateTimeSelection('', 'Asia/Shanghai', new Date('2026-07-14T16:23:45.000Z')),
    ).toEqual({ day: 15, hour: 0, minute: 23, month: 7, year: 2026 });
  });

  it('restores every part of an existing value including day boundaries', () => {
    expect(
      resolveDateTimeSelection(
        '2026-01-01 00:00',
        'Asia/Shanghai',
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toEqual({ day: 1, hour: 0, minute: 0, month: 1, year: 2026 });
    expect(
      resolveDateTimeSelection(
        '2026-12-31 23:59',
        'Asia/Shanghai',
        new Date('2030-01-01T00:00:00.000Z'),
      ),
    ).toEqual({ day: 31, hour: 23, minute: 59, month: 12, year: 2026 });
  });

  it('builds five bounded columns with the selected month day count', () => {
    const selection = { day: 29, hour: 23, minute: 59, month: 2, year: 2024 };
    const range = createDateTimePickerRange(selection);

    expect(range).toHaveLength(5);
    expect(range[0]?.[0]).toBe(`${DATE_TIME_YEAR_START}年`);
    expect(range[0]?.at(-1)).toBe(`${DATE_TIME_YEAR_END}年`);
    expect(range[1]).toHaveLength(12);
    expect(range[2]).toHaveLength(29);
    expect(range[3]).toHaveLength(24);
    expect(range[4]).toHaveLength(60);
    expect(range[3]?.[0]).toBe('00时');
    expect(range[4]?.at(-1)).toBe('59分');
  });

  it('clamps January 31 when the month changes to February', () => {
    expect(
      changeDateTimePickerColumn({ day: 31, hour: 9, minute: 30, month: 1, year: 2026 }, 1, 1),
    ).toEqual({ day: 28, hour: 9, minute: 30, month: 2, year: 2026 });
  });

  it('clamps February 29 when changing from a leap year to a common year', () => {
    expect(
      changeDateTimePickerColumn(
        { day: 29, hour: 9, minute: 30, month: 2, year: 2024 },
        0,
        2025 - DATE_TIME_YEAR_START,
      ),
    ).toEqual({ day: 28, hour: 9, minute: 30, month: 2, year: 2025 });
  });

  it('round trips picker indexes at both supported boundaries', () => {
    const start = { day: 1, hour: 0, minute: 0, month: 1, year: DATE_TIME_YEAR_START };
    const end = { day: 31, hour: 23, minute: 59, month: 12, year: DATE_TIME_YEAR_END };

    expect(dateTimeSelectionFromPickerValue(createDateTimePickerValue(start))).toEqual(start);
    expect(dateTimeSelectionFromPickerValue(createDateTimePickerValue(end))).toEqual(end);
  });

  it('formats confirmed values as YYYY-MM-DD HH:mm', () => {
    expect(formatDateTimeSelection({ day: 4, hour: 5, minute: 6, month: 3, year: 2026 })).toBe(
      '2026-03-04 05:06',
    );
  });

  it('round trips existing zoned task times without producing an update', () => {
    const task = taskSchema.parse({
      id: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
      userId: '018f31f2-5be2-7d12-8ad8-0bb1830f92d4',
      projectId: null,
      project: null,
      title: '时间往返测试',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      scheduledAt: '2026-07-14T01:30:00.000Z',
      deadlineAt: '2026-07-14T12:00:00.000Z',
      reminderAt: '2026-07-14T01:25:00.000Z',
      completedAt: null,
      deletedAt: null,
      source: 'MANUAL',
      version: 7,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    const values = createTaskFormValues(task, 'Asia/Shanghai');
    expect(values).toMatchObject({
      deadlineAt: '2026-07-14 20:00',
      reminderAt: '2026-07-14 09:25',
      scheduledAt: '2026-07-14 09:30',
    });
    expect(createTaskUpdateInput(task, values, 'Asia/Shanghai')).toBeNull();
  });

  it('maps a picker clear value back to an API null', () => {
    const task = taskSchema.parse({
      id: '018f31f3-0074-76b4-bba5-b49c74ae90d5',
      userId: '018f31f2-5be2-7d12-8ad8-0bb1830f92d4',
      projectId: null,
      project: null,
      title: '清空时间测试',
      description: '',
      status: 'TODO',
      priority: 'MEDIUM',
      scheduledAt: null,
      deadlineAt: '2026-07-14T12:00:00.000Z',
      reminderAt: null,
      completedAt: null,
      deletedAt: null,
      source: 'MANUAL',
      version: 7,
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });
    const values = createTaskFormValues(task, 'Asia/Shanghai');

    expect(createTaskUpdateInput(task, { ...values, deadlineAt: '' }, 'Asia/Shanghai')).toEqual({
      changes: { deadlineAt: null },
      version: 7,
    });
  });
});
