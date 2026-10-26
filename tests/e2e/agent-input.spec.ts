import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('正式首页直接输入、首字切换发送与减少动态效果', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'agent-input', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('告诉 Agent', { exact: true }).locator('textarea').click();
  await expect(page.getByRole('button', { name: '打开文字输入' })).toHaveCount(0);
  const input = page.getByLabel('告诉 Agent', { exact: true }).locator('textarea');
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.fill('问');
  await expect(page.getByRole('button', { name: '发送给 Agent' })).toBeVisible();
  await expect(page.getByRole('button', { name: '历史聊天记录' })).toHaveCount(0);
  await input.fill('');
  await expect(page.getByRole('button', { name: '历史聊天记录' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await input.fill(' ');
  await expect(page.getByRole('button', { name: '发送给 Agent' })).toHaveJSProperty(
    'disabled',
    true,
  );
  const accessibility = await new AxeBuilder({ page })
    .include('.homeComposer')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await input.fill('发送失败保留这条问题');
  await page.route('**/api/v1/agent/turns', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(input).toHaveValue('发送失败保留这条问题');
});
