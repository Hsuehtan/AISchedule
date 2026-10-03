import type { Page, TestInfo } from '@playwright/test';

export const SYNTHETIC_ACCOUNT_KEYS = [
  'agent-input',
  'agent-resilience-conflict',
  'agent-resilience-close-admission',
  'agent-resilience-poll',
  'agent-resilience-lost-confirm',
  'agent-resilience-unsaved',
  'agent-resilience-actions',
  'agent-resilience-version',
  'agent-resilience-processing',
  'agent-resilience-regenerate',
  'agent-resilience-edit-failure',
  'agent-resilience-refresh-failure',
  'phase2-retry',
  'phase2-conflict',
  'phase2-expired-undo',
  'phase2-priority',
  'phase2-focus',
  'phase3-main',
  'phase3-followup',
  'phase3-retry',
  'phase3-delete-undo',
  'h2-press-state',
  'h2-project-strip',
] as const;

type SyntheticAccountKey = (typeof SYNTHETIC_ACCOUNT_KEYS)[number];

const SESSION_ENV = 'E2E_SYNTHETIC_SESSIONS';
const SESSION_COOKIE = 'ai_schedule_session';

export function syntheticSessionId(key: SyntheticAccountKey, retry: number): string {
  return `${key}:${retry}`;
}

export async function useSyntheticAccount(
  page: Page,
  key: SyntheticAccountKey,
  testInfo: TestInfo,
): Promise<void> {
  const encoded = process.env[SESSION_ENV];
  if (!encoded) throw new Error(`${SESSION_ENV} is missing; run this test through Playwright`);
  const sessions = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
    string,
    string
  >;
  const token = sessions[syntheticSessionId(key, Math.min(testInfo.retry, 2))];
  if (!token) throw new Error(`No synthetic Session was prepared for ${key}`);
  const h5Port = Number(process.env.H5_PORT ?? 11086);
  await page.context().addCookies([
    {
      httpOnly: true,
      name: SESSION_COOKIE,
      sameSite: 'Lax',
      url: `http://127.0.0.1:${h5Port}`,
      value: token,
    },
  ]);
}
