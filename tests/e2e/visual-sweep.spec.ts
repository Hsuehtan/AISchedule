import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;
const output = 'docs/quality/screenshots/visual-sweep-2026-09-29';

mkdirSync(output, { recursive: true });
test.use({ viewport: { width: 390, height: 844 } });

async function shot(page: Page, name: string): Promise<void> {
  // Allow enter/exit layers to finish before capturing the settled screen.
  await page.waitForTimeout(450);
  await page.screenshot({ animations: 'disabled', path: `${output}/${name}.png` });
}

async function register(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/v1/auth/username/register', {
    data: { username: `visual_${randomUUID().slice(0, 12)}`, password: 'valid-password' },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(201);
}

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/api/v1/projects', {
    data: { name },
    headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

async function createTask(
  request: APIRequestContext,
  title: string,
  options: { priority?: 'HIGH' | 'LOW' | 'MEDIUM'; projectId?: string } = {},
): Promise<void> {
  const response = await request.post('/api/v1/tasks', {
    data: { title, priority: options.priority ?? 'MEDIUM', ...options },
    headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
  });
  expect(response.status()).toBe(201);
}

async function sendAgent(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: '打开文字输入' }).click();
  await page.getByLabel('告诉 Agent 的内容').locator('textarea').fill(text);
  await page.getByRole('button', { name: '发送给 Agent' }).click();
}

test('登录、注册、空首页和项目管理状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.getByText('欢迎回来')).toBeVisible();
  await shot(page, '01-login-default-390x844');

  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText(/用户名需为 3-32 个/)).toBeVisible();
  await shot(page, '02-login-validation-390x844');

  await page.getByRole('button', { name: '注册新账号' }).click();
  await expect(page.getByText('创建账号', { exact: true })).toBeVisible();
  await shot(page, '03-register-default-390x844');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByText(/用户名需为 3-32 个/)).toBeVisible();
  await shot(page, '04-register-validation-390x844');

  await page.getByLabel('用户名').locator('input').fill(`visual_${randomUUID().slice(0, 12)}`);
  await page.getByLabel('密码').locator('input').fill('valid-password');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByText('今天已经清空')).toBeVisible();
  await shot(page, '05-tasks-empty-390x844');

  await page.getByRole('button', { name: '管理项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toBeVisible();
  await shot(page, '06-project-manager-empty-390x844');
  await page.getByRole('button', { name: '新建项目' }).click();
  await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible();
  await shot(page, '07-project-create-empty-390x844');
  await page.getByRole('button', { name: '保存项目' }).click();
  await shot(page, '08-project-create-validation-390x844');
  await page.getByLabel('项目名称').locator('input').fill('工作');
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toContainText('工作');
  await shot(page, '09-project-manager-populated-390x844');
  await page.getByRole('button', { name: '改名项目：工作' }).click();
  await expect(page.getByRole('dialog', { name: '项目改名' })).toBeVisible();
  await shot(page, '10-project-rename-390x844');
  await page.getByRole('button', { name: '取消项目编辑' }).click();
  await page.getByRole('button', { name: '归档项目：工作' }).click();
  await expect(page.getByRole('dialog', { name: '归档“工作”？' })).toBeVisible();
  await shot(page, '11-project-archive-confirm-390x844');
});

test('任务列表、编辑、时间选择、完成和撤销状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  const projectId = await createProject(page.request, '工作');
  await createTask(page.request, '写周报', { priority: 'HIGH', projectId });
  await createTask(page.request, '准备季度评审资料并核对所有附件和会议安排', {
    priority: 'MEDIUM',
    projectId,
  });
  await createTask(page.request, '交物业费', { priority: 'LOW' });
  await page.goto('/');
  await expect(page.getByText('写周报', { exact: true })).toBeVisible();
  await shot(page, '12-all-todos-mixed-390x844');
  await page.setViewportSize({ width: 320, height: 844 });
  await shot(page, '13-all-todos-mixed-320x844');
  await page.setViewportSize({ width: 480, height: 844 });
  await shot(page, '14-all-todos-mixed-480x844');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole('button', { name: '工作', exact: true }).click();
  await expect(page.getByText('工作 · 2 件待办')).toBeVisible();
  await shot(page, '15-project-filter-390x844');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  await page.getByRole('button', { name: '新增待办' }).click();
  await expect(page.getByRole('dialog', { name: '新建待办' })).toBeVisible();
  await shot(page, '16-task-create-empty-390x844');
  await page.getByLabel('待办标题').locator('input').fill('安排体检预约');
  await page.getByLabel('待办描述').locator('textarea').fill('比较可用时间和交通路线');
  await shot(page, '17-task-create-filled-390x844');
  await page.setViewportSize({ width: 320, height: 844 });
  await shot(page, '18-task-create-filled-320x844');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^计划时间，/ }).click();
  await expect(page.locator('.weui-picker__action:visible').filter({ hasText: '确定' })).toBeVisible();
  await shot(page, '19-task-datetime-picker-390x844');
  await page.locator('.weui-picker__action:visible').filter({ hasText: '取消' }).click();
  await page.getByRole('button', { name: '取消编辑' }).click();

  await page.getByText('写周报', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toBeVisible();
  await shot(page, '20-task-edit-390x844');
  await page.getByRole('button', { name: '取消编辑' }).click();

  await page.getByRole('button', { name: '完成待办：写周报' }).click();
  await expect(page.getByRole('button', { name: /已完成 1 项/ })).toBeVisible();
  await shot(page, '21-done-collapsed-390x844');
  await page.getByRole('button', { name: /已完成 1 项/ }).click();
  await expect(page.getByRole('button', { name: '恢复待办：写周报' })).toBeVisible();
  await shot(page, '22-done-expanded-390x844');

  await page.getByText('交物业费', { exact: true }).click();
  await page.getByRole('button', { name: '删除待办：交物业费' }).click();
  await expect(page.getByRole('button', { name: '撤销：已删除“交物业费”' })).toBeVisible();
  await shot(page, '23-delete-undo-toast-390x844');
});

