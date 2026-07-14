import { utcToLocalDateTime } from '../task-presentation';

export const DATE_TIME_YEAR_START = 1970;
export const DATE_TIME_YEAR_END = 2999;

export type DateTimeSelection = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

const years = Array.from(
  { length: DATE_TIME_YEAR_END - DATE_TIME_YEAR_START + 1 },
  (_, index) => `${DATE_TIME_YEAR_START + index}年`,
);
const months = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
const hours = Array.from({ length: 24 }, (_, index) => `${pad(index)}时`);
const minutes = Array.from({ length: 60 }, (_, index) => `${pad(index)}分`);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pickerIndex(value: unknown, maximum: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? clamp(Math.trunc(numericValue), 0, maximum) : 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeSelection(selection: DateTimeSelection): DateTimeSelection {
  const year = clamp(Math.trunc(selection.year), DATE_TIME_YEAR_START, DATE_TIME_YEAR_END);
  const month = clamp(Math.trunc(selection.month), 1, 12);
  return {
    day: clamp(Math.trunc(selection.day), 1, daysInMonth(year, month)),
    hour: clamp(Math.trunc(selection.hour), 0, 23),
    minute: clamp(Math.trunc(selection.minute), 0, 59),
    month,
    year,
  };
}

function parseLocalDateTime(value: string): DateTimeSelection | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const selection = {
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    month: Number(match[2]),
    year: Number(match[1]),
  };
  const normalized = normalizeSelection(selection);
  return normalized.year === selection.year &&
    normalized.month === selection.month &&
    normalized.day === selection.day &&
    normalized.hour === selection.hour &&
    normalized.minute === selection.minute
    ? normalized
    : null;
}

export function resolveDateTimeSelection(
  value: string,
  timeZone: string,
  now = new Date(),
): DateTimeSelection {
  return (
    parseLocalDateTime(value) ??
    parseLocalDateTime(utcToLocalDateTime(now.toISOString(), timeZone)) ?? {
      day: 1,
      hour: 0,
      minute: 0,
      month: 1,
      year: DATE_TIME_YEAR_START,
    }
  );
}

export function createDateTimePickerRange(selection: DateTimeSelection): string[][] {
  const normalized = normalizeSelection(selection);
  return [
    years,
    months,
    Array.from(
      { length: daysInMonth(normalized.year, normalized.month) },
      (_, index) => `${index + 1}日`,
    ),
    hours,
    minutes,
  ];
}

export function createDateTimePickerValue(selection: DateTimeSelection): number[] {
  const normalized = normalizeSelection(selection);
  return [
    normalized.year - DATE_TIME_YEAR_START,
    normalized.month - 1,
    normalized.day - 1,
    normalized.hour,
    normalized.minute,
  ];
}

export function dateTimeSelectionFromPickerValue(value: number[]): DateTimeSelection {
  const year =
    DATE_TIME_YEAR_START + pickerIndex(value[0], DATE_TIME_YEAR_END - DATE_TIME_YEAR_START);
  const month = pickerIndex(value[1], 11) + 1;
  return {
    day: pickerIndex(value[2], daysInMonth(year, month) - 1) + 1,
    hour: pickerIndex(value[3], 23),
    minute: pickerIndex(value[4], 59),
    month,
    year,
  };
}

export function changeDateTimePickerColumn(
  selection: DateTimeSelection,
  column: number,
  valueIndex: number,
): DateTimeSelection {
  const next = { ...normalizeSelection(selection) };

  if (column === 0) next.year = DATE_TIME_YEAR_START + pickerIndex(valueIndex, years.length - 1);
  if (column === 1) next.month = pickerIndex(valueIndex, months.length - 1) + 1;
  if (column === 2) {
    next.day = pickerIndex(valueIndex, daysInMonth(next.year, next.month) - 1) + 1;
  }
  if (column === 3) next.hour = pickerIndex(valueIndex, hours.length - 1);
  if (column === 4) next.minute = pickerIndex(valueIndex, minutes.length - 1);

  return normalizeSelection(next);
}

export function formatDateTimeSelection(selection: DateTimeSelection): string {
  const normalized = normalizeSelection(selection);
  return `${normalized.year}-${pad(normalized.month)}-${pad(normalized.day)} ${pad(normalized.hour)}:${pad(normalized.minute)}`;
}
