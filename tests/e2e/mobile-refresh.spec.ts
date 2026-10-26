import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('首页直接输入、计划编辑返回及正式布局', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.todayPreview')).toHaveCount(0);
  await page.screenshot({ path: 'docs/quality/screenshots/refresh-login.png' });
  await useSyntheticAccount(page, 'mobile-refresh', testInfo);
  const origin = new URL(page.url()).origin;
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: 'AI个人IP' },
    headers: { Origin: origin, 'Idempotency-Key': 'refresh-project' },
  });
  const project = (await projectResponse.json()) as { project: { id: string } };
  for (const [index, title] of [
    '确定个人IP定位与差异化人设',
    '搭建小红书和Twitter账号基础信息',
    '制定平台内容模板',
    '执行第一周冷启动发布',
    '建立30个选题库并划分平台内容方向',
  ].entries()) {
    const created = await page.request.post('/api/v1/tasks', {
      data: { title, projectId: project.project.id, priority: index === 4 ? 'MEDIUM' : 'HIGH' },
      headers: { Origin: origin, 'Idempotency-Key': `refresh-task-${index}` },
    });
    expect(created.status()).toBe(201);
  }
  await page.goto('/');
  const input = page.getByLabel('告诉 Agent', { exact: true }).locator('textarea');
  await page.getByRole('button', { name: '编辑待办：确定个人IP定位与差异化人设' }).click();
  const taskEditor = page.getByRole('dialog', { name: '编辑待办', exact: true });
  await expect(taskEditor.getByRole('button', { name: '保存待办' })).toBeVisible();
  await expect(
    taskEditor.getByRole('button', { name: '删除待办：确定个人IP定位与差异化人设' }),
  ).toBeVisible();
  await expect(taskEditor.getByRole('button', { name: '取消编辑', exact: true })).toHaveCount(0);
  await page.screenshot({
    path: 'docs/quality/screenshots/refresh-task-editor.png',
    animations: 'disabled',
  });
  await taskEditor.getByRole('button', { name: '关闭待办编辑' }).click();
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: '历史聊天记录' })).toBeVisible();
  await page.screenshot({
    path: 'docs/quality/screenshots/refresh-home-idle.png',
    animations: 'disabled',
  });
  await input.fill('帮我梳理今天的目标');
  await expect(page.getByRole('button', { name: '历史聊天记录' })).toHaveCount(0);
  for (const size of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 480, height: 844 },
    { width: 390, height: 560 },
  ]) {
    await page.setViewportSize(size);
    const bounds = await page.getByRole('button', { name: '发送给 Agent' }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', size.width);
    await page.screenshot({
      path: `docs/quality/screenshots/refresh-home-${size.width}x${size.height}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(page.getByRole('dialog', { name: 'Agent 对话' })).toBeVisible();
  await page.getByRole('button', { name: '根据这条回复生成计划' }).click({ timeout: 20000 });
  const plan = page.getByRole('dialog', { name: '计划草稿', exact: true });
  await expect(plan).toBeVisible({ timeout: 20000 });
  const planHandle = plan.getByRole('slider', { name: '调整浮层高度' });
  await planHandle.focus();
  await page.keyboard.press('Home');
  await expect(plan.getByRole('button', { name: '创建', exact: false })).toBeInViewport();
  await expect(plan.getByRole('button', { name: '取消 Agent 草稿' })).toBeInViewport();
  await page.keyboard.press('Enter');
  await page.screenshot({
    path: 'docs/quality/screenshots/refresh-plan.png',
    animations: 'disabled',
  });
  const close = plan.getByRole('button', { name: '关闭 Agent 草稿' });
  await expect(close).toHaveCSS('border-top-width', '0px');
  expect(await close.evaluate((node) => getComputedStyle(node, '::after').display)).toBe('none');
  expect((await plan.boundingBox())!.height).toBeLessThan(600);
  const edit = plan.getByRole('button', { name: '编辑整理需求清单' });
  await expect(edit).toHaveCSS('align-items', 'center');
  await edit.click();
  const editor = page.getByRole('dialog', { name: '编辑草稿', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('slider', { name: '调整浮层高度' }).focus();
  await page.keyboard.press('Home');
  await expect(editor.getByRole('button', { name: '保存此项' })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('button', { name: '创建', exact: false })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '删除此项' })).toHaveCount(0);
  const gap = await editor.locator('.agentProposalEditorActions').evaluate((node) => {
    const lastField = node.parentElement!.querySelector('.dateTimePickerField_reminderAt')!;
    return node.getBoundingClientRect().top - lastField.getBoundingClientRect().bottom;
  });
  expect(gap).toBeLessThan(48);
  await editor.getByLabel('计划项标题').locator('input').fill('未保存修改');
  await editor.getByRole('button', { name: '取消编辑计划项' }).click();
  await expect(plan).not.toContainText('未保存修改');
  await plan.getByRole('button', { name: '编辑整理需求清单' }).click();
  await editor.getByLabel('计划项标题').locator('input').fill('已保存修改');
  await page.screenshot({
    path: 'docs/quality/screenshots/refresh-draft-editor.png',
    animations: 'disabled',
  });
  for (const size of [
    { width: 320, height: 844 },
    { width: 480, height: 844 },
    { width: 390, height: 560 },
  ]) {
    await page.setViewportSize(size);
    const bounds = await editor.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    await expect(editor.getByRole('button', { name: '保存此项' })).toBeInViewport();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', size.width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole('button', { name: '保存此项' }).click();
  await expect(plan).toBeVisible();
  await expect(plan).toContainText('已保存修改');
});
