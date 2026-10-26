import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { useSyntheticAccount } from './synthetic-account';

test('共享浮层支持拖动高度、内部滚动、键盘调整和重开复位', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'overlay-resize', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '新增待办' }).click();
  const dialog = page.getByRole('dialog', { name: '新建待办' });
  const handle = dialog.getByRole('slider', { name: '调整浮层高度' });
  await expect(handle).toBeVisible();
  const naturalHeight = (await dialog.boundingBox())!.height;
  const box = (await handle.boundingBox())!;
  expect(Math.round(box.height * 100) / 100).toBeGreaterThanOrEqual(44);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 260, { steps: 8 });
  await page.mouse.up();
  expect((await dialog.boundingBox())!.height).toBeLessThan(naturalHeight - 100);
  const content = dialog.locator('.ei-sheet-content');
  await expect(content).toHaveCSS('scrollbar-width', 'none');
  expect(
    await content.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar').display),
  ).toBe('none');
  await content.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole('button', { name: '保存待办' })).toBeInViewport();
  await handle.focus();
  await page.keyboard.press('End');
  const expanded = (await dialog.boundingBox())!;
  expect(expanded.height).toBeGreaterThan(naturalHeight);
  expect(expanded.y).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('Home');
  await expect(dialog).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 560 });
  await page.keyboard.press('End');
  expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(536);
  await page.screenshot({
    path: 'docs/quality/screenshots/resizable-task-390x560.png',
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: '关闭待办编辑' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新增待办' }).click();
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeCloseTo(naturalHeight, 0);
});

test('触屏拖动、取消手势与视口变化不关闭浮层', async ({ page }, testInfo) => {
  await useSyntheticAccount(page, 'overlay-resize-touch', testInfo);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '新增待办' }).click();
  const dialog = page.getByRole('dialog', { name: '新建待办' });
  const handle = dialog.getByRole('slider', { name: '调整浮层高度' });
  await expect(handle).toBeVisible();
  // Wait for the normal entry animation before sampling the touch target.
  await expect
    .poll(() => dialog.evaluate((node) => getComputedStyle(node).transform))
    .toBe('matrix(1, 0, 0, 1, 0, 0)');
  const before = (await dialog.boundingBox())!.height;
  const box = (await handle.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, y: point.y - 140 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await dialog.boundingBox())!.height).toBeGreaterThan(before + 100);
  const moved = (await handle.boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }],
  });
  await expect(dialog).toHaveAttribute('data-modal-resizing', 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(dialog).not.toHaveAttribute('data-modal-resizing');
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: 'test-results/overlay-touch-task-390x844.png',
    animations: 'disabled',
  });
  await cdp.detach();
  for (const size of [
    { width: 320, height: 844 },
    { width: 480, height: 844 },
    { width: 390, height: 560 },
  ]) {
    await page.setViewportSize(size);
    await handle.focus();
    await page.keyboard.press('End');
    expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(size.height - 24);
    await page.keyboard.press('Home');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(size.height - 24);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', size.width);
  }
});
