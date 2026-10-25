import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('登录注册首页展示 IP 循环、独立按钮间距并支持减少动态效果', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('把杂事装进来', { exact: true })).toBeVisible();
  await expect(page.locator('.productionAuthScreen .brandMark')).toHaveCount(0);
  const mascot = page.locator('.authMascot');
  const body = mascot.locator('.authMascotBody');
  const smile = mascot.locator('.authMascotSmile');
  await expect(body).toHaveCSS('animation-iteration-count', 'infinite');
  const before = await body.evaluate((node) => getComputedStyle(node).transform);
  await expect
    .poll(() => body.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(before);
  await expect
    .poll(() => smile.evaluate((node) => Number(getComputedStyle(node).opacity)))
    .toBeGreaterThan(0.9);
  await mascot.click();
  await expect(body).toHaveCSS('animation-play-state', 'paused');
  await expect(mascot).toHaveAttribute('aria-label', '播放吉祥物动画');
  await mascot.focus();
  await page.keyboard.press('Enter');
  await expect(body).toHaveCSS('animation-play-state', 'running');
  for (const mode of ['login', 'register']) {
    if (mode === 'register') {
      await page.getByRole('button', { name: '注册新账号' }).click();
      await expect(page.getByText('创建账号', { exact: true })).toBeVisible();
    }
    for (const size of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 480, height: 844 },
      { width: 390, height: 560 },
    ]) {
      await page.setViewportSize(size);
      const primary = page.locator('.productionAuthScreen .loginButton');
      const secondary = page.locator('.productionAuthScreen .registerLink');
      await secondary.scrollIntoViewIfNeeded();
      const a = (await primary.boundingBox())!;
      const b = (await secondary.boundingBox())!;
      expect(b.y - a.y - a.height).toBeGreaterThanOrEqual(11.5);
      expect(a.height).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', size.width);
    }
  }
  await page.getByRole('button', { name: '返回登录' }).click();
  await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(body).toHaveCSS('animation-name', 'none');
  await expect(smile).toHaveCSS('opacity', '0');
  await expect(mascot).toHaveAttribute('disabled', '');
  await expect(page.getByLabel('用户名').locator('input')).toBeEditable();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.fieldError').first()).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.reload();
  await expect(mascot).toBeVisible();
  await page.screenshot({ path: 'docs/quality/screenshots/auth-ip-login-390x844.png' });
  await page.getByRole('button', { name: '注册新账号' }).click();
  await expect(page.getByText('创建账号', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/quality/screenshots/auth-ip-register-390x844.png' });
});
