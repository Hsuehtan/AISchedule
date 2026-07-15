import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;

type ButtonPaint = {
  backgroundColor: string;
  color: string;
};

type ProjectMutationBody = {
  project: { id: string; name: string };
};

async function registerApi(request: APIRequestContext, username: string): Promise<void> {
  const response = await request.post('/api/v1/auth/username/register', {
    data: { username, password: 'valid-password' },
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(201);
}

async function readButtonPaint(button: Locator): Promise<ButtonPaint> {
  return button.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
    };
  });
}

async function expectNeutralPointerPaint(
  page: Page,
  button: Locator,
  description: string,
): Promise<void> {
  await expect(button, `${description}应可见`).toBeVisible();
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  if (!bounds) throw new Error(`${description}没有可点击区域`);

  const before = await readButtonPaint(button);
  let during: ButtonPaint | undefined;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  try {
    await page.waitForTimeout(20);
    during = await readButtonPaint(button);
  } finally {
    // Release outside the original control so the press audit cannot trigger its click action.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
  await page.waitForTimeout(20);
  const after = await readButtonPaint(button);

  expect(during, `${description}按下时应复用静止态颜色`).toEqual(before);
  expect(during?.backgroundColor, `${description}不得出现 Taro 默认灰色按压底色`).not.toBe(
    'rgb(222, 222, 222)',
  );
  expect(after, `${description}松开后应回到同一静止态颜色`).toEqual(before);
}

async function expectVisibleProductButtonsNeutral(page: Page): Promise<void> {
  const buttons = page.locator('.productionTodoScreen taro-button-core:visible');
  await expect(buttons.first()).toBeVisible();
  const audit = await buttons.evaluateAll((elements) => {
    const labelOf = (element: Element) =>
      element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? '';

    return {
      missingClass: elements
        .filter((element) => !element.classList.contains('ei-press-neutral'))
        .map(labelOf),
      missingPaintVariables: elements
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return (
            !style.getPropertyValue('--ei-press-bg').trim() ||
            !style.getPropertyValue('--ei-press-fg').trim()
          );
        })
        .map(labelOf),
    };
  });
  expect(audit.missingClass, '正式 H2 页面所有可见 Taro Button 均应关闭默认按压态').toEqual([]);
  expect(
    audit.missingPaintVariables,
    '正式 H2 页面所有可见 Taro Button 均应声明静止态颜色变量',
  ).toEqual([]);
}

test.use({ viewport: { width: 390, height: 844 } });

test('正式 H2 按钮保持静止态颜色、合法选中态与键盘焦点语义', async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now().toString(36);
  const projectName = `按压项目${suffix.slice(-3)}`;
  const taskTitle = `按压态验证待办${suffix.slice(-3)}`;

  await registerApi(page.request, `press_${suffix}`);
  const projectResponse = await page.request.post('/api/v1/projects', {
    data: { name: projectName },
    headers: { Origin: origin, 'Idempotency-Key': `press-project-${suffix}` },
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as ProjectMutationBody;
  const taskResponse = await page.request.post('/api/v1/tasks', {
    data: { projectId: project.project.id, title: taskTitle },
    headers: { Origin: origin, 'Idempotency-Key': `press-task-${suffix}` },
  });
  expect(taskResponse.status()).toBe(201);

  await page.goto('/#/pages/tasks/index');
  const addButton = page.getByRole('button', { name: '新增待办' });
  const allChip = page.getByRole('button', { exact: true, name: '全部' });
  const projectChip = page.getByRole('button', { exact: true, name: projectName });
  const smartInboxButton = page.getByRole('button', {
    name: '使用 Agent 一键整理 Smart Inbox',
  });
  const taskOpenButton = page.getByRole('button', { name: `编辑待办：${taskTitle}` });
  const taskCompleteButton = page.getByRole('button', { name: `完成待办：${taskTitle}` });

  await expect(taskOpenButton).toBeVisible();
  await expectVisibleProductButtonsNeutral(page);

  await page.keyboard.press('Tab');
  await expect(addButton, '顶部加号应是正式页的第一个键盘焦点').toBeFocused();
  const focusOutline = await addButton.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: style.outlineWidth,
    };
  });
  expect(focusOutline).toEqual({ color: 'rgb(0, 216, 255)', style: 'solid', width: '2px' });

  await expectNeutralPointerPaint(page, projectChip, '项目 Chip');
  await expectNeutralPointerPaint(page, addButton, '顶部加号');
  await expectNeutralPointerPaint(page, smartInboxButton, 'Smart Inbox 主按钮');
  await expectNeutralPointerPaint(page, taskOpenButton, '待办主体');
  await expectNeutralPointerPaint(page, taskCompleteButton, '待办完成控件');

  await expect(allChip).toHaveAttribute('aria-pressed', 'true');
  await expect(projectChip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.ei-task-row', { hasText: taskTitle })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await expect(taskOpenButton).toBeEnabled();
  await expect(taskCompleteButton).toBeEnabled();

  await projectChip.click();
  await expect(projectChip).toHaveAttribute('aria-pressed', 'true');
  await expect(allChip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.projectChips .chipActive')).toHaveCount(1);
  await expect(projectChip.locator('.chip')).toHaveClass(/chipActive/);
  await expect(page.locator('.projectChips .button-hover')).toHaveCount(0);
  const grayButtonsAfterSelection = await page
    .locator('.productionTodoScreen taro-button-core:visible')
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) => window.getComputedStyle(element).backgroundColor === 'rgb(222, 222, 222)',
        )
        .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''),
    );
  expect(grayButtonsAfterSelection, '项目选中后只允许 chipActive 成为持久视觉状态').toEqual([]);

  await addButton.click();
  const dialog = page.getByRole('dialog', { name: '新建待办' });
  await expect(dialog).toBeVisible();
  await expectVisibleProductButtonsNeutral(page);

  await expectNeutralPointerPaint(page, dialog.locator('.formPicker').first(), '所属项目 Picker');
  await expectNeutralPointerPaint(
    page,
    dialog.getByRole('button', { name: /^计划时间，/ }),
    '日期时间 Picker',
  );
  await expectNeutralPointerPaint(
    page,
    dialog.getByRole('button', { name: '保存待办' }),
    'Sheet 保存按钮',
  );
  await expectNeutralPointerPaint(
    page,
    dialog.getByRole('button', { name: '关闭待办编辑' }),
    'Sheet 关闭按钮',
  );

  await dialog.getByRole('button', { name: '关闭待办编辑' }).click();
  await expect(dialog).toHaveCount(0);
});
