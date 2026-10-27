import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('四档优先级：任务编辑与计划草稿保存 NONE，确认后回显灰点', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await useSyntheticAccount(page, 'home-refinements', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/v1/tasks', {
    data: { title: '无优先级任务', priority: 'NONE' },
    headers: { Origin: origin, 'Idempotency-Key': 'none-task' },
  });
  expect(created.status()).toBe(201);
  await page.reload();
  await expect(page.locator('.ei-priority--none')).toHaveCSS(
    'background-color',
    'rgb(113, 128, 150)',
  );
  await page.getByRole('button', { name: '编辑待办：无优先级任务' }).click();
  const taskEditor = page.getByRole('dialog', { name: '编辑待办', exact: true });
  await expect(taskEditor.getByRole('button', { name: '无优先级', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await taskEditor.getByRole('button', { name: '高优先级', exact: true }).click();
  await taskEditor.getByRole('button', { name: '保存待办' }).click();
  await expect(taskEditor).toBeHidden();
  await page.getByRole('button', { name: '编辑待办：无优先级任务' }).click();
  await taskEditor.getByRole('button', { name: '无优先级', exact: true }).click();
  await taskEditor.getByRole('button', { name: '保存待办' }).click();
  await expect(taskEditor).toBeHidden();
  await page
    .getByLabel('告诉 Agent', { exact: true })
    .locator('textarea')
    .fill('帮我梳理今天的目标');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  await page.getByRole('button', { name: '根据这条回复生成计划' }).click({ timeout: 20000 });
  const plan = page.getByRole('dialog', { name: '计划草稿', exact: true });
  await expect(plan).toBeVisible({ timeout: 20000 });
  const inbox = page.locator('.ei-smart-inbox--content');
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(inbox.locator('[aria-expanded]')).toHaveCount(0);
    const body = inbox.locator('.ei-smart-inbox__body');
    await expect(body).toHaveCSS('-webkit-line-clamp', '2');
    expect((await body.boundingBox())!.height).toBeLessThanOrEqual(40);
    expect((await inbox.boundingBox())!.height).toBeLessThanOrEqual(88);
    await expect(body).toHaveCSS('margin-left', '0px');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await plan.getByRole('button', { name: '编辑整理需求清单' }).click();
  const editor = page.getByRole('dialog', { name: '编辑草稿', exact: true });
  await editor.getByRole('button', { name: '无优先级', exact: true }).click();
  await editor.getByRole('button', { name: '保存此项' }).click();
  await plan.getByRole('button', { name: '编辑整理需求清单' }).click();
  await expect(editor.getByRole('button', { name: '无优先级', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await editor.screenshot({
    path: 'docs/quality/screenshots/priority-none-editor-390.png',
    animations: 'disabled',
  });
  await editor.getByRole('button', { name: '取消编辑计划项' }).click();
  await plan.getByRole('button', { name: /^创建 \d+ 项$/ }).click();
  await expect(plan).toBeHidden();
  const response = await page.request.get('/api/v1/tasks');
  const result = (await response.json()) as { items: { title: string; priority: string }[] };
  expect(result.items.find((item) => item.title === '整理需求清单')?.priority).toBe('NONE');
});

test('历史长按删除：移动取消、确认取消、失败重试及刷新后保持删除', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'history-deletion', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('告诉 Agent', { exact: true }).locator('textarea').fill('你好');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(conversation.locator('.agentAssistantBubble').first()).toBeVisible({
    timeout: 20000,
  });
  await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await page.getByRole('button', { name: '历史聊天记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '历史聊天记录', exact: true });
  const row = history.locator('.agentHistoryRow').first();
  await expect(row).toBeVisible();
  await row.dispatchEvent('pointerdown', { button: 0, isPrimary: true, clientX: 20, clientY: 20 });
  await row.dispatchEvent('pointermove', { clientX: 20, clientY: 40 });
  await page.waitForTimeout(600);
  await row.dispatchEvent('pointercancel');
  await expect(history.getByText('删除这条聊天记录？')).toHaveCount(0);
  const bounds = (await row.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(history.getByText('删除这条聊天记录？')).toBeVisible();
  await expect(conversation).toHaveCount(0);
  await history.getByRole('button', { name: '取消删除聊天记录' }).click();
  await expect(row).toBeVisible();
  await row.focus();
  await row.press('Delete');
  await page.route('**/api/v1/conversations/*/history', (route) =>
    route.fulfill({
      status: 500,
      json: {
        error: { code: 'INTERNAL_ERROR', message: '临时失败', requestId: 'history_failure' },
      },
    }),
  );
  await history.getByRole('button', { name: '确认删除聊天记录' }).click();
  await expect(history).toContainText('删除失败，请重试');
  await page.unroute('**/api/v1/conversations/*/history');
  await history.screenshot({
    path: 'docs/quality/screenshots/history-delete-confirm-390.png',
    animations: 'disabled',
  });
  await history.getByRole('button', { name: '确认删除聊天记录' }).click();
  await expect(history).toContainText('还没有聊天记录');
  await history.getByRole('button', { name: '关闭历史聊天记录' }).click();
  await page.reload();
  await page.getByRole('button', { name: '历史聊天记录', exact: true }).click();
  await expect(history).toContainText('还没有聊天记录');
});
