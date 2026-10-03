import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { useSyntheticAccount } from './synthetic-account';

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;

type ProjectListBody = {
  items: Array<{ id: string; name: string }>;
};

type TaskMutationBody = {
  task: {
    id: string;
    priority: string;
    project: { id: string; name: string } | null;
    title: string;
    version: number;
  };
};

function shanghaiTomorrowAt(hour: number, minute: number): { input: string; iso: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const instant = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + 1,
      hour - 8,
      minute,
    ),
  );
  const tomorrow = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return {
    input: `${tomorrow.year}-${tomorrow.month}-${tomorrow.day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    iso: instant.toISOString(),
  };
}

async function fillTaroField(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label).locator('input, textarea').first().fill(value);
}

async function readPickerValue(page: Page, fieldName: DateTimeFieldName): Promise<number[] | null> {
  return page.locator(`.dateTimePickerControl_${fieldName}`).evaluate((element) => {
    const value = Reflect.get(element, 'value') as unknown;
    if (!Array.isArray(value)) return null;
    const indexes: number[] = [];
    for (const item of value) {
      if (typeof item !== 'number') return null;
      indexes.push(item);
    }
    return indexes;
  });
}

type DateTimeFieldName = 'deadlineAt' | 'reminderAt' | 'scheduledAt';

const dateTimeLabels: Record<DateTimeFieldName, string> = {
  deadlineAt: '截止时间',
  reminderAt: '提醒时间',
  scheduledAt: '计划时间',
};

function dateTimePickerIndexes(value: string): number[] {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid local date time in E2E fixture: ${value}`);
  return [
    Number(match[1]) - 1970,
    Number(match[2]) - 1,
    Number(match[3]) - 1,
    Number(match[4]),
    Number(match[5]),
  ];
}

async function openDateTimePicker(page: Page, fieldName: DateTimeFieldName) {
  const label = dateTimeLabels[fieldName];
  const trigger = page.getByRole('button', { name: new RegExp(`^${label}，`) });
  await trigger.click();
  const confirmAction = page.locator('.weui-picker__action:visible').filter({ hasText: '确定' });
  await expect(confirmAction).toBeVisible();
  const pickerPanel = confirmAction.locator('xpath=../..');
  return {
    confirmAction,
    label,
    pickerPanel,
    picker: page.locator(`.dateTimePickerControl_${fieldName}`),
    trigger,
  };
}

async function cancelDateTimePicker(page: Page, fieldName: DateTimeFieldName): Promise<void> {
  const { pickerPanel, trigger } = await openDateTimePicker(page, fieldName);
  await pickerPanel.locator('.weui-picker__action').filter({ hasText: '取消' }).click();
  await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
  await expect(trigger).toBeFocused({ timeout: 1_000 });
}

async function selectNextPickerRow(pickerPanel: Locator, column: number): Promise<void> {
  const pickerGroup = pickerPanel.locator('taro-picker-group').nth(column);
  const bounds = await pickerGroup.boundingBox();
  if (!bounds) throw new Error(`Picker column ${column} has no visible bounds`);
  await pickerGroup.click({
    position: { x: bounds.width / 2, y: bounds.height / 2 + 34 },
  });
}

async function selectDateTime(
  page: Page,
  fieldName: DateTimeFieldName,
  value: string,
): Promise<void> {
  const indexes = dateTimePickerIndexes(value);
  const instant = new Date(`${value.replace(' ', 'T')}:00+08:00`);
  await page.clock.setFixedTime(instant);
  try {
    const { confirmAction, label, trigger } = await openDateTimePicker(page, fieldName);
    await expect.poll(() => readPickerValue(page, fieldName)).toEqual(indexes);
    await confirmAction.click();
    await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
    await expect(trigger).toHaveAttribute(
      'aria-label',
      `${label}，当前为 ${value}，打开日期时间选择器`,
    );
    await expect(trigger).toBeFocused({ timeout: 1_000 });
  } finally {
    await page.clock.setFixedTime(new Date());
  }
}

