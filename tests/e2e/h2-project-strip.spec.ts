import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { useSyntheticAccount } from './synthetic-account';

const origin = `http://127.0.0.1:${Number(process.env.H5_PORT ?? 11086)}`;

const sixHanProjectName = '测试测试测试';
const sevenHanProjectName = '测试测试测试一';
const mixedProjectName = 'AI项目123456';

async function createProjects(request: APIRequestContext, names: string[]): Promise<void> {
  for (const [index, name] of names.entries()) {
    const response = await request.post('/api/v1/projects', {
      data: { name },
      headers: {
        Origin: origin,
        'Idempotency-Key': `h2-project-strip-${index}-${Date.now().toString(36)}`,
      },
    });
    expect(response.status(), `创建项目“${name}”应成功`).toBe(201);
  }
}

async function expectProjectStripCanScrollAt(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 844 });
  const strip = page.getByRole('group', { name: '项目筛选' });
  const manageButton = page.getByRole('button', { name: '管理项目' });
  await expect(strip).toBeVisible();

  await strip.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const initialMetrics = await strip.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const webkitScrollbar = window.getComputedStyle(element, '::-webkit-scrollbar');
    return {
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      computedHeight: Number.parseFloat(style.height),
      flexChildrenDoNotShrink: Array.from(element.children).every(
        (child) => window.getComputedStyle(child).flexShrink === '0',
      ),
      offsetHeight: (element as HTMLElement).offsetHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      pageHasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      scrollHeight: element.scrollHeight,
      scrollbarWidth: style.getPropertyValue('scrollbar-width'),
      scrollWidth: element.scrollWidth,
      webkitScrollbarDisplay: webkitScrollbar.display,
    };
  });

  expect(initialMetrics.scrollWidth).toBeGreaterThan(initialMetrics.clientWidth);
  expect(initialMetrics.overflowX).toBe('auto');
  expect(initialMetrics.overflowY).toBe('hidden');
  expect(initialMetrics.scrollbarWidth).toBe('none');
  expect(initialMetrics.webkitScrollbarDisplay).toBe('none');
  expect(initialMetrics.clientHeight).toBeCloseTo(initialMetrics.computedHeight, 0);
  expect(initialMetrics.offsetHeight).toBeCloseTo(initialMetrics.computedHeight, 0);
  if (width === 390) expect(initialMetrics.computedHeight).toBeCloseTo(44, 1);
  expect(initialMetrics.scrollHeight).toBe(initialMetrics.clientHeight);
  expect(initialMetrics.flexChildrenDoNotShrink).toBe(true);
  expect(initialMetrics.pageHasHorizontalOverflow).toBe(false);

  await strip.hover();
  await page.mouse.wheel(600, 0);
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await page.mouse.wheel(10_000, 0);
  await expect
    .poll(() =>
      strip.evaluate((element) =>
        Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft),
      ),
    )
    .toBeLessThanOrEqual(1);

  const endMetrics = await strip.evaluate((element) => {
    const manage = element.querySelector('.manageProjectsChip');
    if (!(manage instanceof HTMLElement)) return null;
    const stripBounds = element.getBoundingClientRect();
    const manageBounds = manage.getBoundingClientRect();
    return {
      manageFullyVisible:
        manageBounds.left >= stripBounds.left - 1 && manageBounds.right <= stripBounds.right + 1,
      scrollLeft: element.scrollLeft,
    };
  });
  expect(endMetrics).not.toBeNull();
  expect(endMetrics?.scrollLeft).toBeGreaterThan(0);
  expect(endMetrics?.manageFullyVisible).toBe(true);

  if (width === 390) {
    await page.screenshot({
      animations: 'disabled',
      path: 'docs/quality/screenshots/h2-project-strip-scrolled-390x844.png',
    });
  }

  await manageButton.click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toBeVisible();
  await page.getByRole('button', { name: '关闭项目管理' }).click();
  await expect(page.getByRole('dialog', { name: '项目管理' })).toHaveCount(0);
}

test.use({ viewport: { width: 390, height: 844 } });

test('H2 项目栏隐藏滚动条并按 CSS 宽度省略项目名', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await useSyntheticAccount(page, 'h2-project-strip', testInfo);
  await createProjects(page.request, [
    sixHanProjectName,
    sevenHanProjectName,
    mixedProjectName,
    '工作',
    '生活',
    '学习',
    '面试',
    '副业',
    '健身',
  ]);

  await page.goto('/#/pages/tasks/index');
  await expect(page.getByRole('button', { name: '管理项目' })).toBeVisible();

  const sixHanButton = page.getByRole('button', { name: sixHanProjectName, exact: true });
  const sevenHanButton = page.getByRole('button', { name: sevenHanProjectName, exact: true });
  const mixedButton = page.getByRole('button', { name: mixedProjectName, exact: true });
  await expect(sixHanButton).toHaveCount(1);
  await expect(sevenHanButton).toHaveCount(1);
  await expect(mixedButton).toHaveCount(1);

  const labelMetrics = await Promise.all(
    [sixHanButton, sevenHanButton, mixedButton].map((button) =>
      button.locator('.projectChipLabel').evaluate((label) => {
        const style = window.getComputedStyle(label);
        return {
          clientWidth: label.clientWidth,
          fontSize: Number.parseFloat(style.fontSize),
          fullText: label.textContent,
          maxWidth: Number.parseFloat(style.maxWidth),
          overflowX: style.overflowX,
          scrollWidth: label.scrollWidth,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      }),
    ),
  );
  const [sixHan, sevenHan, mixed] = labelMetrics;

  expect(sixHan.fullText).toBe(sixHanProjectName);
  expect(sevenHan.fullText).toBe(sevenHanProjectName);
  expect(mixed.fullText).toBe(mixedProjectName);
  for (const metrics of labelMetrics) {
    expect(metrics.maxWidth).toBeCloseTo(metrics.fontSize * 6, 1);
    expect(metrics.overflowX).toBe('hidden');
    expect(metrics.textOverflow).toBe('ellipsis');
    expect(metrics.whiteSpace).toBe('nowrap');
  }
  expect(sixHan.scrollWidth).toBeLessThanOrEqual(sixHan.clientWidth);
  expect(sevenHan.scrollWidth).toBeGreaterThan(sevenHan.clientWidth);
  expect(mixed.scrollWidth).toBeGreaterThan(mixed.clientWidth);

  for (const width of [320, 390, 480]) {
    await expectProjectStripCanScrollAt(page, width);
  }
});
