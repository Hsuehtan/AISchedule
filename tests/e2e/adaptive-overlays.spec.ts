import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

async function expectCompact(dialog: Locator, button: Locator) {
  const panel = (await dialog.boundingBox())!;
  const action = (await button.boundingBox())!;
  expect(panel.y + panel.height - action.y - action.height).toBeLessThan(40);
  expect(panel.height).toBeLessThan(350);
  expect(action.height).toBeGreaterThanOrEqual(44);
}

test('共享浮层：短提示随内容收紧，视口变化后仍可关闭', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'adaptive-overlays', testInfo);
  await page.goto('/');
  await page.getByRole('button', { name: '打开语音输入' }).click();
  const voice = page.getByRole('dialog', { name: '语音输入暂不可用' });
  await expect(voice).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectCompact(voice, voice.getByRole('button', { name: '关闭语音输入暂不可用' }));
  await voice.getByRole('button', { name: '关闭语音输入暂不可用' }).click();
  await expect(page.getByRole('button', { name: '打开语音输入' })).toBeFocused();

  await page.route('**/api/v1/agent/turns', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AGENT_POINTS_INSUFFICIENT',
          message: '今日智能处理次数已用完',
          requestId: 'req_adaptivequota',
          details: {},
        },
      }),
    }),
  );
  await page.getByLabel('告诉 Agent', { exact: true }).locator('textarea').fill('测试额度提示');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  const quota = page.getByRole('dialog', { name: '明天可继续' });
  await expect(quota).toBeVisible();
  for (const size of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 480, height: 844 },
    { width: 390, height: 560 },
  ]) {
    await page.setViewportSize(size);
    await expectCompact(quota, quota.getByRole('button', { name: '关闭明天可继续' }));
    expect((await quota.boundingBox())!.y).toBeGreaterThanOrEqual(12);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', size.width);
    await page.screenshot({
      path: `docs/quality/screenshots/adaptive-quota-${size.width}x${size.height}.png`,
      animations: 'disabled',
    });
  }
  // Simulate a keyboard-reduced VisualViewport; this is not a physical-device keyboard test.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 320 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => {
      const bounds = (await quota.boundingBox())!;
      return bounds.y + bounds.height;
    })
    .toBeLessThanOrEqual(321);
  await expect(quota.getByRole('button', { name: '关闭明天可继续' })).toBeInViewport();
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await quota.getByRole('button', { name: '关闭明天可继续' }).click();
  await expect(quota).toHaveCount(0);
});
