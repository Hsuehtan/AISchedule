import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { chromium, expect } from '@playwright/test';

import { DatabaseService } from '../apps/server/dist/platform/database/database.service.js';
import { AdminPointsService } from '../apps/server/dist/admin/admin-points.service.js';
import { loadPointsConfig } from '../packages/config/dist/index.js';

const origin = process.env.AGENT_ACCEPTANCE_ORIGIN ?? 'http://127.0.0.1:10087';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('LOCAL_SYNTHETIC_ACCEPTANCE_REQUIRES_LOOPBACK_ORIGIN');
}
const account = `pydantic_accept_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const output = resolve(
  process.env.AGENT_ACCEPTANCE_OUTPUT ?? `docs/quality/agent-pydantic-acceptance/final-2026-10-27/${account}`,
);
const local = parseEnv(await readFile('.env', 'utf8'));
const database = new DatabaseService(local.DATABASE_URL);
const phaseResult = { status: 'running', account, phases: [], runs: [], debits: [] };
let phase = 'startup';
let browser;

const recordPhase = (name) => {
  phaseResult.phases.push(name);
  console.log(JSON.stringify({ phase: name, status: 'passed' }));
};

const latestProposal = async (context, conversationId) => {
  const messages = await context.request.get(
    `/api/v1/conversations/${conversationId}/messages?limit=100`,
  );
  const proposalId = (await messages.json()).items.filter((message) => message.proposalId).at(-1)?.proposalId;
  if (!proposalId) throw new Error('PROPOSAL_NOT_FOUND');
  const response = await context.request.get(`/api/v1/action-proposals/${proposalId}`);
  return (await response.json()).proposal;
};

const save = async (name, page) => {
  await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
};

const saveResponsive = async (name, page, panel, control) => {
  phaseResult.viewports ??= [];
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(panel).toBeInViewport();
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    const box = await control.boundingBox();
    if (!box || box.width < 43.9 || box.height < 43.9) throw new Error('TOUCH_TARGET_TOO_SMALL');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) throw new Error('HORIZONTAL_OVERFLOW');
    phaseResult.viewports.push({ component: name, width, height: 844, targetWidth: box.width, targetHeight: box.height });
    await save(`${name}-${width}.png`, page);
  }
  await page.setViewportSize({ width: 390, height: 560 });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport();
  await save(`${name}-keyboard-390x560.png`, page);
  phaseResult.viewports.push({ component: name, width: 390, height: 560, controlVisible: true });
  await page.setViewportSize({ width: 390, height: 844 });
};

const submitHome = async (page, text) => {
  const input = page.getByLabel('告诉 Agent', { exact: true }).locator('textarea');
  await input.fill(text);
  const response = page.waitForResponse(
    (item) => item.url().endsWith('/api/v1/agent/turns') && item.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  const queued = await response;
  if (queued.status() !== 202) throw new Error('ADMISSION_FAILED');
  return queued.json();
};

const waitForCard = async (page, count) => {
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const cards = conversation.getByLabel('Agent 操作确认卡');
  await expect(cards).toHaveCount(count, { timeout: 90_000 });
  return cards.nth(count - 1);
};

try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    baseURL: origin,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 390, height: 844 },
  });
  const observedAdmissions = new Set();
  const admissionObservations = [];
  context.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      [200, 202].includes(response.status()) &&
      /\/(agent\/(turns|plan-generations)|smart-inbox\/organize|messages\/[^/]+\/answers)$/.test(new URL(response.url()).pathname)
    ) {
      admissionObservations.push(response.json().then((body) => {
        const requestId = body.requestId ?? body.request?.requestId;
        if (requestId) observedAdmissions.add(requestId);
      }));
    }
  });
  const page = await context.newPage();
  phase = 'register';
  const registered = await context.request.post('/api/v1/auth/username/register', {
    data: { username: account, password: `local-only-${randomUUID()}` },
    headers: { Origin: origin },
  });
  if (registered.status() !== 201) throw new Error('REGISTER_FAILED');
  await new AdminPointsService(
    database.client, loadPointsConfig(resolve('config/product/points.yaml')),
  ).adjust({
    lookup: { username: account }, operation: 'ADD', value: 20, dryRun: false,
    operator: 'agent-local-acceptance', reason: 'synthetic extended Agent acceptance fixture',
  });
  phaseResult.syntheticPointsAdjustment = 20;
  await page.goto(origin);
  await expect(page.getByLabel('告诉 Agent', { exact: true })).toBeVisible();
  recordPhase('page-ready');

  const bystanderCreated = await context.request.post('/api/v1/tasks', {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { title: '本地旁观任务', description: '不得改变', priority: 'LOW' },
  });
  if (bystanderCreated.status() !== 201) throw new Error('BYSTANDER_FIXTURE_FAILED');
  const bystander = (await bystanderCreated.json()).task;
  const completedBystander = await context.request.post(`/api/v1/tasks/${bystander.id}/complete`, {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { version: bystander.version },
  });
  if (completedBystander.status() !== 200) throw new Error('BYSTANDER_COMPLETE_FAILED');
  const bystanderSnapshot = (await completedBystander.json()).task;

  phase = 'create-task';
  const first = await submitHome(
    page,
    '请创建一个无项目待办，标题为“本地验收甲”，优先级中，不设置时间。请给我确认卡。',
  );
  const firstPlan = page.getByRole('dialog', { name: '计划草稿' });
  await expect(firstPlan).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel('Agent 操作确认卡')).toHaveCount(0);
  await saveResponsive('creation-plan-before-confirm', page, firstPlan,
    firstPlan.getByRole('button', { name: '创建 1 项' }));
  const before = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if ((await before.json()).items.some((task) => task.title === '本地验收甲')) {
    throw new Error('WRITE_BEFORE_CONFIRM');
  }
  await firstPlan.getByRole('button', { name: '创建 1 项' }).click();
  await expect(firstPlan).toBeHidden({ timeout: 30_000 });
  await page.getByRole('button', { name: '历史聊天记录', exact: true }).click();
  await page.getByRole('button', { name: /^打开会话：/ }).first().click();
  const after = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const created = (await after.json()).items.find((task) => task.title === '本地验收甲');
  if (!created || created.priority !== 'MEDIUM') throw new Error('CREATE_FIELDS_MISMATCH');
  recordPhase('create-confirmed');

  phase = 'referential-update';
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await conversation
    .getByLabel('继续告诉 Agent 的内容')
    .locator('textarea')
    .fill('把它改成高优先级，其他字段不变，请给我确认卡。');
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  const secondCard = await waitForCard(page, 1);
  await secondCard.getByRole('button', { name: '确认执行' }).click();
  await expect(secondCard).toContainText('已执行', { timeout: 30_000 });
  const updated = await context.request.get(`/api/v1/tasks/${created.id}`);
  const updatedTask = (await updated.json()).task;
  if (updatedTask.priority !== 'HIGH' || updatedTask.title !== '本地验收甲') {
    throw new Error('UPDATE_FIELDS_MISMATCH');
  }
  await save('action-after-confirm-390.png', page);
  recordPhase('referential-update-confirmed');

  phase = 'plan';
  await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(
    page,
    '请只用一句文字说明如何准备一次产品评审，并提供生成计划的入口，不要执行任务操作。',
  );
  const planConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const generate = planConversation
    .getByRole('button', { name: '根据这条回复生成计划' })
    .last();
  await expect(generate).toBeVisible({ timeout: 90_000 });
  await save('reply-before-plan-390.png', page);
  await generate.click();
  const plan = page.getByRole('dialog', { name: '计划草稿' });
  await expect(plan).toBeVisible({ timeout: 120_000 });
  await saveResponsive('plan-before-confirm', page, plan,
    plan.getByRole('button', { name: /^创建 \d+ 项$/ }));
  const edit = plan.getByRole('button', { name: /^编辑/ }).first();
  await edit.click();
  const editor = page.getByRole('dialog', { name: '编辑草稿' });
  await editor.getByLabel('计划项标题').locator('input').fill('本地验收评审准备');
  await editor.getByRole('button', { name: '保存此项' }).click();
  await expect(plan.getByRole('button', { name: '编辑本地验收评审准备' })).toBeVisible();
  const createPlan = plan.getByRole('button', { name: /^创建 \d+ 项$/ });
  await createPlan.click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  recordPhase('plan-edited-confirmed');

  phase = 'complete-restore-delete';
  if (await conversation.isVisible()) {
    await conversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  }
  await submitHome(page, '请把标题为“本地验收甲”的待办标记完成，给我确认卡。');
  const actionConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const completeCard = await waitForCard(page, 1);
  await completeCard.getByRole('button', { name: '确认执行' }).click();
  await expect(completeCard).toContainText('已执行', { timeout: 30_000 });
  phase = 'complete-verify';
  let changed = await context.request.get(`/api/v1/tasks/${created.id}`);
  if ((await changed.json()).task?.status !== 'COMPLETED') throw new Error('COMPLETE_MISMATCH');
  recordPhase('complete-confirmed');

  const followup = actionConversation.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  await followup.fill('把刚完成的“本地验收甲”恢复为待完成，给我确认卡。');
  await actionConversation.getByRole('button', { name: '发送给 Agent' }).click();
  const restoreCard = await waitForCard(page, 2);
  await restoreCard.getByRole('button', { name: '确认执行' }).click();
  await expect(restoreCard).toContainText('已执行', { timeout: 30_000 });
  phase = 'restore-verify';
  changed = await context.request.get(`/api/v1/tasks/${created.id}`);
  if ((await changed.json()).task?.status !== 'TODO') throw new Error('RESTORE_MISMATCH');
  recordPhase('restore-confirmed');

  await followup.fill('请删除“本地验收甲”这个待办，给我确认卡。');
  await actionConversation.getByRole('button', { name: '发送给 Agent' }).click();
  const deleteCard = await waitForCard(page, 3);
  await deleteCard.getByRole('button', { name: '确认执行' }).click();
  await expect(deleteCard).toContainText('已执行', { timeout: 30_000 });
  phase = 'undo-click';
  await actionConversation.getByRole('button', { name: /撤销：已删除/ }).click();
  phase = 'undo-verify';
  await expect
    .poll(async () => {
      const restored = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
      return (await restored.json()).items.some((task) => task.id === created.id);
    }, { timeout: 10_000 })
    .toBe(true);
  recordPhase('delete-and-undo-confirmed');

  phase = 'organize';
  await actionConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  for (const title of ['本地整理甲', '本地整理乙']) {
    const fixture = await context.request.post('/api/v1/tasks', {
      headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
      data: { title, priority: 'MEDIUM' },
    });
    if (fixture.status() !== 201) throw new Error('ORGANIZE_FIXTURE_FAILED');
  }
  const unorganizedBefore = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const beforeRows = new Map((await unorganizedBefore.json()).items.map((task) => [task.id, task]));
  const organizeEntry = page.getByRole('button', { name: /一键整理：发现/ });
  await expect(organizeEntry).toBeVisible({ timeout: 30_000 });
  await organizeEntry.click();
  const organizeConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const organizeCard = await waitForCard(page, 1);
  await save('organize-before-confirm-390.png', page);
  const removeSuggestion = organizeConversation.getByRole('button', { name: /移除建议/ });
  await expect.poll(() => removeSuggestion.count()).toBeGreaterThan(1);
  const removedLabel = await removeSuggestion.first().getAttribute('aria-label');
  const removedTask = [...beforeRows.values()].find((task) => `移除建议${task.title}` === removedLabel);
  if (!removedTask || !removedLabel) throw new Error('ORGANIZE_REMOVED_TARGET_UNKNOWN');
  await removeSuggestion.first().click();
  await expect(organizeConversation.getByRole('button', { name: removedLabel, exact: true })).toHaveCount(0);
  recordPhase('organize-item-removed');
  await saveResponsive('organize-controls', page, organizeConversation,
    organizeCard.getByRole('button', { name: '确认执行' }));
  await organizeCard.getByRole('button', { name: '确认执行' }).click();
  await expect(organizeCard).toContainText('已执行', { timeout: 30_000 });
  const unorganizedAfter = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const afterRows = (await unorganizedAfter.json()).items;
  if (JSON.stringify(afterRows.find((task) => task.id === removedTask.id)) !== JSON.stringify(removedTask)) {
    throw new Error('ORGANIZE_REMOVED_ITEM_CHANGED');
  }
  const enrichedFields = new Set();
  for (const afterTask of afterRows) {
    const beforeTask = beforeRows.get(afterTask.id);
    if (!beforeTask) continue;
    for (const field of ['projectId', 'scheduledAt', 'reminderAt']) {
      if (beforeTask[field] != null && afterTask[field] !== beforeTask[field]) {
        throw new Error('ORGANIZE_OVERWROTE_EXISTING_FIELD');
      }
      if (beforeTask[field] == null && afterTask[field] != null) enrichedFields.add(field);
    }
  }
  if (enrichedFields.size < 2) throw new Error('ORGANIZE_MULTIFIELD_MISMATCH');
  recordPhase('organize-multifield-confirmed');

  phase = 'project-bulk';
  await organizeConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(
    page,
    '请创建名为“本地验收丙”的新项目，并添加“准备材料”和“预约会议”两个待办，给我确认卡。',
  );
  const projectConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(plan).toBeVisible({ timeout: 90_000 });
  await plan.getByRole('button', { name: '创建 2 项' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  const projectsResponse = await context.request.get('/api/v1/projects?status=ACTIVE&limit=100');
  const project = (await projectsResponse.json()).items.find((item) => item.name === '本地验收丙');
  const tasksResponse = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const projectTasks = (await tasksResponse.json()).items.filter((task) => task.projectId === project?.id);
  if (!project || !['准备材料', '预约会议'].every((title) => projectTasks.some((task) => task.title.includes(title)))) {
    throw new Error('PROJECT_BULK_MISMATCH');
  }
  recordPhase('project-bulk-confirmed');

  phase = 'clarification';
  if (await projectConversation.isVisible()) {
    await projectConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  }
  await submitHome(page, '请创建一个待办，但我还没有告诉你标题，先问我需要的信息。');
  const clarifyConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(clarifyConversation.getByRole('button', { name: '都不是，补充说明' })).toBeVisible({ timeout: 90_000 });
  await save('clarification-390.png', page);
  await clarifyConversation.getByRole('button', { name: '都不是，补充说明' }).click();
  await clarifyConversation.getByLabel('继续告诉 Agent 的内容').locator('textarea').fill(
    '标题是“本地澄清任务”，优先级中，无项目，不设置时间。请给我确认卡。',
  );
  await clarifyConversation.getByRole('button', { name: '发送给 Agent' }).click();
  await expect(plan).toBeVisible({ timeout: 90_000 });
  await plan.getByRole('button', { name: '创建 1 项' }).click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  const clarifiedTasksResponse = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (!(await clarifiedTasksResponse.json()).items.some((task) => task.title === '本地澄清任务')) {
    throw new Error('CLARIFICATION_FOLLOWUP_MISMATCH');
  }
  recordPhase('clarification-followup-confirmed');

  phase = 'same-name-candidates';
  if (await clarifyConversation.isVisible()) {
    await clarifyConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  }
  const duplicateIds = [];
  for (const data of [
    { title: '本地同名任务', priority: 'MEDIUM', projectId: project.id },
    { title: '本地同名任务', priority: 'MEDIUM' },
  ]) {
    const added = await context.request.post('/api/v1/tasks', {
      data,
      headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    });
    if (added.status() !== 201) throw new Error('CANDIDATE_FIXTURE_FAILED');
    duplicateIds.push((await added.json()).task.id);
  }
  await submitHome(page, '请把“本地同名任务”标记完成，有两项同名待办时先让我选择具体对象。');
  const candidateConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const choices = candidateConversation.getByRole('button', { name: /^选择本地同名任务/ });
  await expect(choices).toHaveCount(2, { timeout: 90_000 });
  await save('candidate-selection-390.png', page);
  await choices.filter({ hasText: '本地验收丙' }).click();
  const candidateCard = await waitForCard(page, 1);
  await candidateCard.getByRole('button', { name: '确认执行' }).click();
  await expect(candidateCard).toContainText('已执行', { timeout: 30_000 });
  const completedResponse = await context.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  const completedIds = new Set((await completedResponse.json()).items.map((task) => task.id));
  if (!completedIds.has(duplicateIds[0]) || completedIds.has(duplicateIds[1])) {
    throw new Error('CANDIDATE_TARGET_MISMATCH');
  }
  recordPhase('same-name-candidate-confirmed');

  phase = 'refresh-recovery';
  await page.reload();
  await expect(page.getByLabel('告诉 Agent', { exact: true })).toBeVisible();
  const afterReload = await context.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  const completedAfterReload = new Set((await afterReload.json()).items.map((task) => task.id));
  if (!completedAfterReload.has(duplicateIds[0]) || completedAfterReload.has(duplicateIds[1])) {
    throw new Error('REFRESH_RECOVERY_MISMATCH');
  }
  recordPhase('refresh-recovery-confirmed');

  phase = 'lost-confirm-response';
  await submitHome(page, '请把“本地澄清任务”的标题改为“本地响应丢失任务”，只改标题，给我确认卡。');
  const lostConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const lostCard = await waitForCard(page, 1);
  await page.route('**/api/v1/action-proposals/*/confirm', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await lostCard.getByRole('button', { name: '确认执行' }).click();
  await expect(lostCard).toContainText('已执行', { timeout: 30_000 });
  await page.unroute('**/api/v1/action-proposals/*/confirm');
  const lostTasks = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if ((await lostTasks.json()).items.filter((task) => task.title === '本地响应丢失任务').length !== 1) {
    throw new Error('LOST_CONFIRM_REPLAY_MISMATCH');
  }
  recordPhase('lost-confirm-response-recovered');

  phase = 'list-refresh-failure';
  await lostConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(page, '请把“本地响应丢失任务”的标题改为“本地刷新失败任务”，只改标题，给我确认卡。');
  const refreshConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const refreshCard = await waitForCard(page, 1);
  let failedRefresh = false;
  await page.route('**/api/v1/tasks?**', async (route) => {
    if (!failedRefresh && route.request().method() === 'GET') {
      failedRefresh = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.continue();
  });
  await refreshCard.getByRole('button', { name: '确认执行' }).click();
  await expect(refreshCard).toContainText('已执行', { timeout: 30_000 });
  await page.unroute('**/api/v1/tasks?**');
  if (!failedRefresh) throw new Error('REFRESH_FAULT_NOT_TRIGGERED');
  recordPhase('list-refresh-failure-recovered');

  phase = 'two-tab-confirm';
  await refreshConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(page, '请把“本地刷新失败任务”的标题改为“本地并发确认任务”，只改标题，给我确认卡。');
  const firstTabCard = await waitForCard(page, 1);
  const secondTab = await context.newPage();
  try {
    await secondTab.goto(origin);
    await secondTab.getByRole('button', { name: /查看确认/ }).click();
    const secondTabCard = await waitForCard(secondTab, 1);
    await Promise.all([
      firstTabCard.getByRole('button', { name: '确认执行' }).click(),
      secondTabCard.getByRole('button', { name: '确认执行' }).click(),
    ]);
    await expect
      .poll(async () => {
        const tasks = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
        return (await tasks.json()).items.filter((task) => task.title === '本地并发确认任务').length;
      }, { timeout: 30_000 })
      .toBe(1);
  } finally {
    await secondTab.close();
  }
  recordPhase('two-tab-confirm-once');

  phase = 'failed-plan';
  const currentConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  if (await currentConversation.isVisible()) {
    await currentConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  }
  const failedPlanSource = await submitHome(
    page,
    '请只用一句文字说明如何准备一次内部培训，并提供生成计划的入口，不要执行任务操作。',
  );
  await expect(currentConversation.getByRole('button', { name: '根据这条回复生成计划' })).toBeVisible({ timeout: 90_000 });
  await currentConversation.getByRole('button', { name: '根据这条回复生成计划' }).click();
  await expect(plan).toBeVisible({ timeout: 120_000 });
  let failedProposal = await latestProposal(context, failedPlanSource.conversationId);
  await plan.getByRole('button', { name: '关闭 Agent 草稿' }).click();
  const editedProject = await context.request.patch(`/api/v1/action-proposals/${failedProposal.id}`, {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { version: failedProposal.version, command: { type: 'SET_PROJECT', project: { type: 'NEW', name: '本地失败计划项目' } } },
  });
  if (editedProject.status() !== 200) throw new Error('FAILED_PLAN_EDIT_FIXTURE');
  const conflictProject = await context.request.post('/api/v1/projects', {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { name: '本地失败计划项目' },
  });
  if (conflictProject.status() !== 201) throw new Error('FAILED_PLAN_CONFLICT_FIXTURE');
  await page.reload();
  await page.getByRole('button', { name: /查看确认/ }).click();
  await expect(plan).toBeVisible();
  const tasksBeforeFailure = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const beforeFailureIds = (await tasksBeforeFailure.json()).items.map((task) => task.id).sort();
  const failedConfirmation = page.waitForResponse(
    (response) => response.url().endsWith(`/api/v1/action-proposals/${failedProposal.id}/confirm`) &&
      response.request().method() === 'POST',
  );
  await plan.getByRole('button', { name: /^创建 \d+ 项$/ }).click();
  const initialFailedReceipt = await (await failedConfirmation).json();
  if (initialFailedReceipt.outcome !== 'FAILED') throw new Error('FAILED_PLAN_RECEIPT_MISMATCH');
  await expect(plan).toContainText('执行失败', { timeout: 30_000 });
  await save('failed-plan-before-regeneration-390.png', page);
  failedProposal = await latestProposal(context, failedPlanSource.conversationId);
  if (failedProposal.status !== 'FAILED') throw new Error('FAILED_PLAN_NOT_TERMINAL');
  const tasksAfterFailure = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (JSON.stringify((await tasksAfterFailure.json()).items.map((task) => task.id).sort()) !== JSON.stringify(beforeFailureIds)) {
    throw new Error('FAILED_PLAN_PARTIAL_WRITE');
  }
  recordPhase('failed-plan-atomic-no-write');

  phase = 'regenerate-close-recover';
  const regeneration = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/agent/plan-generations') && response.request().method() === 'POST',
  );
  await plan.getByRole('button', { name: '重新生成计划' }).click();
  const regenerationResponse = await regeneration;
  const regenerationRequest = await regenerationResponse.json();
  if (regenerationResponse.status() !== 202) {
    throw new Error(`REGENERATION_ADMISSION_${regenerationResponse.status()}_${regenerationRequest.error?.code ?? 'UNKNOWN'}`);
  }
  await expect(currentConversation).toBeVisible();
  await currentConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await expect(plan).toBeHidden();
  await expect
    .poll(async () => {
      const response = await context.request.get(`/api/v1/agent/requests/${regenerationRequest.requestId}`);
      return (await response.json()).status;
    }, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe('SUCCEEDED');
  await expect(plan).toBeHidden();
  await expect(currentConversation).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: /查看确认/ }).click();
  await expect(plan).toBeVisible();
  const replacement = await latestProposal(context, failedPlanSource.conversationId);
  const oldState = await context.request.get(`/api/v1/action-proposals/${failedProposal.id}`);
  if ((await oldState.json()).proposal.status !== 'SUPERSEDED' || replacement.id === failedProposal.id) {
    throw new Error('FAILED_PLAN_NOT_SUPERSEDED');
  }
  const beforeOldReplay = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const beforeOldReplayTasks = (await beforeOldReplay.json()).items;
  const oldConfirm = await context.request.post(`/api/v1/action-proposals/${failedProposal.id}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { version: failedProposal.version },
  });
  if (oldConfirm.status() === 200) {
    const receipt = await oldConfirm.json();
    if (receipt.outcome !== 'FAILED' || receipt.proposal.status !== 'SUPERSEDED' ||
      receipt.execution.id !== initialFailedReceipt.execution.id || receipt.execution.status !== 'FAILED') {
      throw new Error('SUPERSEDED_PLAN_REPLAY_NOT_HISTORICAL_FAILURE');
    }
  } else if (oldConfirm.status() !== 409) {
    throw new Error(`SUPERSEDED_PLAN_REJECT_STATUS_${oldConfirm.status()}`);
  }
  const afterOldReplay = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (JSON.stringify((await afterOldReplay.json()).items) !== JSON.stringify(beforeOldReplayTasks)) {
    throw new Error('SUPERSEDED_PLAN_REPLAY_CHANGED_TASKS');
  }
  phaseResult.supersededConfirmHttpStatus = oldConfirm.status();
  recordPhase('regenerate-close-refresh-recovered');
  await save('regenerated-plan-recovered-390.png', page);
  const planSecondTab = await context.newPage();
  try {
    await planSecondTab.goto(origin);
    await planSecondTab.getByRole('button', { name: /查看确认/ }).click();
    const secondPlan = planSecondTab.getByRole('dialog', { name: '计划草稿' });
    await expect(secondPlan).toBeVisible();
    await Promise.all([
      plan.getByRole('button', { name: /^创建 \d+ 项$/ }).click(),
      secondPlan.getByRole('button', { name: /^创建 \d+ 项$/ }).click(),
    ]);
    await expect(plan).toBeHidden({ timeout: 30_000 });
  } finally {
    await planSecondTab.close();
  }
  const executed = await context.request.get(`/api/v1/action-proposals/${replacement.id}`);
  if ((await executed.json()).proposal.status !== 'EXECUTED') throw new Error('REGENERATED_PLAN_NOT_EXECUTED');
  const inboxAfter = await context.request.get('/api/v1/smart-inbox');
  if ((await inboxAfter.json()).item.kind === 'EXECUTION_FAILED') throw new Error('OLD_FAILURE_REAPPEARED_INBOX');
  const beforeReplay = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const replay = await context.request.post(`/api/v1/action-proposals/${replacement.id}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
    data: { version: replacement.version },
  });
  const afterReplay = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (replay.status() !== 200 || JSON.stringify((await beforeReplay.json()).items) !== JSON.stringify((await afterReplay.json()).items)) {
    throw new Error('REPEATED_CONFIRM_CHANGED_TASKS');
  }
  recordPhase('failed-plan-replaced-confirmed-once');

  phase = 'conversation-project-switch';
  if (await currentConversation.isVisible()) {
    await currentConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  }
  const projectFilter = page.getByRole('group', { name: '项目筛选' });
  await projectFilter.getByRole('button', { name: '本地验收丙', exact: true }).click();
  await expect(projectFilter.getByRole('button', { name: '本地验收丙', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '历史聊天记录', exact: true }).click();
  const history = page.getByRole('dialog', { name: '历史聊天记录', exact: true });
  await history.getByRole('button', { name: /^打开会话：请创建一个无项目待办，标题为“本地验收甲”/ }).click();
  await expect(currentConversation).toContainText('本地验收甲');
  await expect(currentConversation.getByLabel('Agent 操作确认卡').first()).toContainText('已执行');
  await currentConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await projectFilter.getByRole('button', { name: '全部', exact: true }).click();
  recordPhase('conversation-project-switch-recovered');
  await save('final-home-390.png', page);

  phase = 'audit';
  await Promise.all(admissionObservations);
  const identity = await database.client.userIdentity.findUniqueOrThrow({
    where: { type_identifierNormalized: { type: 'USERNAME', identifierNormalized: account } },
  });
  const runs = await database.client.agentRequestRun.findMany({
    where: { userId: identity.userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, status: true, resultType: true, model: true, promptVersion: true, repairAttempts: true,
      reservation: { select: { status: true, pointsDelta: true } },
    },
  });
  const debits = await database.client.aiPointTransaction.findMany({
    where: { userId: identity.userId, type: 'DEBIT' },
    select: { status: true, pointsDelta: true },
  });
  const matchingTasks = await database.client.task.findMany({
    where: { userId: identity.userId, deletedAt: null },
    select: { title: true, priority: true, status: true },
  });
  const finalBystander = await context.request.get(`/api/v1/tasks/${bystander.id}`);
  if (JSON.stringify((await finalBystander.json()).task) !== JSON.stringify(bystanderSnapshot)) {
    throw new Error('UNRELATED_TASK_CHANGED');
  }
  const historicalFailure = await database.client.actionExecution.findFirst({
    where: { userId: identity.userId, proposalId: failedProposal.id },
    select: { status: true, errorCode: true },
  });
  phaseResult.auditSummary = {
    runCount: runs.length, observedAdmissionCount: observedAdmissions.size, debitCount: debits.length,
    allRunsSucceeded: runs.every((run) => run.status === 'SUCCEEDED'),
    allRunsObserved: runs.every((run) => observedAdmissions.has(run.id)),
    flashOnly: runs.every((run) => !run.model || run.model === 'deepseek-v4-flash'),
    currentRuntimeOnly: runs.every((run) => !run.model || run.promptVersion === 'pydantic-agent-v6'),
    allDebitsSucceeded: debits.every((debit) => debit.status === 'SUCCEEDED'),
    historicalFailureRetained: historicalFailure?.status === 'FAILED',
  };
  if (
    runs.length !== observedAdmissions.size ||
    runs.some((run) => !observedAdmissions.has(run.id)) ||
    runs.some((run) => run.status !== 'SUCCEEDED' || (run.model && run.model !== 'deepseek-v4-flash')) ||
    runs.some((run) => run.model && run.reservation?.status !== 'SUCCEEDED') ||
    runs.some((run) => run.model && run.promptVersion !== 'pydantic-agent-v6') ||
    debits.length !== runs.filter((run) => run.model === 'deepseek-v4-flash').length ||
    debits.some((debit) => debit.status !== 'SUCCEEDED') ||
    !matchingTasks.some((task) => task.title === '本地验收评审准备') ||
    historicalFailure?.status !== 'FAILED'
  ) {
    throw new Error('AUDIT_MISMATCH');
  }
  phaseResult.runs = runs.map(({ id: _id, ...run }) => run);
  phaseResult.observedAdmissionCount = observedAdmissions.size;
  phaseResult.debits = debits;
  phaseResult.taskCount = matchingTasks.length;
  phaseResult.unrelatedTaskUnchanged = true;
  phaseResult.historicalFailureRetained = historicalFailure;
  phaseResult.status = 'passed';
  console.log(JSON.stringify({ status: phaseResult.status, phases: phaseResult.phases, output }));
  await context.close();
} catch (error) {
  phaseResult.status = 'failed';
  phaseResult.failedPhase = phase;
  phaseResult.failureClass = error?.constructor?.name ?? 'Unknown';
  phaseResult.failureDetail = String(error?.message ?? '').slice(0, 180);
  const lastPage = browser?.contexts()[0]?.pages()[0];
  if (lastPage) await save('failed-phase-390.png', lastPage).catch(() => undefined);
  console.error(JSON.stringify({ status: 'failed', phase, failureClass: phaseResult.failureClass, detail: phaseResult.failureDetail }));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'current-10087-result.json'), JSON.stringify(phaseResult, null, 2));
  await browser?.close();
  await database.onApplicationShutdown();
}
