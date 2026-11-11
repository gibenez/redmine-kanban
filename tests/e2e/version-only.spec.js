import { test, expect } from '@playwright/test';

test('missing Sprint field configuration fails explicitly without falling back to Target version', async ({ page }) => {
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1, columnStatusIds: [1],
  } }));
  const requests = [];
  await page.route('**/redmine/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/redmine', '');
    requests.push(path);
    const responses = { '/users/current.json': { user: { id: 1 } }, '/issue_statuses.json': { issue_statuses: [{ id: 1, name: 'New' }] }, '/projects.json': { projects: [{ id: 1 }] } };
    if (!responses[path]) throw new Error(`Unexpected planning request ${path}`);
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/'); await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#notice')).toContainText('SPRINT_FIELD_ID');
  await expect(page.locator('#workspace')).toBeHidden();
  expect(requests).toHaveLength(3);
});

test('legacy browser configuration blocks connection without reading or changing Sprint membership', async ({ page }) => {
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1, columnStatusIds: [1],
    sprintSource: 'build', buildTrackerId: 9,
  } }));
  const requests = [];
  await page.route('**/redmine/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/redmine', '');
    requests.push({ path, method: request.method() });
    const responses = {
      '/users/current.json': { user: { id: 1 } },
      '/issue_statuses.json': { issue_statuses: [{ id: 1, name: 'New' }] },
      '/projects.json': { projects: [{ id: 1, name: 'Team' }] },
    };
    if (!responses[path]) throw new Error(`Unexpected planning request: ${path}`);
    return route.fulfill({ json: responses[path] });
  });
  await page.goto('/');
  await expect(page.locator('#category-control, #sprint-actions, #sprint-dialog')).toHaveCount(0);
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#notice')).toContainText('Build-based Sprints are no longer supported');
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Connect to Redmine' })).toBeEnabled();
  expect(requests).toHaveLength(3);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
