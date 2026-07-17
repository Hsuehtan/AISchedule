import { describe, expect, it } from 'vitest';

import { localDateAt, localDateValue } from './local-date.js';

describe('AI points local-day calculation', () => {
  it('uses the user timezone rather than the server date', () => {
    const instant = new Date('2026-07-17T16:30:00.000Z');

    expect(localDateAt(instant, 'Asia/Shanghai')).toBe('2026-07-18');
    expect(localDateAt(instant, 'America/Los_Angeles')).toBe('2026-07-17');
  });

  it('converts a local date key into a stable Prisma date value', () => {
    expect(localDateValue('2026-07-18').toISOString()).toBe('2026-07-18T00:00:00.000Z');
  });
});
