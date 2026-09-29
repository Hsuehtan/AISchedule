import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

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

async function register(request: APIRequestContext, username = 'e2e_phase3_agent'): Promise<void> {
  const response = await request.post('/api/v1/auth/username/register', {
    data: { username, password: 'valid-password' },
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
  await expect(plan.locator('.agentProposalTitle')).toHaveCSS('font-size', '16px');
  await expect(plan.locator('.agentPlanTitle').first()).toHaveCSS('font-size', '15px');
  await expect(plan.locator('.agentPlanIndex').first()).toHaveCSS('font-size', '12px');
  await expect(plan.locator('.agentEditPlanItem').first()).toHaveCSS('min-width', '44px');
  await expect(plan.locator('.agentEditPlanItem').first()).toHaveCSS('white-space', 'nowrap');
  const planRow = plan.locator('.agentPlanRow').first();
  expect(
    await planRow
      .locator('.agentPlanCopy')
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(140);
  expect(await planRow.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(
    90,
  );
  await plan.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/phase3-agent-plan-v01-390x844.png',
  });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await planRow.evaluate((element) => {
      const copy = element.querySelector('.agentPlanCopy');
      return {
        copyWidth: copy?.getBoundingClientRect().width ?? 0,
        rowWidth: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(geometry.copyWidth).toBeGreaterThan(110);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.rowWidth + 1);
    if (width === 320) {
      const wrappedTitleHeight = await planRow.locator('.agentPlanTitle').evaluate((element) => {
        const original = element.textContent;
        element.textContent = '准备一份完整的项目复盘和面试材料';
        const height = element.getBoundingClientRect().height;
        element.textContent = original;
        return height;
      });
      expect(wrappedTitleHeight).toBeLessThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 560 });
  await expect(plan.getByRole('button', { name: '创建 2 项' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await plan.getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan).toBeHidden();
  await expect(page.getByText('整理需求清单')).toBeVisible();

  await expect(page.getByRole('button', { name: /一键整理：发现 2 个无项目待办/ })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /一键整理：发现 2 个无项目待办/ }).click();
  const organizeProposal = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(organizeProposal).toBeVisible({ timeout: 20_000 });
  await expect(organizeProposal).toContainText('将未归属待办整理到项目');
  await expect(organizeProposal.getByLabel('Agent 操作确认卡')).toBeVisible();
  await organizeProposal
    .getByRole('button', { name: /移除建议/ })
    .first()
    .click();
  await expect(organizeProposal.getByRole('button', { name: /移除建议/ })).toHaveCount(0);
  await organizeProposal.getByRole('button', { name: '确认执行' }).click();
  await expect(organizeProposal).toContainText('已执行');
  await expect(organizeProposal).toBeVisible();

  const tasksAfterOrganizeResponse = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(tasksAfterOrganizeResponse.status()).toBe(200);
  const tasksAfterOrganize = (await tasksAfterOrganizeResponse.json()) as TaskListResponse;
  expect(
    tasksAfterOrganize.items.filter(
      (task) => task.title.startsWith('未归属任务') && task.project?.id === projectId,
    ),
  ).toHaveLength(1);
  await organizeProposal.getByRole('button', { name: '关闭Agent 对话' }).click();

  await openAgentInput(page);
  await submitAgentText(page, '完成待办');
  const completeProposal = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(completeProposal).toBeVisible({ timeout: 20_000 });
  await expect(completeProposal.getByLabel('Agent 操作确认卡')).toBeVisible();
  await expect(completeProposal.locator('.agentActionCardTitle')).toHaveCSS('font-size', '13px');
  expect(
    await completeProposal
      .locator('.agentActionCardValue')
      .first()
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(100);
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 844 });
    const row = completeProposal.locator('.agentActionCard').first();
    const geometry = await row.evaluate((element) => ({
      rowWidth: element.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.rowWidth + 1);
    const composer = completeProposal.locator('.agentConversationComposer');
    await expect(composer).toBeVisible();
    const smallTargets = await row.locator('[role="button"]').evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width < 44 || box.height < 44;
        })
        .map((node) => node.getAttribute('aria-label')),
    );
    expect(smallTargets, `${width}px Action 卡点击目标至少 44px`).toEqual([]);
    await completeProposal.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/phase3-agent-action-card-${width}x844.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 560 });
  await expect(
    completeProposal.getByLabel('继续告诉 Agent 的内容').locator('textarea'),
  ).toBeVisible();
  await completeProposal.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/phase3-agent-action-card-390x560.png',
  });
  const actionAccessibility = await new AxeBuilder({ page })
    .include('.agentConversationDialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(actionAccessibility.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const actionTransition = await completeProposal
    .getByRole('button', { name: '确认执行' })
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(actionTransition)).toBeLessThanOrEqual(0.001);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(completeProposal.getByRole('button', { name: /^编辑/ })).toHaveCount(0);
  await completeProposal.getByRole('button', { name: '确认执行' }).click();
  await expect(completeProposal).toContainText('已执行');
  await completeProposal.getByRole('button', { name: '关闭Agent 对话' }).click();

  const completedResponse = await page.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  expect(completedResponse.status()).toBe(200);
  const completed = (await completedResponse.json()) as TaskListResponse;
  expect(completed.items.length).toBeGreaterThan(0);

  await openAgentInput(page);
  const clarificationTurnResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/agent/turns') && response.request().method() === 'POST',
  );
  await submitAgentText(page, '这件事需要澄清');
  const initialClarification = (await (await clarificationTurnResponse).json()) as {
    conversationId: string;
  };
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
    await expect(resolvedOption).toHaveCSS('font-size', '12px');
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
    const composer = conversation.locator('.agentConversationComposer');
    const thread = conversation.locator('.agentConversation');
    const bounds = await Promise.all([composer.boundingBox(), thread.boundingBox()]);
    expect(bounds[0] && bounds[1] && bounds[0].y >= bounds[1].y + bounds[1].height).toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/phase3-agent-clarification-${width}x844.png`,
    });
  }

  await page.setViewportSize({ width: 390, height: 560 });
  await expect(conversation.getByLabel('继续告诉 Agent 的内容').locator('textarea')).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/phase3-agent-clarification-390x560.png',
  });
  const input = conversation.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  const inputBounds = await input.boundingBox();
  const sendBounds = await conversation.getByRole('button', { name: '发送给 Agent' }).boundingBox();
  expect(inputBounds?.width).toBeGreaterThan(180);
  expect(sendBounds?.width).toBeLessThanOrEqual(80);
  expect(sendBounds && inputBounds && sendBounds.x >= inputBounds.x + inputBounds.width).toBe(true);
  await input.fill('关于生活的第一轮补充');
  const firstFollowupResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/agent/turns') && response.request().method() === 'POST',
  );
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  const firstFollowup = (await (await firstFollowupResponse).json()) as { conversationId: string };
  expect(firstFollowup.conversationId).toBe(initialClarification.conversationId);
  await expect(conversation.getByText('关于生活的第一轮补充')).toBeVisible({ timeout: 20_000 });
  await expect(conversation.getByText('我已经理解你的目标，可以继续为你生成计划。')).toBeVisible({
    timeout: 20_000,
  });

  await input.fill('验证上下文');
  const secondFollowupResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/agent/turns') && response.request().method() === 'POST',
  );
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  const secondFollowup = (await (await secondFollowupResponse).json()) as {
    conversationId: string;
  };
  expect(secondFollowup.conversationId).toBe(initialClarification.conversationId);
  await expect(conversation.getByText('已关联前文的澄清和第一轮补充。')).toBeVisible({
    timeout: 20_000,
  });

  await input.fill('这件事需要澄清');
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(conversation.getByRole('button', { name: '都不是，补充说明' })).toBeEnabled({
    timeout: 20_000,
  });
  await conversation.getByRole('button', { name: '都不是，补充说明' }).click();
  await expect(input).toBeFocused();
  await input.fill('我需要先处理家里的事情');
  let rejectedOnce = false;
  const rejectStaleAnswer = async (route: Route) => {
    if (rejectedOnce) return route.continue();
    rejectedOnce = true;
    await route.fulfill({
      contentType: 'application/json',
      status: 409,
      body: JSON.stringify({
        error: {
          code: 'AGENT_MESSAGE_VERSION_CONFLICT',
          details: {},
          message: '问题已发生变化，请刷新后重试',
          requestId: 'req_e2econflict',
        },
      }),
    });
  };
  await page.route('**/api/v1/conversations/*/messages/*/answers', rejectStaleAnswer);
  const rejectedAnswer = page.waitForResponse(
    (response) => response.url().includes('/answers') && response.status() === 409,
  );
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  await rejectedAnswer;
  await expect(input).toHaveValue('我需要先处理家里的事情');
  await expect(conversation.getByRole('button', { name: '发送给 Agent' })).toBeEnabled();
  await page.unroute('**/api/v1/conversations/*/messages/*/answers', rejectStaleAnswer);
  const freeTextAnswer = page.waitForResponse(
    (response) => response.url().includes('/answers') && response.request().method() === 'POST',
  );
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  const freeTextAnswerResponse = await freeTextAnswer;
  expect(freeTextAnswerResponse.status()).toBe(202);
  const freeTextQueued = (await freeTextAnswerResponse.json()) as {
    request: { requestId: string };
  };
  await expect(conversation.getByText('我需要先处理家里的事情')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/agent/requests/${freeTextQueued.request.requestId}`,
        );
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 20_000 },
    )
    .toBe('SUCCEEDED');
  await expect(conversation.getByText('Agent 正在处理…')).toBeHidden({ timeout: 20_000 });

  await input.fill('关闭期间继续处理');
  let closingTurnCount = 0;
  const delayedTurn = async (route: Route) => {
    closingTurnCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  };
  await page.route('**/api/v1/agent/turns', delayedTurn);
  await conversation.getByRole('button', { name: '发送给 Agent' }).dblclick();
  await expect.poll(() => closingTurnCount).toBe(1);
  await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await expect(conversation).toBeHidden();
  await page.waitForTimeout(1_000);
  await expect(conversation).toBeHidden();
  await page.unroute('**/api/v1/agent/turns', delayedTurn);
});

