export function localDateAt(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) throw new Error('Unable to resolve user local date');
  return `${year}-${month}-${day}`;
}

export function localDateValue(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}
