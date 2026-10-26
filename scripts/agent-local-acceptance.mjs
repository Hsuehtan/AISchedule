import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { chromium, expect } from '@playwright/test';

import { DatabaseService } from '../apps/server/dist/platform/database/database.service.js';

const origin = process.env.AGENT_ACCEPTANCE_ORIGIN ?? 'http://127.0.0.1:10087';
const output = resolve('docs/quality/agent-pydantic-acceptance');
const local = parseEnv(await readFile('.env', 'utf8'));
const database = new DatabaseService(local.DATABASE_URL);
const account = `pydantic_accept_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const phaseResult = { status: 'running', account, phases: [], runs: [], debits: [] };
let phase = 'startup';
let browser;

const save = async (name, page) => {
  await page.screenshot({ path: resolve(output, name), animations: 'disabled' });
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
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  phase = 'register';
  const registered = await context.request.post('/api/v1/auth/username/register', {
    data: { username: account, password: `local-only-${randomUUID()}` },
    headers: { Origin: origin },
  });
  if (registered.status() !== 201) throw new Error('REGISTER_FAILED');
  await page.goto(origin);
  await expect(page.getByLabel('告诉 Agent', { exact: true })).toBeVisible();
  phaseResult.phases.push('page-ready');

  phase = 'create-task';
  const first = await submitHome(
    page,
    '请创建一个无项目待办，标题为“本地验收甲”，优先级中，不设置时间。请给我确认卡。',
  );
  const firstCard = await waitForCard(page, 1);
  await save('action-before-confirm-390.png', page);
  const before = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if ((await before.json()).items.some((task) => task.title === '本地验收甲')) {
    throw new Error('WRITE_BEFORE_CONFIRM');
  }
  await firstCard.getByRole('button', { name: '确认执行' }).click();
  await expect(firstCard).toContainText('已执行', { timeout: 30_000 });
  const after = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const created = (await after.json()).items.find((task) => task.title === '本地验收甲');
  if (!created || created.priority !== 'MEDIUM') throw new Error('CREATE_FIELDS_MISMATCH');
  phaseResult.phases.push('create-confirmed');

  phase = 'referential-update';
  const conversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await conversation
    .getByLabel('继续告诉 Agent 的内容')
    .locator('textarea')
    .fill('把它改成高优先级，其他字段不变，请给我确认卡。');
  await conversation.getByRole('button', { name: '发送给 Agent' }).click();
  const secondCard = await waitForCard(page, 2);
  await secondCard.getByRole('button', { name: '确认执行' }).click();
  await expect(secondCard).toContainText('已执行', { timeout: 30_000 });
  const updated = await context.request.get(`/api/v1/tasks/${created.id}`);
  const updatedTask = (await updated.json()).task;
  if (updatedTask.priority !== 'HIGH' || updatedTask.title !== '本地验收甲') {
    throw new Error('UPDATE_FIELDS_MISMATCH');
  }
  await save('action-after-confirm-390.png', page);
  phaseResult.phases.push('referential-update-confirmed');

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
  await generate.click();
  const plan = page.getByRole('dialog', { name: '计划草稿' });
  await expect(plan).toBeVisible({ timeout: 120_000 });
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(plan).toBeInViewport();
    await save(`plan-before-confirm-${width}.png`, page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const edit = plan.getByRole('button', { name: /^编辑/ }).first();
  await edit.click();
  const editor = page.getByRole('dialog', { name: '编辑草稿' });
  await editor.getByLabel('计划项标题').locator('input').fill('本地验收评审准备');
  await editor.getByRole('button', { name: '保存此项' }).click();
  await expect(plan.getByRole('button', { name: '编辑本地验收评审准备' })).toBeVisible();
  const createPlan = plan.getByRole('button', { name: /^创建 \d+ 项$/ });
  await createPlan.click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  phaseResult.phases.push('plan-edited-confirmed');

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
  phaseResult.phases.push('complete-confirmed');

  const followup = actionConversation.getByLabel('继续告诉 Agent 的内容').locator('textarea');
  await followup.fill('把刚完成的“本地验收甲”恢复为待完成，给我确认卡。');
  await actionConversation.getByRole('button', { name: '发送给 Agent' }).click();
  const restoreCard = await waitForCard(page, 2);
  await restoreCard.getByRole('button', { name: '确认执行' }).click();
  await expect(restoreCard).toContainText('已执行', { timeout: 30_000 });
  phase = 'restore-verify';
  changed = await context.request.get(`/api/v1/tasks/${created.id}`);
  if ((await changed.json()).task?.status !== 'TODO') throw new Error('RESTORE_MISMATCH');
  phaseResult.phases.push('restore-confirmed');

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
  phaseResult.phases.push('delete-and-undo-confirmed');

  phase = 'organize';
  await actionConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  const unorganizedBefore = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const beforeRows = new Map((await unorganizedBefore.json()).items.map((task) => [task.id, task]));
  const organizeEntry = page.getByRole('button', { name: /一键整理：发现/ });
  await expect(organizeEntry).toBeVisible({ timeout: 30_000 });
  await organizeEntry.click();
  const organizeConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const organizeCard = await waitForCard(page, 1);
  await save('organize-before-confirm-390.png', page);
  const removeSuggestion = organizeConversation.getByRole('button', { name: /移除建议/ });
  if ((await removeSuggestion.count()) > 1) {
    await removeSuggestion.first().click();
    phaseResult.phases.push('organize-item-removed');
  }
  await organizeCard.getByRole('button', { name: '确认执行' }).click();
  await expect(organizeCard).toContainText('已执行', { timeout: 30_000 });
  const unorganizedAfter = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const afterRows = (await unorganizedAfter.json()).items;
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
  phaseResult.phases.push('organize-multifield-confirmed');

  phase = 'project-bulk';
  await organizeConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(
    page,
    '请创建名为“本地验收丙”的新项目，并添加“准备材料”和“预约会议”两个待办，给我确认卡。',
  );
  const projectConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  const projectCard = await waitForCard(page, 1);
  await projectCard.getByRole('button', { name: '确认执行' }).click();
  await expect(projectCard).toContainText('已执行', { timeout: 30_000 });
  const projectsResponse = await context.request.get('/api/v1/projects?status=ACTIVE&limit=100');
  const project = (await projectsResponse.json()).items.find((item) => item.name === '本地验收丙');
  const tasksResponse = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  const projectTasks = (await tasksResponse.json()).items.filter((task) => task.projectId === project?.id);
  if (!project || !['准备材料', '预约会议'].every((title) => projectTasks.some((task) => task.title.includes(title)))) {
    throw new Error('PROJECT_BULK_MISMATCH');
  }
  phaseResult.phases.push('project-bulk-confirmed');

  phase = 'clarification';
  await projectConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(page, '请创建一个待办，但我还没有告诉你标题，先问我需要的信息。');
  const clarifyConversation = page.getByRole('dialog', { name: 'Agent 对话' });
  await expect(clarifyConversation.getByRole('button', { name: '都不是，补充说明' })).toBeVisible({ timeout: 90_000 });
  await clarifyConversation.getByRole('button', { name: '都不是，补充说明' }).click();
  await clarifyConversation.getByLabel('继续告诉 Agent 的内容').locator('textarea').fill(
    '标题是“本地澄清任务”，优先级中，无项目，不设置时间。请给我确认卡。',
  );
  await clarifyConversation.getByRole('button', { name: '发送给 Agent' }).click();
  const clarifyCard = await waitForCard(page, 1);
  await clarifyCard.getByRole('button', { name: '确认执行' }).click();
  await expect(clarifyCard).toContainText('已执行', { timeout: 30_000 });
  const clarifiedTasksResponse = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (!(await clarifiedTasksResponse.json()).items.some((task) => task.title === '本地澄清任务')) {
    throw new Error('CLARIFICATION_FOLLOWUP_MISMATCH');
  }
  phaseResult.phases.push('clarification-followup-confirmed');

  phase = 'same-name-candidates';
  await clarifyConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
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
  await choices.first().click();
  const candidateCard = await waitForCard(page, 1);
  await candidateCard.getByRole('button', { name: '确认执行' }).click();
  await expect(candidateCard).toContainText('已执行', { timeout: 30_000 });
  const completedResponse = await context.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  const completedIds = new Set((await completedResponse.json()).items.map((task) => task.id));
  if (duplicateIds.filter((id) => completedIds.has(id)).length !== 1) {
    throw new Error('CANDIDATE_TARGET_MISMATCH');
  }
  phaseResult.phases.push('same-name-candidate-confirmed');

  phase = 'refresh-recovery';
  await page.reload();
  await expect(page.getByLabel('告诉 Agent', { exact: true })).toBeVisible();
  const afterReload = await context.request.get('/api/v1/tasks?status=COMPLETED&limit=100');
  const completedAfterReload = new Set((await afterReload.json()).items.map((task) => task.id));
  if (duplicateIds.filter((id) => completedAfterReload.has(id)).length !== 1) {
    throw new Error('REFRESH_RECOVERY_MISMATCH');
  }
  phaseResult.phases.push('refresh-recovery-confirmed');

  phase = 'lost-confirm-response';
  await submitHome(page, '请创建一个无项目待办，标题为“本地响应丢失任务”，给我确认卡。');
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
  phaseResult.phases.push('lost-confirm-response-recovered');

  phase = 'list-refresh-failure';
  await lostConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(page, '请创建一个无项目待办，标题为“本地刷新失败任务”，给我确认卡。');
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
  phaseResult.phases.push('list-refresh-failure-recovered');

  phase = 'two-tab-confirm';
  await refreshConversation.getByRole('button', { name: '关闭Agent 对话' }).click();
  await submitHome(page, '请创建一个无项目待办，标题为“本地并发确认任务”，给我确认卡。');
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
  phaseResult.phases.push('two-tab-confirm-once');

  phase = 'audit';
  const identity = await database.client.userIdentity.findUniqueOrThrow({
    where: { type_identifierNormalized: { type: 'USERNAME', identifierNormalized: account } },
  });
  const runs = await database.client.agentRequestRun.findMany({
    where: { userId: identity.userId },
    orderBy: { createdAt: 'asc' },
    select: { status: true, resultType: true, model: true, repairAttempts: true },
  });
  const debits = await database.client.aiPointTransaction.findMany({
    where: { userId: identity.userId, type: 'DEBIT' },
    select: { status: true, pointsDelta: true },
  });
  const matchingTasks = await database.client.task.findMany({
    where: { userId: identity.userId, deletedAt: null },
    select: { title: true, priority: true, status: true },
  });
  if (
    runs.length < 16 ||
    runs.some((run) => run.status !== 'SUCCEEDED' || (run.model && run.model !== 'deepseek-v4-flash')) ||
    debits.length !== runs.filter((run) => run.model === 'deepseek-v4-flash').length ||
    debits.some((debit) => debit.status !== 'SUCCEEDED') ||
    !matchingTasks.some((task) => task.title === '本地验收评审准备')
  ) {
    throw new Error('AUDIT_MISMATCH');
  }
  phaseResult.runs = runs;
  phaseResult.debits = debits;
  phaseResult.taskCount = matchingTasks.length;
  phaseResult.status = 'passed';
  console.log(JSON.stringify({ status: phaseResult.status, phases: phaseResult.phases }));
  await context.close();
} catch (error) {
  phaseResult.status = 'failed';
  phaseResult.failedPhase = phase;
  phaseResult.failureClass = error?.constructor?.name ?? 'Unknown';
  phaseResult.failureDetail = String(error?.message ?? '').slice(0, 180);
  console.error(JSON.stringify({ status: 'failed', phase, failureClass: phaseResult.failureClass, detail: phaseResult.failureDetail }));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'current-10087-result.json'), JSON.stringify(phaseResult, null, 2));
  await browser?.close();
  await database.onApplicationShutdown();
}
