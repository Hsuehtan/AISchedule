import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const screens = [
  'login',
  'all-todos',
  'agent-plan',
  'work-project',
  'empty-state',
  'done-expanded',
  'toast-undo',
  'text-input',
  'voice-input',
  'candidates',
  'agent-clarify',
  'agent-confirm',
  'task-edit',
  'project-management',
  'quota-limit',
] as const;

async function openScreen(page: Page, screen: (typeof screens)[number], width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(`/#/pages/review/index?screen=${screen}`);
  await expect(page.locator('.ei-app-shell')).toBeVisible();
}

let runtimeProblems: string[] = [];

test.beforeEach(({ page }) => {
  runtimeProblems = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      runtimeProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => runtimeProblems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    runtimeProblems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
  );
});

test.afterEach(() => {
  expect(runtimeProblems, '浏览器控制台、页面异常与失败请求应为空').toEqual([]);
});

test('核心交互路径可复现', async ({ page }) => {
  await openScreen(page, 'login');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('今天先处理 4 件事')).toBeVisible();

  await page.getByRole('button', { name: '使用 Agent 一键整理 Smart Inbox' }).click();
  await expect(page.getByRole('dialog', { name: '计划草稿' })).toBeVisible();
  await page.getByRole('button', { name: '确认创建五项待办' }).click();
  await expect(page.getByRole('dialog', { name: '确认 Agent 操作' })).toBeVisible();
});

test('完成待办后可以撤销', async ({ page }) => {
  await openScreen(page, 'all-todos');
  await page.getByRole('button', { name: '完成待办：写周报' }).click();
  await expect(page.getByRole('status')).toContainText('已完成「写周报」');
  await page.getByRole('button', { name: '撤销：已完成「写周报」' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('Production V3 全部状态可直接访问', async ({ page }) => {
  for (const screen of screens) {
    await openScreen(page, screen);
    await expect(page.locator('body')).not.toBeEmpty();
  }
});

test('交互目标不小于 44px', async ({ page }) => {
  for (const screen of ['login', 'all-todos', 'text-input', 'agent-confirm'] as const) {
    await openScreen(page, screen);
    if (screen === 'text-input') {
      const input = page.locator('.commandInput');
      await expect(input.locator('.taro-textarea')).toBeVisible();
      await expect
        .poll(async () => {
          const bounds = await input.boundingBox();
          return bounds ? Math.min(bounds.width, bounds.height) : 0;
        })
        .toBeGreaterThanOrEqual(44);
    }
    const undersized = await page
      .locator('taro-button-core, taro-input-core, taro-textarea-core, [role="button"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (rect.width < 44 || rect.height < 44)
            );
          })
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              label:
                node.getAttribute('aria-label') ??
                node.textContent?.trim().slice(0, 30) ??
                node.tagName,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          }),
      );
    expect(undersized, `${screen} 存在小于 44px 的点击目标`).toEqual([]);
  }
});

test('文本输入可见边缘点击后聚焦', async ({ page }) => {
  await openScreen(page, 'text-input');
  const input = page.locator('.commandInput');
  await input.click({ position: { x: 5, y: 5 } });
  await expect(input.locator('textarea')).toBeFocused();
});

test('关键页面通过 WCAG A/AA 自动扫描', async ({ page }) => {
  for (const screen of ['login', 'all-todos', 'text-input', 'agent-confirm'] as const) {
    await openScreen(page, screen);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations, `${screen} 存在 axe 违规`).toEqual([]);
  }
});

test('@visual 生成 H1 390×844 全状态截图', async ({ page }) => {
  for (const screen of screens) {
    await openScreen(page, screen);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/${screen}-390x844.png`,
    });
  }
});

test('@visual 验证 320 与 480px 响应式边界', async ({ page }) => {
  for (const width of [320, 480]) {
    await openScreen(page, 'all-todos', width, 844);
    const shell = page.locator('.ei-app-shell');
    await expect(shell).toHaveCSS('overflow', 'hidden');
    await expect(shell).toHaveCSS('height', '844px');
    const bodyWidth = await page.locator('body').evaluate((body) => body.scrollWidth);
    expect(bodyWidth).toBe(width);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/all-todos-${width}x844.png`,
    });
  }
});

test('@visual 验证软键盘压缩视口后的输入操作区', async ({ page }) => {
  await openScreen(page, 'text-input', 390, 560);
  const textarea = page.locator('textarea');
  await textarea.focus();
  await expect(textarea).toBeFocused();

  const sendButton = page.getByRole('button', { name: '发送给 Agent' });
  await expect(sendButton).toBeVisible();
  const bounds = await sendButton.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(560);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);

  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/text-input-keyboard-390x560.png',
  });
});
