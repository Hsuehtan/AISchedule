import { expect, test, type Page } from '@playwright/test';

async function fillTaroField(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label).locator('input, textarea').first().fill(value);
}

test.use({ viewport: { width: 390, height: 844 } });

test('H2 审查反馈中的文字、分隔与任务行布局可见且居中', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const origin = new URL(page.url()).origin;

  const statusBarOffset = await page.locator('.ei-status-bar').evaluate((bar) => {
    const text = bar.firstElementChild;
    if (!(text instanceof HTMLElement)) return Number.POSITIVE_INFINITY;
    const barBounds = bar.getBoundingClientRect();
    const textBounds = text.getBoundingClientRect();
    return Math.abs(
      textBounds.top + textBounds.height / 2 - (barBounds.top + barBounds.height / 2),
    );
  });
  expect(statusBarOffset).toBeLessThanOrEqual(0.5);

  const loginInputOffset = await page.getByLabel('用户名').evaluate((control) => {
    const input = control.querySelector('input');
    if (!(input instanceof HTMLInputElement)) return Number.POSITIVE_INFINITY;
    const controlBounds = control.getBoundingClientRect();
    const inputBounds = input.getBoundingClientRect();
    return Math.abs(
      inputBounds.top + inputBounds.height / 2 - (controlBounds.top + controlBounds.height / 2),
    );
  });
  expect(loginInputOffset).toBeLessThanOrEqual(1);
  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/h2-login-390x844.png',
  });

  const suffix = Date.now().toString(36);
  await page.getByRole('button', { name: '注册新账号' }).click();
  await expect(page.getByText('创建账号', { exact: true })).toBeVisible();
  await fillTaroField(page, '用户名', `visual_${suffix}`);
  await fillTaroField(page, '密码', 'valid-password');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('button', { name: '管理项目' })).toBeVisible();

  const projectName = `视觉项目中的超长名称${suffix.slice(-4)}`;
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: projectName },
    headers: { Origin: origin, 'Idempotency-Key': `visual-project-${suffix}` },
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { project: { id: string; name: string } };
  const taskTitle = `这是一个用于验证省略且保持可见的超长待办标题${suffix.slice(-4)}`;
  const taskResponse = await page.request.post('/api/v1/tasks', {
    data: { projectId: project.project.id, title: taskTitle },
    headers: { Origin: origin, 'Idempotency-Key': `visual-task-${suffix}` },
  });
  expect(taskResponse.status()).toBe(201);

  await page.reload();
  await expect(page.getByRole('button', { name: '管理项目' })).toBeVisible();

  const manageDivider = await page.locator('.manageProjectsChip').evaluate((element) => {
    const style = window.getComputedStyle(element, '::before');
    return { content: style.content, height: style.height, width: style.width };
  });
  expect(manageDivider).toEqual({ content: '""', height: '20px', width: '1px' });

  const row = page.locator('.ei-task-row', { hasText: taskTitle });
  const rowVisuals = await row.evaluate((element) => {
    const openButton = element.querySelector('.ei-task-row__open');
    const projectLabel = element.querySelector('.ei-task-row__project');
    const title = element.querySelector('.ei-task-row__title');
    const timeColumn = element.querySelector('.ei-task-row__time');
    const timeValue = element.querySelector('.ei-task-row__time-value');
    const priority = element.querySelector('.ei-priority');
    const projectValue = timeColumn?.lastElementChild;
    if (
      !(openButton instanceof HTMLElement) ||
      !(projectLabel instanceof HTMLElement) ||
      !(title instanceof HTMLElement) ||
      !(timeColumn instanceof HTMLElement) ||
      !(timeValue instanceof HTMLElement) ||
      !(priority instanceof HTMLElement) ||
      !(projectValue instanceof HTMLElement)
    ) {
      return null;
    }
    const timeBounds = timeColumn.getBoundingClientRect();
    const firstBounds = timeValue.getBoundingClientRect();
    const lastBounds = projectValue.getBoundingClientRect();
    const priorityBounds = priority.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const contentCenter = (firstBounds.top + lastBounds.bottom) / 2;
    return {
      disabledAttribute: openButton.hasAttribute('disabled'),
      leftColumnOffset: Math.abs(contentCenter - (timeBounds.top + timeBounds.height / 2)),
      titleColor: window.getComputedStyle(title).color,
      titleHeight: titleBounds.height,
      titleLeftGap: titleBounds.left - timeBounds.right,
      titleRightGap: priorityBounds.left - titleBounds.right,
      titleTruncated: title.scrollWidth > title.clientWidth,
      projectTruncated: projectLabel.scrollWidth > projectLabel.clientWidth,
    };
  });
  expect(rowVisuals).not.toBeNull();
  expect(rowVisuals?.disabledAttribute).toBe(false);
  expect(rowVisuals?.leftColumnOffset).toBeLessThanOrEqual(1);
  expect(rowVisuals?.titleColor).toBe('rgb(16, 20, 32)');
  expect(rowVisuals?.titleHeight).toBeGreaterThan(0);
  expect(rowVisuals?.titleLeftGap).toBeGreaterThanOrEqual(0);
  expect(rowVisuals?.titleRightGap).toBeGreaterThanOrEqual(0);
  expect(rowVisuals?.titleTruncated).toBe(true);
  expect(rowVisuals?.projectTruncated).toBe(true);

  await page.getByRole('button', { name: '新增待办' }).click();
  const textareaVisuals = await page.getByLabel('待办描述').evaluate((control) => {
    const textarea = control.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return null;
    return {
      controlBackground: window.getComputedStyle(control).backgroundColor,
      resize: window.getComputedStyle(textarea).resize,
      textareaBackground: window.getComputedStyle(textarea).backgroundColor,
    };
  });
  expect(textareaVisuals).not.toBeNull();
  expect(textareaVisuals?.controlBackground).toBe('rgb(246, 249, 255)');
  expect(textareaVisuals?.textareaBackground).toBe('rgba(0, 0, 0, 0)');
  expect(textareaVisuals?.resize).toBe('none');
  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/h2-task-form-390x844.png',
  });
  await page.getByRole('button', { name: '关闭待办编辑' }).click();
  await page.getByRole('button', { name: `完成待办：${taskTitle}` }).click();
  await page.getByRole('button', { name: /已完成 1 项/ }).click();
  const completedTitle = page
    .locator('.ei-task-row--completed', { hasText: taskTitle })
    .locator('.ei-task-row__title');
  await expect(completedTitle).toBeVisible();
  const completedVisuals = await completedTitle.evaluate((element) => ({
    color: window.getComputedStyle(element).color,
    decoration: window.getComputedStyle(element).textDecorationLine,
    height: element.getBoundingClientRect().height,
  }));
  expect(completedVisuals).toMatchObject({
    color: 'rgb(86, 96, 115)',
    decoration: 'line-through',
  });
  expect(completedVisuals.height).toBeGreaterThan(0);
});
