import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

type TaskListResponse = {
  items: { id: string; version: number; title: string; priority: string }[];
};
type PublicActionProposal = { status: string };

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;
const headers = () => ({ Origin: origin, 'Idempotency-Key': randomUUID() });
const conversation = (page: Page) => page.getByRole('dialog', { name: 'Agent 对话' });
const plan = (page: Page) => page.getByRole('dialog', { name: '计划草稿' });

async function start(page: Page, text = '帮我梳理今天的目标') {
  const registration = await page.request.post('/api/v1/auth/username/register', {
    headers: headers(),
    data: {
      username: `case_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      password: 'valid-password',
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/');
  await page.getByRole('button', { name: '打开文字输入' }).click();
  await page.getByLabel('告诉 Agent 的内容').locator('textarea').fill(text);
  const queued = page.waitForResponse(
    (r) => r.url().endsWith('/agent/turns') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  return (await (await queued).json()) as { requestId: string; conversationId: string };
}

async function generate(page: Page) {
  await expect(
    conversation(page).getByRole('button', { name: '根据这条回复生成计划' }),
  ).toBeVisible({ timeout: 20_000 });
  await conversation(page).getByRole('button', { name: '根据这条回复生成计划' }).click();
  await expect(plan(page)).toBeVisible({ timeout: 20_000 });
}

async function proposalId(page: Page, conversationId: string) {
  const response = await page.request.get(
    `/api/v1/conversations/${conversationId}/messages?limit=100`,
  );
  const data = (await response.json()) as { items: { proposalId: string | null }[] };
  const id = data.items.filter((item) => item.proposalId).at(-1)?.proposalId;
  expect(id).toBeTruthy();
  return id!;
}

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

test('计划项目冲突后显示失败，不能继续点击无效创建，可重新生成', async ({ page }) => {
  await start(page);
  await generate(page);
  const project = await page.request.post('/api/v1/projects', {
    headers: headers(),
    data: { name: 'Agent 计划' },
  });
  expect(project.status()).toBe(201);
  await plan(page).getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan(page)).toContainText('执行失败');
  await expect(plan(page).getByRole('button', { name: '创建 2 项' })).toHaveCount(0);
  await expect(plan(page).getByRole('button', { name: /^编辑/ })).toHaveCount(0);
  await plan(page).getByRole('button', { name: '重新生成计划' }).click();
  await expect(plan(page).getByRole('button', { name: '创建 2 项' })).toBeVisible({
    timeout: 20_000,
  });
  await plan(page).getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan(page)).toBeHidden();
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(((await tasks.json()) as TaskListResponse).items).toHaveLength(2);
});

test('计划生成 admission 返回前关闭对话，不会重新弹出浮层', async ({ page }) => {
  await start(page);
  await expect(
    conversation(page).getByRole('button', { name: '根据这条回复生成计划' }),
  ).toBeVisible({ timeout: 20_000 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/agent/plan-generations', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await conversation(page).getByRole('button', { name: '根据这条回复生成计划' }).click();
  await expect(conversation(page)).toContainText('Agent 正在处理…');
  await conversation(page).getByRole('button', { name: '关闭Agent 对话' }).click();
  release();
  await page.waitForTimeout(2_000);
  await expect(conversation(page)).toBeHidden();
  await expect(plan(page)).toBeHidden();
  await page.getByRole('button', { name: /查看确认|查看进度/ }).click();
  await expect(plan(page)).toBeVisible({ timeout: 20_000 });
});

test('同一请求连续两次查询失败后仍可恢复，不停在处理中', async ({ page }) => {
  let polls = 0;
  await page.route('**/api/v1/agent/requests/*', async (route) => {
    polls += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await start(page, '延迟回复');
  const unavailable = page.getByRole('dialog', { name: '智能处理暂不可用' });
  await expect(unavailable).toBeVisible({ timeout: 20_000 });
  await unavailable.getByRole('button', { name: '关闭智能处理暂不可用' }).click();
  await expect(unavailable).toBeHidden();
  await page.getByRole('button', { name: /查看进度|查看回复/ }).click();
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
  await expect(unavailable).toBeVisible({ timeout: 10_000 });
  await page.unroute('**/api/v1/agent/requests/*');
});

test('确认已落库但响应丢失：恢复展示结果，重试不重复创建', async ({ page }) => {
  const queued = await start(page);
  await generate(page);
  const id = await proposalId(page, queued.conversationId);
  await page.route('**/api/v1/action-proposals/*/confirm', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await plan(page).getByRole('button', { name: '创建 2 项' }).dblclick();
  await expect(plan(page)).toContainText('已执行', { timeout: 20_000 });
  await expect(plan(page).getByRole('button', { name: '创建 2 项' })).toHaveCount(0);
  const replay = await page.request.post(`/api/v1/action-proposals/${id}/confirm`, {
    headers: headers(),
    data: { version: 1 },
  });
  expect(replay.status()).toBe(200);
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(((await tasks.json()) as TaskListResponse).items).toHaveLength(2);
});

test('编辑计划期间不能跳过未保存草稿直接确认', async ({ page }) => {
  await start(page);
  await generate(page);
  await plan(page).getByRole('button', { name: '编辑整理需求清单' }).click();
  await plan(page).getByLabel('计划项标题').locator('input').fill('编辑后任务');
  await expect(plan(page).getByRole('button', { name: '创建 2 项' })).toHaveJSProperty(
    'disabled',
    true,
  );
  await plan(page).getByRole('button', { name: '保存此项' }).click();
  await expect(plan(page).getByRole('button', { name: '创建 2 项' })).not.toHaveAttribute(
    'disabled',
  );
  await plan(page).getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan(page)).toBeHidden();
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(
    ((await tasks.json()) as TaskListResponse).items.some(
      (item: { title: string }) => item.title === '编辑后任务',
    ),
  ).toBe(true);
});

test('同会话连续创建、修改、完成、恢复、删除任务，再创建项目任务', async ({ page }) => {
  await start(page, '创建单项');
  for (const [index, input, expected] of [
    [0, '创建单项', 'TODO'],
    [1, '修改待办', 'TODO'],
    [2, '完成待办', 'COMPLETED'],
    [3, '恢复待办', 'TODO'],
    [4, '删除待办', 'DELETED'],
    [5, '创建项目任务', 'TODO'],
  ] as const) {
    if (index > 0) {
      await conversation(page).getByLabel('继续告诉 Agent 的内容').locator('textarea').fill(input);
      await conversation(page).getByRole('button', { name: '发送给 Agent' }).click();
    }
    const card = conversation(page).getByLabel('Agent 操作确认卡').last();
    await expect(conversation(page).getByLabel('Agent 操作确认卡')).toHaveCount(index + 1, {
      timeout: 20_000,
    });
    await expect(card.getByRole('button', { name: '确认执行' })).toBeEnabled();
    // No mutation is applied before confirmation; prior cards remain executed.
    if (index > 0)
      await expect(conversation(page).getByLabel('Agent 操作确认卡').first()).toContainText(
        '已执行',
      );
    const before = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
    if (index === 0 || index === 3 || index === 5)
      expect(((await before.json()) as TaskListResponse).items).toHaveLength(0);
    await card.getByRole('button', { name: '确认执行' }).dblclick();
    await expect(card).toContainText('已执行');
    await expect(conversation(page).getByText('Agent 正在处理…')).toBeHidden();
    const tasks = await page.request.get(
      `/api/v1/tasks?status=${expected === 'DELETED' ? 'TODO' : expected}&limit=100`,
    );
    const items = ((await tasks.json()) as TaskListResponse).items as {
      title: string;
      priority: string;
    }[];
    expect(items).toHaveLength(expected === 'DELETED' ? 0 : 1);
    if (index === 1) expect(items[0]?.priority).toBe('HIGH');
  }
});

test('Action 目标版本冲突不修改任务，后续新一轮可重新确认', async ({ page }) => {
  await start(page, '创建单项');
  const card = () => conversation(page).getByLabel('Agent 操作确认卡').last();
  await expect(card().getByRole('button', { name: '确认执行' })).toBeVisible({ timeout: 20_000 });
  await card().getByRole('button', { name: '确认执行' }).click();
  await expect(card()).toContainText('已执行');
  await conversation(page).getByLabel('继续告诉 Agent 的内容').locator('textarea').fill('完成待办');
  await conversation(page).getByRole('button', { name: '发送给 Agent' }).click();
  await expect(conversation(page).getByLabel('Agent 操作确认卡')).toHaveCount(2, {
    timeout: 20_000,
  });
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  const item = ((await tasks.json()) as TaskListResponse).items[0]!;
  const updated = await page.request.patch(`/api/v1/tasks/${item.id}`, {
    headers: headers(),
    data: { version: item.version, changes: { title: '人工修改过的任务' } },
  });
  expect(updated.status()).toBe(200);
  await card().getByRole('button', { name: '确认执行' }).click();
  await expect(card()).toContainText('执行失败');
  const completed = await page.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  expect(((await completed.json()) as TaskListResponse).items).toHaveLength(0);
  await conversation(page).getByLabel('继续告诉 Agent 的内容').locator('textarea').fill('完成待办');
  await conversation(page).getByRole('button', { name: '发送给 Agent' }).click();
  await expect(conversation(page).getByLabel('Agent 操作确认卡')).toHaveCount(3, {
    timeout: 20_000,
  });
  await card().getByRole('button', { name: '确认执行' }).click();
  await expect(card()).toContainText('已执行');
});

test('处理中关闭浮层，首页进度自动转为可查看回复，重新打开可继续对话', async ({ page }) => {
  await start(page, '延迟回复');
  await expect(conversation(page)).toContainText('Agent 正在处理…');
  await conversation(page).getByRole('button', { name: '关闭Agent 对话' }).click();
  await expect(page.getByRole('button', { name: /查看进度/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /查看回复/ })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: /查看回复/ }).click();
  await expect(conversation(page).getByText('Agent 正在处理…')).toBeHidden();
  await conversation(page)
    .getByLabel('继续告诉 Agent 的内容')
    .locator('textarea')
    .fill('继续聊一下');
  await expect(conversation(page).getByRole('button', { name: '发送给 Agent' })).toBeEnabled();
});

test('计划重生成替代旧草稿，双击仅派发一次，旧草稿不可确认', async ({ page }) => {
  const queued = await start(page);
  await generate(page);
  const oldId = await proposalId(page, queued.conversationId);
  let dispatches = 0;
  await page.route('**/api/v1/agent/plan-generations', async (route) => {
    dispatches += 1;
    await route.continue();
  });
  await plan(page).getByRole('button', { name: '重新生成计划' }).dblclick();
  await expect(conversation(page)).toBeVisible();
  await expect(plan(page)).toBeVisible({ timeout: 20_000 });
  expect(dispatches).toBe(1);
  const newId = await proposalId(page, queued.conversationId);
  expect(newId).not.toBe(oldId);
  const old = await page.request.get(`/api/v1/action-proposals/${oldId}`);
  expect(((await old.json()) as { proposal: PublicActionProposal }).proposal.status).toBe(
    'SUPERSEDED',
  );
  const rejected = await page.request.post(`/api/v1/action-proposals/${oldId}/confirm`, {
    headers: headers(),
    data: { version: 1 },
  });
  expect(rejected.status()).toBe(409);
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(((await tasks.json()) as TaskListResponse).items).toHaveLength(0);
  await page.unroute('**/api/v1/agent/plan-generations');
  let release!: () => void;
  let requestId = '';
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/agent/plan-generations', async (route) => {
    const response = await route.fetch();
    requestId = ((await response.json()) as { requestId: string }).requestId;
    await gate;
    await route.fulfill({ response });
  });
  await plan(page).getByRole('button', { name: '重新生成计划' }).click();
  await expect.poll(() => requestId).not.toBe('');
  await plan(page).getByRole('button', { name: '关闭 Agent 草稿' }).click();
  release();
  await expect(plan(page)).toBeHidden();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v1/agent/requests/${requestId}`);
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 20_000 },
    )
    .toBe('SUCCEEDED');
  await expect(plan(page)).toBeHidden();
  await expect(conversation(page)).toBeHidden();
});

test('计划编辑请求失败保留输入，重试保存后按编辑内容创建', async ({ page }) => {
  await start(page);
  await generate(page);
  await plan(page).getByRole('button', { name: '编辑整理需求清单' }).click();
  const title = plan(page).getByLabel('计划项标题').locator('input');
  await title.fill('失败后保留的编辑');
  await page.route('**/api/v1/action-proposals/*', async (route) => {
    if (route.request().method() === 'PATCH') await route.abort('failed');
    else await route.continue();
  });
  await plan(page).getByRole('button', { name: '保存此项' }).click();
  await expect(plan(page).getByRole('button', { name: '保存此项' })).not.toHaveAttribute(
    'disabled',
  );
  await expect(title).toHaveValue('失败后保留的编辑');
  await page.unroute('**/api/v1/action-proposals/*');
  await plan(page).getByRole('button', { name: '保存此项' }).click();
  await expect(plan(page).getByRole('button', { name: '编辑失败后保留的编辑' })).toBeVisible();
  await plan(page).getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan(page)).toBeHidden();
  const tasks = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(
    ((await tasks.json()) as TaskListResponse).items.some(
      (item: { title: string }) => item.title === '失败后保留的编辑',
    ),
  ).toBe(true);
});
