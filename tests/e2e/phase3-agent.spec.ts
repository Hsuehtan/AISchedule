import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;

type ProjectResponse = { project: { id: string } };
type TaskListResponse = {
  items: Array<{
    id: string;
    project: { id: string; name: string } | null;
    status: 'COMPLETED' | 'TODO';
    title: string;
  }>;
};

async function register(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/v1/auth/username/register', {
    data: { username: 'e2e_phase3_agent', password: 'valid-password' },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(201);
}

async function createProject(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v1/projects', {
    data: { name: 'Agent 项目' },
    headers: { 'Idempotency-Key': 'e2e-phase3-project', Origin: origin },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as ProjectResponse).project.id;
}

async function createTask(
  request: APIRequestContext,
  title: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await request.post('/api/v1/tasks', {
    data: { title, priority: 'MEDIUM' },
    headers: { 'Idempotency-Key': idempotencyKey, Origin: origin },
  });
  expect(response.status()).toBe(201);
}

async function openAgentInput(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开文字输入' }).click();
  await expect(page.getByRole('dialog', { name: '想让我帮你做什么？' })).toBeVisible();
}

async function submitAgentText(page: Page, text: string): Promise<void> {
  await page.getByLabel('告诉 Agent 的内容').locator('textarea').fill(text);
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(page.getByRole('dialog', { name: 'Agent 对话' })).toBeVisible();
}

test.use({ viewport: { width: 390, height: 844 } });

test('Phase 3 对话、计划、Smart Inbox 与原子确认形成真实闭环', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request);
  const projectId = await createProject(page.request);
  await createTask(page.request, '未归属任务一', 'e2e-phase3-task-1');
  await createTask(page.request, '未归属任务二', 'e2e-phase3-task-2');

  await page.goto('/');
  await expect(page.getByText('可以为它们建议项目归属')).toBeVisible();

  await openAgentInput(page);
  await submitAgentText(page, '帮我梳理今天的目标');
  await expect(page.getByText('我已经理解你的目标，可以继续为你生成计划。')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '根据这条回复生成计划' }).click();
  const plan = page.getByRole('dialog', { name: '计划草稿' });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText('整理需求清单');
  await expect(plan).toContainText('完成方案评审');
  await plan.getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText('整理需求清单')).toBeVisible();

  await expect(page.getByRole('button', { name: /一键整理：发现 2 个无项目待办/ })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /一键整理：发现 2 个无项目待办/ }).click();
  const organizeProposal = page.getByRole('dialog', { name: '确认 Agent 操作' });
  await expect(organizeProposal).toBeVisible({ timeout: 20_000 });
  await expect(organizeProposal).toContainText('将未归属待办整理到项目');
  await organizeProposal.getByRole('button', { name: '确认执行' }).click();
  await expect(organizeProposal).toBeHidden();

  const tasksAfterOrganizeResponse = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(tasksAfterOrganizeResponse.status()).toBe(200);
  const tasksAfterOrganize = (await tasksAfterOrganizeResponse.json()) as TaskListResponse;
  expect(
    tasksAfterOrganize.items
      .filter((task) => task.title.startsWith('未归属任务'))
      .every((task) => task.project?.id === projectId),
  ).toBe(true);

  await openAgentInput(page);
  await submitAgentText(page, '完成待办');
  const completeProposal = page.getByRole('dialog', { name: '确认 Agent 操作' });
  await expect(completeProposal).toBeVisible({ timeout: 20_000 });
  await expect(completeProposal.getByText('待确认')).toBeVisible();
  await expect(completeProposal.getByRole('button', { name: /^编辑/ })).toHaveCount(0);
  await completeProposal.getByRole('button', { name: '确认执行' }).click();
  await expect(completeProposal).toBeHidden();

  const completedResponse = await page.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  expect(completedResponse.status()).toBe(200);
  const completed = (await completedResponse.json()) as TaskListResponse;
  expect(completed.items.length).toBeGreaterThan(0);

  await openAgentInput(page);
  await submitAgentText(page, '这件事需要澄清');
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(conversation.getByText('你希望优先处理哪一类事情？')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: '选择生活' }).click();
  await expect(conversation.getByText('已选择「生活」')).toBeVisible();
  for (const label of ['工作', '生活']) {
    const resolvedOption = conversation.getByRole('button', { name: `选择${label}` });
    await expect(resolvedOption).toContainText(label);
    await expect(resolvedOption).toHaveCSS('color', 'rgb(16, 20, 32)');
    await expect(resolvedOption).toHaveCSS('opacity', '1');
  }

  await expect(conversation).not.toContainText('e2e-stub');
  await expect(conversation).not.toContainText('积分');
  const accessibility = await new AxeBuilder({ page })
    .include('.ei-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  for (const width of [390, 320, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    const undersizedTargets = await conversation
      .locator('taro-button-core, [role="button"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const bounds = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              (bounds.width < 44 || bounds.height < 44)
            );
          })
          .map((node) => {
            const bounds = node.getBoundingClientRect();
            return {
              height: bounds.height,
              label: node.getAttribute('aria-label') ?? node.textContent?.trim(),
              width: bounds.width,
            };
          }),
      );
    expect(undersizedTargets, `${width}px Agent 面板不得存在小于 44px 的点击目标`).toEqual([]);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/phase3-agent-clarification-${width}x844.png`,
    });
  }
});
