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
  await plan.getByRole('button', { name: '编辑整理需求清单' }).click({ timeout: 20000 });
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