test('Action 追问只在发送时取消旧卡，失败保留草稿并继续同会话', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request, 'e2e_action_followup');
  await createTask(page.request, '检查追问取消', 'e2e-action-followup-task');
  await page.goto('/');
  await openAgentInput(page);
  const firstTurnResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/agent/turns') && response.request().method() === 'POST',
  );
  await submitAgentText(page, '完成待办');
  const firstTurn = (await (await firstTurnResponse).json()) as { conversationId: string };
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const card = conversation.getByLabel('Agent 操作确认卡');
  await expect(card.getByRole('button', { name: '确认执行' })).toBeVisible({ timeout: 20_000 });
  const proposalResponse = await page.request.get(
    '/api/v1/conversations/' + firstTurn.conversationId + '/messages?limit=100',
  );
  const proposalMessages = (await proposalResponse.json()) as {
    items: { proposalId: string | null }[];
  };
  const proposalId = proposalMessages.items.find((item) => item.proposalId)?.proposalId;
  expect(proposalId).toBeTruthy();
  let cancelCalls = 0;
  let turnCalls = 0;
  const observeCancel = async (route: Route) => {
    cancelCalls += 1;
    await route.continue();
  };
  const observeTurn = async (route: Route) => {
    turnCalls += 1;
    await route.continue();
  };
  await page.route('**/api/v1/action-proposals/*/cancel', observeCancel);
  await page.route('**/api/v1/agent/turns', observeTurn);
  await card.getByRole('button', { name: '继续对话' }).click();
  const input = conversation.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  await expect(input).toBeFocused();
  await input.fill('验证上下文');
  expect(cancelCalls).toBe(0);
  await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await expect(conversation).toBeHidden();
  const stillPending = await page.request.get(`/api/v1/action-proposals/${proposalId}`);
  expect(((await stillPending.json()) as { proposal: { status: string } }).proposal.status).toBe(
    'AWAITING_CONFIRMATION',
  );
  await page.getByRole('button', { name: /查看确认/ }).click();
  await expect(input).toHaveValue('验证上下文');
  let rejectOnce = true;
  const rejectCancel = async (route: Route) => {
    if (!rejectOnce) return route.continue();
    rejectOnce = false;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'ACTION_PROPOSAL_VERSION_CONFLICT',
          message: '提案已变化',
          requestId: 'req_action_conflict',
          details: {},
        },
      }),
    });
  };
  await page.route('**/api/v1/action-proposals/*/cancel', rejectCancel);
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(input).toHaveValue('验证上下文');
  expect(turnCalls).toBe(0);
  await page.unroute('**/api/v1/action-proposals/*/cancel', rejectCancel);
  const nextTurnResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/agent/turns') && response.request().method() === 'POST',
  );
  await conversation.getByRole('button', { name: '发送给 Agent' }).dblclick();
  const nextTurn = (await (await nextTurnResponse).json()) as { conversationId: string };
  expect(nextTurn.conversationId).toBe(firstTurn.conversationId);
  expect(turnCalls).toBe(1);
  await expect(card).toContainText('已取消');
  await expect(card.getByRole('button', { name: '确认执行' })).toHaveCount(0);
  await page.unroute('**/api/v1/action-proposals/*/cancel', observeCancel);
  await page.unroute('**/api/v1/agent/turns', observeTurn);
});

