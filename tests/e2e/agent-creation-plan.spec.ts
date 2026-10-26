import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

for (const [key, text, count, existing] of [
  ['creation-plan-single', '创建单项', 1, false],
  ['creation-plan-travel', '去济州岛旅游，规划六天行程', 6, false],
  ['creation-plan-existing', '向已有项目添加济州岛六天行程', 6, true],
] as const) {
  test(`创建统一使用 Plan：${text}`, async ({ page }, testInfo) => {
    await useSyntheticAccount(page, key, testInfo);
    const origin = `http://127.0.0.1:${process.env.H5_PORT ?? 11086}`;
    const headers = () => ({ Origin: origin, 'Idempotency-Key': randomUUID() });
    if (existing) {
      const response = await page.request.post('/api/v1/projects', {
        headers: headers(), data: { name: '既有旅行项目' },
      });
      expect(response.status()).toBe(201);
    }
    await page.goto('/');
    await page.getByLabel('告诉 Agent', { exact: true }).locator('textarea').fill(text);
    await page.getByRole('button', { name: '发送给 Agent' }).click();
    const plan = page.getByRole('dialog', { name: '计划草稿' });
    await expect(plan).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Agent 操作确认卡')).toHaveCount(0);
    await expect(plan.getByRole('button', { name: `创建 ${count} 项` })).toBeVisible();
    if (count === 6) await expect(plan).toContainText('济州岛第6天');
    const before = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
    expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(0);
    await plan.getByRole('button', { name: '关闭 Agent 草稿' }).click();
    await page.reload();
    await page.getByRole('button', { name: /查看确认/ }).click();
    await expect(plan).toBeVisible();
    await expect(page.getByLabel('Agent 操作确认卡')).toHaveCount(0);
    await plan.getByRole('button', { name: `创建 ${count} 项` }).click();
    await expect(plan).toBeHidden();
    const after = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
    const tasks = ((await after.json()) as { items: Array<{ project: { name: string } | null }> }).items;
    expect(tasks).toHaveLength(count);
    if (existing) expect(tasks.every((task) => task.project?.name === '既有旅行项目')).toBe(true);
  });
}
