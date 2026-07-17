import { describe, expect, it } from 'vitest';

import { parsePointsAdminArguments } from './points-admin.js';

describe('admin points CLI arguments', () => {
  it('requires target, operator and reason for mutations and supports dry-run', () => {
    expect(
      parsePointsAdminArguments('add', [
        '--username',
        'Alice_01',
        '--amount',
        '5',
        '--operator',
        'haon',
        '--reason',
        '内测补发',
        '--dry-run',
      ]),
    ).toEqual({
      action: 'add',
      lookup: { username: 'Alice_01' },
      value: 5,
      operator: 'haon',
      reason: '内测补发',
      dryRun: true,
    });

    expect(() =>
      parsePointsAdminArguments('subtract', [
        '--username',
        'Alice_01',
        '--amount',
        '2',
        '--operator',
        'haon',
      ]),
    ).toThrow(/reason/);
  });

  it('accepts a non-negative target balance for set and rejects unsafe numeric forms', () => {
    expect(
      parsePointsAdminArguments('set', [
        '--user-id',
        '018f47be-1972-7d58-9d67-4ddc5eb78a63',
        '--balance',
        '0',
        '--operator',
        'haon',
        '--reason',
        '账务对账',
      ]),
    ).toMatchObject({ action: 'set', value: 0, dryRun: false });

    for (const invalid of ['-1', '1.5', '1e3', '+2', ' 2', '2147483648']) {
      expect(() =>
        parsePointsAdminArguments('add', [
          '--username',
          'Alice_01',
          '--amount',
          invalid,
          '--operator',
          'haon',
          '--reason',
          '测试',
        ]),
      ).toThrow(/amount/);
    }
  });

  it('keeps history read-only with a bounded limit', () => {
    expect(
      parsePointsAdminArguments('history', ['--username', 'Alice_01', '--limit', '25']),
    ).toEqual({ action: 'history', lookup: { username: 'Alice_01' }, limit: 25 });

    expect(() =>
      parsePointsAdminArguments('history', ['--username', 'Alice_01', '--operator', 'unexpected']),
    ).toThrow(/unsupported/);
  });
});
