import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('首页输入居中、隐藏滚动条，历史会话可跨刷新恢复和继续问答', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await useSyntheticAccount(page, 'conversation-history', testInfo);
  await page.goto('/');
  const historyButton = page.getByRole('button', { name: '历史聊天记录', exact: true });
  await historyButton.focus();
  await historyButton.press('Enter');
  const history = page.getByRole('dialog', { name: '历史聊天记录', exact: true });
  await expect(history).toContainText('还没有聊天记录');
  await history.getByRole('button', { name: '关闭历史聊天记录' }).click();
  const input = page.getByLabel('告诉 Agent', { exact: true }).locator('textarea');
  await expect(page.locator('.homeComposer .composerSpark')).toHaveCount(0);
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 480, height: 844 },
    { width: 390, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    const shell = await page.locator('.productionTodoScreen').boundingBox();
    const composer = await page.locator('.homeComposer').boundingBox();
    expect(
      Math.abs(composer!.x - shell!.x - (shell!.x + shell!.width - composer!.x - composer!.width)),
    ).toBeLessThan(1);
    await input.fill('第一行\n第二行\n第三行\n第四行');
    await expect(input).toHaveCSS('scrollbar-width', 'none');
    await expect(historyButton).toHaveCount(0);
    await expect(page.getByRole('button', { name: '发送给 Agent' })).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('帮我梳理今天的目标');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(dialog).toContainText('我已经理解你的目标，可以继续为你生成计划。', {
    timeout: 20_000,
  });
  await dialog.getByRole('button', { name: '关闭Agent 对话' }).click();
  await page.reload();
  await historyButton.click();
  await expect(history.getByRole('button', { name: '打开会话：帮我梳理今天的目标' })).toBeVisible();
  const first = await page.request.get('/api/v1/conversations?limit=1');
  expect(first.status()).toBe(200);
  const listing = (await first.json()) as { items: { id: string }[] };
  const conversationId = listing.items[0]!.id;
  await history.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const accessibility = await new AxeBuilder({ page }).include('.agentHistorySheet').analyze();
  expect(accessibility.violations).toEqual([]);
  await history.screenshot({
    path: 'docs/quality/screenshots/conversation-history-390.png',
    animations: 'disabled',
  });
  await history.getByRole('button', { name: '打开会话：帮我梳理今天的目标' }).focus();
  await history.getByRole('button', { name: '打开会话：帮我梳理今天的目标' }).press('Enter');
  await expect(dialog).toContainText('我已经理解你的目标，可以继续为你生成计划。');
  await expect(dialog).toContainText('帮我梳理今天的目标');
  const followup = dialog.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  await followup.fill('请继续解释');
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/agent/turns') && request.method() === 'POST',
  );
  await dialog.getByRole('button', { name: '发送给 Agent' }).click();
  expect((await requestPromise).postDataJSON()).toMatchObject({ conversationId });
  await expect(dialog).toContainText('请继续解释');
  await dialog.getByRole('button', { name: '关闭Agent 对话' }).click();
  await page
    .locator('.homeComposer')
    .screenshot({ path: 'docs/quality/screenshots/home-composer-history-390.png' });
});