test('Action 已取消后追问失败仍可在当前对话重试', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request, 'e2e_action_retry');
  await createTask(page.request, '检查追问重试', 'e2e-action-retry-task');
  await page.goto('/');
  await openAgentInput(page);
  await submitAgentText(page, '完成待办');
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const secondCard = conversation.getByLabel('Agent 操作确认卡');
  await expect(secondCard.getByRole('button', { name: '确认执行' })).toBeVisible({
    timeout: 20_000,
  });
  await secondCard.getByRole('button', { name: '继续对话' }).click();
  const input = conversation.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  await input.fill('验证上下文');
  let failTurnOnce = true;
  const failTurn = async (route: Route) => {
    if (!failTurnOnce) return route.continue();
    failTurnOnce = false;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'AGENT_SERVICE_UNAVAILABLE',
          message: '稍后重试',
          requestId: 'req_turn_failed',
          details: {},
        },
      }),
    });
  };
  await page.route('**/api/v1/agent/turns', failTurn);
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(secondCard).toContainText('已取消');
  await expect(input).toHaveValue('验证上下文');
  await expect(conversation).toBeVisible();
  await page.unroute('**/api/v1/agent/turns', failTurn);
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(input).toHaveValue('');
});

test('对话内确认删除后保留三秒撤销入口', async ({ page }) => {
  test.setTimeout(120_000);
  await register(page.request, 'e2e_action_delete_undo');
  await createTask(page.request, '待撤销任务', 'e2e-action-undo-task');
  await page.goto('/');
  await openAgentInput(page);
  await submitAgentText(page, '删除待办');
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const card = conversation.getByLabel('Agent 操作确认卡');
  await expect(card).toContainText('删除状态：未删除 → 已删除', { timeout: 20_000 });
  await card.getByRole('button', { name: '确认执行' }).click();
  await expect(card).toContainText('已执行');
  const undo = conversation.getByRole('button', { name: /撤销：已删除/ });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(conversation.getByRole('status')).toHaveCount(0);
  const tasksResponse = await page.request.get('/api/v1/tasks?status=TODO&limit=100');
  expect(
    ((await tasksResponse.json()) as TaskListResponse).items.some(
      (task) => task.title === '待撤销任务',
    ),
  ).toBe(true);
});