test.use({ viewport: { width: 390, height: 844 } });

test('H2 真实手工闭环可由浏览器完整接管', async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = 'manual-loop';
  const username = 'e2e_manual_loop';
  const password = 'valid-password';
  const assignedSchedule = shanghaiTomorrowAt(9, 30);
  const assignedDeadline = shanghaiTomorrowAt(20, 0);
  const assignedReminder = shanghaiTomorrowAt(9, 25);
  const manualSchedule = shanghaiTomorrowAt(10, 0);
  const manualDeadline = shanghaiTomorrowAt(20, 0);
  const manualReminder = shanghaiTomorrowAt(9, 55);
  const projectName = '工作';
  const renamedProject = '事业';
  const assignedTitle = '项目待办';
  const manualTitle = '手工待办';
  const browserProblems: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserProblems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    browserProblems.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    ),
  );
  const fillField = (label: string, value: string) => fillTaroField(page, label, value);

  await page.goto('/');
  await expect(page.getByText('欢迎回来')).toBeVisible();
  await page.getByRole('button', { name: '注册新账号' }).click();
  await expect(page.getByText('创建账号', { exact: true })).toBeVisible();
  await fillField('用户名', username);
  await fillField('密码', password);
  await fillField('手机号（选填）', '13800138000');
  await page.getByRole('button', { name: '注册并登录' }).click();

  await expect(page.getByText('今天已经清空')).toBeVisible();
  await expect(page.getByText('这个范围暂无待办')).toBeVisible();

  await page.getByRole('button', { name: '管理项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toBeVisible();
  await page.getByRole('button', { name: '新建项目' }).click();
  await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible();
  await fillField('项目名称', projectName);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toContainText(projectName);

  await page.getByRole('button', { name: '新建项目' }).click();
  await fillField('项目名称', projectName);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByText('已有同名的活跃项目')).toBeVisible();
  await expect(page.getByLabel('项目名称').locator('input').first()).toHaveValue(projectName);
  const expectedConflictLog = browserProblems.findIndex((problem) => problem.includes('409'));
  if (expectedConflictLog >= 0) browserProblems.splice(expectedConflictLog, 1);
  await page.getByRole('button', { name: '取消项目编辑' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toContainText(projectName);
  await page.getByRole('button', { name: '完成项目管理' }).click();

  const projectList = await page.request.get('/api/v1/projects?status=ACTIVE&limit=100');
  expect(projectList.status()).toBe(200);
  const projects = (await projectList.json()) as unknown as ProjectListBody;
  const project = projects.items.find((item) => item.name === projectName);
  expect(project).toBeDefined();

  const assignedCreate = await page.request.post('/api/v1/tasks', {
    data: {
      projectId: project?.id,
      title: assignedTitle,
      priority: 'HIGH',
      scheduledAt: assignedSchedule.iso,
      deadlineAt: assignedDeadline.iso,
      reminderAt: assignedReminder.iso,
    },
    headers: {
      Origin: origin,
      'Idempotency-Key': `e2e-assigned-${suffix}`,
    },
  });
  expect(assignedCreate.status()).toBe(201);
  const assignedBody = (await assignedCreate.json()) as unknown as TaskMutationBody;
  expect(assignedBody.task).toMatchObject({
    priority: 'HIGH',
    project: { id: project?.id, name: projectName },
  });

  await page.reload();
  await expect(page.getByText(assignedTitle, { exact: true })).toBeVisible();
  const assignedRow = page.locator('.ei-task-row', { hasText: assignedTitle });
  await expect(assignedRow).toContainText(projectName);
  await expect(assignedRow.getByRole('img', { name: '高优先级' })).toBeVisible();

  let formTaskWriteCount = 0;
  page.on('request', (request) => {
    if (
      request.url().includes('/api/v1/tasks') &&
      (request.method() === 'POST' || request.method() === 'PATCH')
    ) {
      formTaskWriteCount += 1;
    }
  });

  await page.getByRole('button', { name: '新增待办' }).click();
  await expect(page.getByRole('dialog', { name: '新建待办' })).toBeVisible();
  await fillField('待办标题', manualTitle);

  const pickerPreview = await openDateTimePicker(page, 'scheduledAt');
  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/h2-datetime-picker-390x844.png',
  });
  await pickerPreview.pickerPanel
    .locator('.weui-picker__action')
    .filter({ hasText: '取消' })
    .click();
  await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
  await expect(pickerPreview.trigger).toBeFocused({ timeout: 1_000 });
  for (const fieldName of ['deadlineAt', 'reminderAt'] as const) {
    await cancelDateTimePicker(page, fieldName);
  }

  await selectDateTime(page, 'scheduledAt', '2024-01-31 00:00');
  const leapMonthPicker = await openDateTimePicker(page, 'scheduledAt');
  await selectNextPickerRow(leapMonthPicker.pickerPanel, 1);
  await expect.poll(() => readPickerValue(page, 'scheduledAt')).toEqual([54, 1, 28, 0, 0]);
  await expect(
    leapMonthPicker.pickerPanel.locator('taro-picker-group').nth(2).locator('.weui-picker__item'),
  ).toHaveCount(29);
  await leapMonthPicker.confirmAction.click();
  await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
  await expect(leapMonthPicker.trigger).toHaveAttribute(
    'aria-label',
    '计划时间，当前为 2024-02-29 00:00，打开日期时间选择器',
  );

  const commonYearPicker = await openDateTimePicker(page, 'scheduledAt');
  await selectNextPickerRow(commonYearPicker.pickerPanel, 0);
  await expect.poll(() => readPickerValue(page, 'scheduledAt')).toEqual([55, 1, 27, 0, 0]);
  await expect(
    commonYearPicker.pickerPanel.locator('taro-picker-group').nth(2).locator('.weui-picker__item'),
  ).toHaveCount(28);
  await commonYearPicker.confirmAction.click();
  await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
  await expect(commonYearPicker.trigger).toHaveAttribute(
    'aria-label',
    '计划时间，当前为 2025-02-28 00:00，打开日期时间选择器',
  );
  await page.getByRole('button', { name: '清除计划时间' }).click();

  for (const [fieldName, value] of [
    ['scheduledAt', manualSchedule.input],
    ['deadlineAt', manualDeadline.input],
    ['reminderAt', manualReminder.input],
  ] as const) {
    await selectDateTime(page, fieldName, value);
  }
  expect(formTaskWriteCount, '选择日期时间不应提前写入 API').toBe(0);

  const createRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/v1/tasks') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: '保存待办' }).click();
  const createRequest = await createRequestPromise;
  expect(createRequest.postDataJSON()).toMatchObject({
    deadlineAt: manualDeadline.iso,
    reminderAt: manualReminder.iso,
    scheduledAt: manualSchedule.iso,
  });
  expect(formTaskWriteCount, '创建只应产生一次任务写请求').toBe(1);
  await expect(page.getByText(manualTitle, { exact: true })).toBeVisible();

  const manualRow = page.locator('.ei-task-row', { hasText: manualTitle });
  await expect(manualRow).toContainText('未归属');
  await expect(manualRow.getByRole('img', { name: '中优先级' })).toBeVisible();
  await expect(manualRow).toContainText('明天20:00截止');
  await expect(manualRow).toContainText('明天09:55提醒');

  await page.getByText(manualTitle, { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toBeVisible();
  for (const [fieldName, value] of [
    ['scheduledAt', manualSchedule.input],
    ['deadlineAt', manualDeadline.input],
    ['reminderAt', manualReminder.input],
  ] as const) {
    const opened = await openDateTimePicker(page, fieldName);
    await expect.poll(() => readPickerValue(page, fieldName)).toEqual(dateTimePickerIndexes(value));
    await opened.pickerPanel.locator('.weui-picker__action').filter({ hasText: '取消' }).click();
    await expect(page.locator('.weui-picker__action:visible')).toHaveCount(0);
    await expect(opened.trigger).toBeFocused({ timeout: 1_000 });
    const clearButton = page.getByRole('button', { name: `清除${dateTimeLabels[fieldName]}` });
    const clearBounds = await clearButton.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    });
    expect(clearBounds.height).toBeGreaterThanOrEqual(44);
    expect(clearBounds.width).toBeGreaterThanOrEqual(44);
    await clearButton.click();
    await expect(
      page.getByRole('button', {
        name: `${dateTimeLabels[fieldName]}，未设置，打开日期时间选择器`,
      }),
    ).toBeVisible();
  }
  expect(formTaskWriteCount, '清空日期时间不应提前写入 API').toBe(1);

  const updateRequestPromise = page.waitForRequest(
    (request) => request.url().includes('/api/v1/tasks/') && request.method() === 'PATCH',
  );
  await page.getByRole('button', { name: '保存待办' }).click();
  const updateRequest = await updateRequestPromise;
  expect(updateRequest.postDataJSON()).toMatchObject({
    changes: { deadlineAt: null, reminderAt: null, scheduledAt: null },
  });
  expect(formTaskWriteCount, '清空保存只应再产生一次任务写请求').toBe(2);
  await expect(page.locator('.ei-task-row', { hasText: manualTitle })).toContainText(
    '无截止时间 · 无提醒',
  );
  await expect(page.locator('.ei-task-row', { hasText: manualTitle })).toContainText('待定');

  await page.getByRole('button', { name: projectName, exact: true }).click();
  await expect(page.getByText(assignedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(manualTitle, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增待办' }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: projectName, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(manualTitle, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `完成待办：${assignedTitle}` }).click();
  await expect(page.getByText('已完成 1 项')).toBeVisible();
  await page.getByRole('button', { name: /已完成 1 项/ }).click();
  await expect(page.getByRole('button', { name: `恢复待办：${assignedTitle}` })).toBeVisible();
  await page.getByRole('button', { name: `恢复待办：${assignedTitle}` }).click();
  await expect(page.getByRole('button', { name: `完成待办：${assignedTitle}` })).toBeVisible();

  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByText(manualTitle, { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toBeVisible();
  await page.getByRole('button', { name: `删除待办：${manualTitle}` }).click();
  const undoStatus = page.getByRole('status');
  await expect(undoStatus).toContainText(`已删除“${manualTitle}”`);
  await page.getByRole('button', { name: `撤销：已删除“${manualTitle}”` }).click();
  await expect(page.getByText(manualTitle, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新增待办' }).click();
  await expect(page.getByRole('dialog', { name: '新建待办' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '新建待办' })).toHaveCount(0);
  await expect(page.getByText(manualTitle, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '管理项目' }).click();
  await page.getByRole('button', { name: `改名项目：${projectName}` }).click();
  await fillField('项目名称', renamedProject);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toContainText(renamedProject);
  await page.getByRole('button', { name: `归档项目：${renamedProject}` }).click();
  await expect(page.getByRole('dialog', { name: `归档“${renamedProject}”？` })).toBeVisible();
  await page.getByRole('button', { name: `确认归档项目：${renamedProject}` }).click();
  await expect(page.getByRole('button', { name: renamedProject, exact: true })).toHaveCount(0);
  await expect(page.locator('.ei-task-row', { hasText: assignedTitle })).toContainText(
    renamedProject,
  );

  await expect(page.getByRole('dialog', { name: '项目管理' })).toBeVisible();
  await page.getByRole('button', { name: '新建项目' }).click();
  await fillField('项目名称', renamedProject);
  await page.getByRole('button', { name: '保存项目' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toContainText(renamedProject);

  await page.getByRole('button', { name: '完成项目管理' }).click();
  await page.getByText(assignedTitle, { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toBeVisible();
  await fillField('待办描述', '归档后仍允许编辑任务自身字段');
  await page.getByRole('button', { name: '保存待办' }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toHaveCount(0);
  const archivedTaskDetail = await page.request.get(`/api/v1/tasks/${assignedBody.task.id}`);
  await expect(archivedTaskDetail.json()).resolves.toMatchObject({
    task: {
      description: '归档后仍允许编辑任务自身字段',
      project: { name: renamedProject, status: 'ARCHIVED' },
    },
  });

  await page.getByRole('button', { name: '管理项目' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByText('欢迎回来')).toBeVisible();
  await fillField('用户名', username);
  await fillField('密码', password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText(assignedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(manualTitle, { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const undersizedTargets = await page
    .locator('.productionTodoScreen taro-button-core, .productionTodoScreen [role="button"]')
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
        .map((node) => ({
          height: Math.round(node.getBoundingClientRect().height),
          label: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30),
          width: Math.round(node.getBoundingClientRect().width),
        })),
    );
  expect(undersizedTargets, '正式 H2 页面不得存在小于 44px 的点击目标').toEqual([]);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.screenshot({
    animations: 'disabled',
    path: 'docs/quality/screenshots/h2-manual-loop-390x844.png',
  });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    await page.screenshot({
      animations: 'disabled',
      path: `docs/quality/screenshots/h2-manual-loop-${width}x844.png`,
    });
  }

  expect(browserProblems, '正式 H2 页面不应产生控制台或网络失败').toEqual([]);
});

test('正式页面可从 5xx 重试，并在 401 后清空认证 UI 状态', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'phase2-retry', testInfo);

  let failTaskList = true;
  await page.route('**/api/v1/tasks?**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (failTaskList && requestUrl.searchParams.get('status') === 'TODO') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          error: {
            code: 'TEMPORARY_FAILURE',
            details: {},
            message: '暂时无法读取待办',
            requestId: 'req_e2e_500',
          },
        },
        status: 500,
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/#/pages/tasks/index');
  await expect(page.getByText('暂时无法读取待办')).toBeVisible();
  failTaskList = false;
  await page.getByRole('button', { name: '重试读取待办' }).click();
  await expect(page.getByText('今天已经清空')).toBeVisible();

  await page.unroute('**/api/v1/tasks?**');
  await page.route('**/api/v1/projects?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          details: {},
          message: '请先登录',
          requestId: 'req_e2e_401',
        },
      },
      status: 401,
    });
  });
  await page.reload();
  await expect(page.getByText('欢迎回来')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('任务编辑使用打开时版本，并在 409 后保留本地草稿', async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36);
  await useSyntheticAccount(page, 'phase2-conflict', testInfo);
  const createdResponse = await page.request.post('/api/v1/tasks', {
    data: { title: `冲突任务${suffix.slice(-4)}` },
    headers: { Origin: origin, 'Idempotency-Key': `conflict-create-${suffix}` },
  });
  const created = (await createdResponse.json()) as TaskMutationBody;

  await page.goto('/#/pages/tasks/index');
  await page.getByText(created.task.title, { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑待办' })).toBeVisible();
  await fillTaroField(page, '待办标题', '本地未提交草稿');

  const remoteUpdate = await page.request.patch(`/api/v1/tasks/${created.task.id}`, {
    data: { version: created.task.version, changes: { title: '其他终端已修改' } },
    headers: { Origin: origin, 'Idempotency-Key': `conflict-remote-${suffix}` },
  });
  expect(remoteUpdate.status()).toBe(200);

  await page.getByRole('button', { name: '保存待办' }).click();
  await expect(page.getByText('待办已发生变化，请刷新后重试')).toBeVisible();
  await expect(page.getByLabel('待办标题').locator('input').first()).toHaveValue('本地未提交草稿');
});

test('服务端拒绝超过三秒的删除撤销', async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  const suffix = Date.now().toString(36);
  await useSyntheticAccount(page, 'phase2-expired-undo', testInfo);
  const createdResponse = await page.request.post('/api/v1/tasks', {
    data: { title: '过期撤销任务' },
    headers: { Origin: origin, 'Idempotency-Key': `expired-create-${suffix}` },
  });
  const created = (await createdResponse.json()) as TaskMutationBody;
  const deletedResponse = await page.request.delete(
    `/api/v1/tasks/${created.task.id}?version=${created.task.version}`,
    {
      headers: { Origin: origin, 'Idempotency-Key': `expired-delete-${suffix}` },
    },
  );
  const deleted = (await deletedResponse.json()) as { undoOperation: { id: string } };

  await page.waitForTimeout(3_100);
  const undo = await page.request.post(
    `/api/v1/undo-operations/${deleted.undoOperation.id}/execute`,
    {
      headers: { Origin: origin, 'Idempotency-Key': `expired-undo-${suffix}` },
    },
  );
  expect(undo.status()).toBe(410);
  await expect(undo.json()).resolves.toMatchObject({ error: { code: 'UNDO_EXPIRED' } });
});

test('项目身份色与红黄绿三档优先级在任务行中保持独立', async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36);
  await useSyntheticAccount(page, 'phase2-priority', testInfo);

  for (const [index, name] of ['占位项目', '真实项目'].entries()) {
    const project = await page.request.post('/api/v1/projects', {
      data: { name: `${name}${suffix.slice(-4)}` },
      headers: { Origin: origin, 'Idempotency-Key': `priority-project-${index}-${suffix}` },
    });
    expect(project.status()).toBe(201);
  }
  const projectList = await page.request.get('/api/v1/projects?status=ACTIVE&limit=100');
  const projects = (await projectList.json()) as unknown as ProjectListBody;
  const targetProject = projects.items.find((project) => project.name.startsWith('真实项目'));
  expect(targetProject).toBeDefined();

  const priorities = [
    { code: 'HIGH', label: '高优先级', title: '高优先级任务' },
    { code: 'MEDIUM', label: '中优先级', title: '中优先级任务' },
    { code: 'LOW', label: '低优先级', title: '低优先级任务' },
  ] as const;
  for (const priority of priorities) {
    const response = await page.request.post('/api/v1/tasks', {
      data: {
        priority: priority.code,
        projectId: targetProject?.id,
        title: `${priority.title}${suffix.slice(-4)}`,
      },
      headers: {
        Origin: origin,
        'Idempotency-Key': `priority-task-${priority.code}-${suffix}`,
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto('/#/pages/tasks/index');
  for (const priority of priorities) {
    const row = page.locator('.ei-task-row', {
      hasText: `${priority.title}${suffix.slice(-4)}`,
    });
    await expect(row).toContainText(targetProject?.name ?? '');
    await expect(row.locator('.ei-project-color--teal')).toBeVisible();
    await expect(row.getByRole('img', { name: priority.label })).toBeVisible();
  }
  const colors = await page
    .locator('.ei-priority')
    .evaluateAll((nodes) =>
      nodes.map((node) => window.getComputedStyle(node).backgroundColor).sort(),
    );
  expect(colors).toEqual(['rgb(0, 191, 166)', 'rgb(255, 173, 0)', 'rgb(255, 95, 143)']);
});

test('Bottom Sheet 圈定键盘焦点、隔离背景并在返回后恢复触发点', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'phase2-focus', testInfo);
  await page.goto('/#/pages/tasks/index');

  const trigger = page.getByRole('button', { name: '新增待办' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '新建待办' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expect
    .poll(() =>
      page.locator('.productionScroll').evaluate((element) => (element as HTMLElement).inert),
    )
    .toBe(true);

  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
