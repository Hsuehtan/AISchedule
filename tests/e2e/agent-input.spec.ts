import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { useSyntheticAccount } from './synthetic-account';

test('正式 Agent 文字输入保持设计尺寸、完整输入热区与可用操作区', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'agent-input', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开文字输入' }).click();
  const sheet = page.getByRole('dialog', { name: '想让我帮你做什么？' });
  const input = sheet.getByLabel('告诉 Agent 的内容').locator('textarea');
  const send = sheet.getByRole('button', { name: '发送给 Agent' });
  await expect(input).toBeVisible();
  await expect(send).toHaveAttribute('disabled', '');

  for (const width of [390, 320, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(sheet.locator('.agentExamplePrompt').first()).toHaveCSS('font-size', '12px');
    await expect(input).toHaveCSS('resize', 'none');
    await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const bounds = await sheet.locator('.agentCommandInput').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBe(52);
    const innerBounds = await input.boundingBox();
    expect(innerBounds!.height).toBeGreaterThanOrEqual(44);
    expect(innerBounds!.width).toBeGreaterThanOrEqual(bounds!.width - 2);
    await sheet.locator('.agentCommandInput').click({ position: { x: 5, y: 5 } });
    await expect(input).toBeFocused();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/production-agent-input-${width}x844.png`,
    });
  }

  await sheet.getByRole('button', { name: '把周报改成高优先级', exact: true }).click();
  await expect(input).toHaveValue('把周报改成高优先级');
  await expect(send).not.toHaveAttribute('disabled');
  await page.setViewportSize({ width: 390, height: 560 });
  await input.focus();
  const sendBounds = await send.boundingBox();
  expect(sendBounds!.y + sendBounds!.height).toBeLessThanOrEqual(560);
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await sheet.getByRole('button', { name: '取消文字输入' }).click();
  await expect(sheet).toBeHidden();
});
