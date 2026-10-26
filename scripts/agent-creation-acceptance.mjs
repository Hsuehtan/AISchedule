import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { DatabaseService } from '../apps/server/dist/platform/database/database.service.js';

const origin = process.env.AGENT_ACCEPTANCE_ORIGIN ?? 'http://127.0.0.1:10087';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('LOOPBACK_REQUIRED');
const account = `creation_accept_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const output = resolve(`docs/quality/agent-creation-plan/${account}`);
await mkdir(output, { recursive: true });
const local = parseEnv(await readFile('.env', 'utf8'));
const database = new DatabaseService(local.DATABASE_URL);
const result = { status: 'running', account, cases: [] };
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ baseURL: origin, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const headers = () => ({ Origin: origin, 'Idempotency-Key': randomUUID() });
const plan = page.getByRole('dialog', { name: '计划草稿' });
const tasks = async () => {
  const response = await context.request.get('/api/v1/tasks?status=TODO&limit=100');
  if (response.status() !== 200) throw new Error('TASK_READ_FAILED');
  return (await response.json()).items;
};
async function submit(text) {
  await page.goto(origin);
  await page.getByLabel('告诉 Agent', { exact: true }).locator('textarea').fill(text);
  const pending = page.waitForResponse((r) => r.url().endsWith('/api/v1/agent/turns') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '发送给 Agent' }).click();
  const admission = await pending;
  if (admission.status() !== 202) throw new Error('ADMISSION_FAILED');
  const queued = await admission.json();
  let run;
  await expect.poll(async () => {
    const response = await context.request.get(`/api/v1/agent/requests/${queued.requestId}`);
    run = await response.json();
    return run.status;
  }, { timeout: 90_000, intervals: [500, 1000] }).toBe('SUCCEEDED');
  return run.result.proposal;
}
async function creation(name, text, count, projectName = null) {
  const before = await tasks();
  const proposal = await submit(text);
  if (proposal.presentation !== 'PLAN') throw new Error('CREATION_NOT_PLAN');
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Agent 操作确认卡')).toHaveCount(0);
  if (JSON.stringify(await tasks()) !== JSON.stringify(before)) throw new Error('WRITE_BEFORE_CONFIRM');
  const confirm = plan.getByRole('button', { name: `创建 ${count} 项` });
  await expect(confirm).toBeVisible();
  if (name === 'jeju-six') {
    for (const width of [320, 390, 480]) {
      await page.setViewportSize({ width, height: 844 });
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport();
      await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await plan.getByRole('button', { name: '关闭 Agent 草稿' }).click();
    await page.reload();
    await page.getByRole('button', { name: /查看确认/ }).click();
    await expect(plan).toBeVisible();
    await expect(page.getByLabel('Agent 操作确认卡')).toHaveCount(0);
  }
  await confirm.click();
  await expect(plan).toBeHidden({ timeout: 30_000 });
  const after = await tasks();
  if (after.length !== before.length + count) throw new Error('CREATE_COUNT_MISMATCH');
  const added = after.filter((row) => !before.some((prior) => prior.id === row.id));
  if (projectName && added.some((row) => row.project?.name !== projectName)) throw new Error('PROJECT_MISMATCH');
  const replay = await context.request.post(`/api/v1/action-proposals/${proposal.id}/confirm`, { headers: headers(), data: { version: proposal.version } });
  const receipt = await replay.json();
  if (replay.status() !== 200 || receipt.proposal.presentation !== 'PLAN' || JSON.stringify(await tasks()) !== JSON.stringify(after)) throw new Error('REPLAY_MISMATCH');
  result.cases.push({ name, status: 'passed', presentation: proposal.presentation, tasksCreated: count, confirmedOnce: true, replayPresentation: receipt.proposal.presentation });
  console.log(JSON.stringify({ case: name, status: 'passed' }));
}
try {
  const registered = await context.request.post('/api/v1/auth/username/register', { headers: { Origin: origin }, data: { username: account, password: `Synthetic_${randomUUID()}9!` } });
  if (registered.status() !== 201) throw new Error('REGISTER_FAILED');
  await creation('single-none', '请新建一个无项目待办，标题“创建分类单项”，优先级中，不设置时间，生成草稿。', 1);
  await creation('jeju-six', '我要去济州岛旅游，请帮我规划六天行程，拆成6个待办，每天一项。', 6);
  const project = await context.request.post('/api/v1/projects', { headers: headers(), data: { name: '已有合成旅行' } });
  if (project.status() !== 201) throw new Error('PROJECT_FIXTURE_FAILED');
  await creation('existing-project', '请在已有项目“已有合成旅行”下新建3个待办：“订机票”“订酒店”“准备行李”，只生成这3项创建草稿。', 3, '已有合成旅行');
  const beforeUpdate = await tasks();
  const update = await submit('请把“创建分类单项”的优先级改成高，只修改优先级，不新建任务。');
  if (update.presentation !== 'ACTION') throw new Error('UPDATE_NOT_ACTION');
  await expect(plan).toBeHidden();
  const card = page.getByLabel('Agent 操作确认卡').last();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: '确认执行' }).click();
  await expect(card).toContainText('已执行', { timeout: 30_000 });
  const afterUpdate = await tasks();
  if (afterUpdate.length !== beforeUpdate.length || afterUpdate.find((row) => row.title === '创建分类单项')?.priority !== 'HIGH') throw new Error('UPDATE_FIELDS_MISMATCH');
  result.cases.push({ name: 'update-action', status: 'passed', presentation: 'ACTION' });
  await page.screenshot({ path: resolve(output, 'update-action-390.png') });
  const identity = await database.client.userIdentity.findUniqueOrThrow({ where: { type_identifierNormalized: { type: 'USERNAME', identifierNormalized: account } } });
  const runs = await database.client.agentRequestRun.findMany({ where: { userId: identity.userId }, select: { status: true, resultType: true, model: true, promptVersion: true, reservation: { select: { status: true, pointsDelta: true } } } });
  const debits = await database.client.aiPointTransaction.findMany({ where: { userId: identity.userId, type: 'DEBIT' }, select: { status: true, pointsDelta: true } });
  if (runs.length !== 4 || debits.length !== 4 || runs.some((run) => run.status !== 'SUCCEEDED' || run.model !== 'deepseek-v4-flash' || run.promptVersion !== 'pydantic-agent-v6' || run.reservation?.status !== 'SUCCEEDED') || debits.some((debit) => debit.status !== 'SUCCEEDED')) throw new Error('RUN_BILLING_AUDIT_FAILED');
  result.runs = runs;
  result.audit = { runCount: runs.length, debitCount: debits.length, pointsCharged: -debits.reduce((sum, row) => sum + row.pointsDelta, 0), taskCount: afterUpdate.length };
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.failure = error.constructor.name;
  result.failureDetail = String(error.message).slice(0, 160);
  await page.screenshot({ path: resolve(output, 'failed.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, cases: result.cases.length, output }));
  await browser.close();
  await database.onApplicationShutdown();
}