test('Agent 文字、回复、计划草稿和待确认状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '打开文字输入' }).click();
  await expect(page.getByRole('dialog', { name: '想让我帮你做什么？' })).toBeVisible();
  await shot(page, '24-agent-text-empty-390x844');
  await page.setViewportSize({ width: 320, height: 844 });
  await shot(page, '25-agent-text-empty-320x844');
  await page.setViewportSize({ width: 480, height: 844 });
  await shot(page, '26-agent-text-empty-480x844');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '把周报改成高优先级', exact: true }).click();
  await shot(page, '27-agent-text-example-filled-390x844');
  await page.getByLabel('告诉 Agent 的内容').locator('textarea').fill('帮我梳理今天的目标');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(page.getByText('我已经理解你的目标，可以继续为你生成计划。')).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, '28-agent-reply-390x844');
  await page.setViewportSize({ width: 320, height: 844 });
  await shot(page, '29-agent-reply-320x844');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '根据这条回复生成计划' }).click();
  const plan = page.getByRole('dialog', { name: '计划草稿' });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await shot(page, '30-agent-plan-draft-390x844');
  await plan.getByRole('button', { name: '编辑整理需求清单' }).click();
  await expect(page.getByLabel('计划项标题').locator('input')).toBeVisible();
  await shot(page, '31-agent-plan-item-edit-390x844');
  await page.getByLabel('计划项标题').locator('input').fill('整理露营需求清单');
  await plan.getByRole('button', { name: '保存此项' }).click();
  await expect(plan.getByText('整理露营需求清单')).toBeVisible();
  await shot(page, '32-agent-plan-edited-390x844');
  await plan.getByRole('button', { name: '关闭 Agent 草稿' }).click();
  await expect(plan).toBeHidden();
  await shot(page, '33-smart-inbox-pending-plan-390x844');
});

test('Agent 澄清、候选和操作确认状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  await createTask(page.request, '周报初稿', { priority: 'HIGH' });
  await createTask(page.request, '周报复核', { priority: 'LOW' });
  await page.goto('/');
  await sendAgent(page, '这件事需要澄清');
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(conversation.getByText('你希望优先处理哪一类事情？')).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, '34-agent-clarify-390x844');
  await page.setViewportSize({ width: 320, height: 844 });
  await shot(page, '35-agent-clarify-320x844');
  await page.setViewportSize({ width: 390, height: 844 });
  await conversation.getByRole('button', { name: '选择生活' }).click();
  await expect(conversation.getByText('已选择「生活」')).toBeVisible();
  await shot(page, '36-agent-clarify-answered-390x844');
  await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();

  await sendAgent(page, '候选');
  await expect(page.getByRole('dialog', { name: 'Agent 对话' }).getByText('你指的是哪一项待办？')).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, '37-agent-candidates-390x844');
  await page.getByRole('dialog', { name: 'Agent 对话' }).getByRole('button', { name: '关闭Agent 对话' }).click();

  await sendAgent(page, '完成待办');
  const action = page.getByRole('dialog', { name: '确认 Agent 操作' });
  await expect(action).toBeVisible({ timeout: 20_000 });
  await shot(page, '38-agent-action-confirm-390x844');
  await action.getByRole('button', { name: '关闭 Agent 草稿' }).click();
  await expect(action).toBeHidden();
  await shot(page, '39-smart-inbox-pending-action-390x844');
});

test('Smart Inbox 整理和折叠状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  await createTask(page.request, '未归属的清单');
  await page.goto('/');
  await expect(page.getByText('可以为它们建议项目归属')).toBeVisible();
  await shot(page, '40-smart-inbox-organize-390x844');
  await page.getByRole('button', { name: /折叠 Smart Inbox/ }).click();
  await shot(page, '41-smart-inbox-collapsed-390x844');
});

test('语音延期与额度异常状态截图', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '打开语音输入' }).click();
  await expect(page.getByRole('dialog', { name: '语音输入暂不可用' })).toBeVisible();
  await shot(page, '42-voice-deferred-390x844');
  await page.getByRole('button', { name: '关闭语音输入暂不可用' }).click();

  await page.route('**/api/v1/agent/turns', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AGENT_POINTS_INSUFFICIENT',
          message: '今日智能处理次数已用完',
          requestId: 'req_visualsweepquota',
          details: {},
        },
      }),
    });
  });
  await sendAgent(page, '帮我整理待办');
  await expect(page.getByRole('dialog', { name: '明天可继续' })).toBeVisible();
  await shot(page, '43-agent-quota-simulated-390x844');
});
