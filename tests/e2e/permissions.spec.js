import { test, expect } from '@playwright/test';

// Isolated login-error coverage does not need the normal Redmine fixture.
test('an invalid remembered API key can still be forgotten', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('redmine-sprint-board.api-key', 'revoked-key'));
  await page.route('**/redmine/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/');
  await expect(page.locator('#notice')).toContainText('Invalid or revoked API key');
  await page.getByRole('button', { name: 'Forget saved key' }).click();
  expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.api-key'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Connect to Redmine' })).toBeEnabled();
});
