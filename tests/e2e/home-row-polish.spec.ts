import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('首页项目筛选隐藏重复归属，长文本单行省略，折叠使用统一图标', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'home-row-polish', testInfo);
  const origin = `http://127.0.0.1:${process.env.H5_PORT ?? 11086}`;
  const projectName = '项目归属名称'.repeat(6);
  const title = '待办名称中英文Task测试'.repeat(12);
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: projectName },
    headers: { Origin: origin, 'Idempotency-Key': 'home-polish-project' },
  });
  expect(projectResponse.status()).toBe(201);
  const { project } = (await projectResponse.json()) as { project: { id: string } };
  const response = await page.request.post('/api/v1/tasks', {
    data: { title, projectId: project.id },
    headers: { Origin: origin, 'Idempotency-Key': 'home-polish-task' },
  });
  expect(response.status()).toBe(201);
  await page.goto('/');
  await expect(page.locator('.taskList .ei-task-row').first()).toBeVisible();
  await expect(page.locator('.manageProjectsChip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '管理项目' })).toHaveCount(1);
  const row = page.locator('.taskList .ei-task-row').first();
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 844 });
    for (const selector of ['.ei-task-row__title', '.ei-task-row__project', '.ei-task-row__meta']) {
      const text = row.locator(selector);
      await expect(text).toHaveCSS('white-space', 'nowrap');
      await expect(text).toHaveCSS('text-overflow', 'ellipsis');
      const metrics = await text.evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(node).lineHeight),
        clipped: node.scrollWidth > node.clientWidth,
      }));
      expect(metrics.height).toBeLessThanOrEqual(metrics.line + 1);
      if (selector !== '.ei-task-row__meta') expect(metrics.clipped).toBe(true);
    }
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({ path: `docs/quality/screenshots/home-row-all-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await expect(row.locator('.ei-task-row__project')).toHaveCount(0);
  const alignment = await row.evaluate((node) => {
    const title = node.querySelector('.ei-task-row__title')!.getBoundingClientRect();
    const meta = node.querySelector('.ei-task-row__meta')!.getBoundingClientRect();
    return Math.abs(title.left - meta.left);
  });
  expect(alignment).toBeLessThan(1);
  await page.screenshot({ path: 'docs/quality/screenshots/home-row-selected-390.png' });
  await row.getByRole('button', { name: `编辑待办：${title}` }).click();
  await expect(page.getByLabel('待办标题').locator('input')).toHaveValue(title);
  await page.getByRole('button', { name: '关闭待办编辑' }).click();
  await row.getByRole('button', { name: `完成待办：${title}` }).click();
  const completed = page.getByRole('button', { name: '已完成 1 项' });
  await completed.click();
  await expect(page.locator('.completedTaskList .ei-task-row__project')).toHaveCount(0);
  await expect(page.locator('.completedTaskList .ei-task-row__title')).toHaveText(title);
  for (const control of [page.locator('.ei-smart-inbox__toggle'), completed]) {
    const icon = control.locator('.homeChevron');
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((node) => getComputedStyle(node).maskImage)).toContain(
      'chevron-down',
    );
    const before = await control.getAttribute('aria-expanded');
    await control.click();
    await expect(control).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
  }
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await completed.click();
  await expect(page.locator('.completedTaskList .ei-task-row__project')).toHaveText(projectName);
  await page.getByRole('button', { name: '管理项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toBeVisible();
  await page.getByRole('button', { name: '关闭项目管理' }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([]);
});
