import { test, expect } from '@playwright/test';

test('Backlog only shows Swimlane-capable issues with no Sprint, including after toggling closed issues', async ({ page }) => {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 5, name: 'Done', is_closed: true }];
  const trackers = [{ id: 1, name: 'Feature' }, { id: 2, name: 'Task' }];
  const issue = (id, tracker, value, status = statuses[0]) => ({ id, subject: `Issue ${id}`, tracker, status, project: { id: 1 }, priority: { id: 1, name: 'Normal' }, custom_fields: [{ id: 7, value }] });
  const issues = [issue(1, trackers[0], ''), issue(2, trackers[0], [], statuses[1]), issue(3, trackers[1], ''), issue(4, trackers[0], ['20']), issue(5, trackers[0], ['10', '20']), issue(6, trackers[0], '', statuses[2]), { ...issue(7, trackers[0], ''), custom_fields: [] }];
  const backlogQueries = [];
  await page.route('**/config.json', route => route.fulfill({ json: { redminePublicUrl: 'https://redmine.example.test', sprintFieldId: 7, backlogStatusId: 1, columnStatusIds: [1, 2, 5], swimlaneTrackers: ['Feature'], refreshSeconds: 60 } }));
  await page.route('**/redmine/**', route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/redmine', '');
    const send = json => route.fulfill({ json });
    if (path === '/users/current.json') return send({ user: { id: 1, firstname: 'Test', lastname: 'User' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: statuses });
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: [{ id: 1, name: 'Normal' }] });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Product', trackers }] });
    if (path.endsWith('/memberships.json')) return send({ memberships: [] });
    if (path.endsWith('/versions.json')) return send({ versions: [{ id: 10, name: 'Sprint 10', status: 'open', project: { id: 1 } }] });
    if (path === '/issues.json') {
      const backlog = url.searchParams.get('cf_7') === '!*';
      if (backlog) backlogQueries.push(Object.fromEntries(url.searchParams));
      const rows = issues.filter(item => {
        const value = item.custom_fields[0]?.value;
        const memberships = Array.isArray(value) ? value : value ? [value] : [];
        return backlog
          ? memberships.length === 0 && item.tracker.id === Number(url.searchParams.get('tracker_id')) && (url.searchParams.get('status_id') === '*' || !item.status.is_closed)
          : memberships.includes('10');
      });
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit'));
      return send({ issues: rows.slice(offset, offset + limit), total_count: rows.length, offset });
    }
    throw new Error(`Unexpected API path ${path}`);
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  const backlog = page.locator('[data-id="backlog"]');
  await expect(backlog.locator('.kanban-item')).toHaveCount(2);
  for (const id of [1, 2]) await expect(backlog.locator(`[data-eid="${id}"]`)).toBeVisible();
  await expect(page.getByLabel('Show all unplanned')).toHaveCount(0);
  await expect(page.locator('#filter-controls')).toBeHidden();
  await expect(page.getByLabel('Search backlog')).toHaveAttribute('placeholder', 'Search');
  await page.getByRole('button', { name: 'Backlog filters', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show closed issues', exact: true }).check();
  await expect(backlog.locator('.kanban-item')).toHaveCount(3);
  await expect(backlog.locator('[data-eid="6"]')).toBeVisible();
  for (const id of [3, 4, 5, 7]) await expect(backlog.locator(`[data-eid="${id}"]`)).toHaveCount(0);
  for (const query of backlogQueries) expect(query).toMatchObject({ cf_7: '!*', tracker_id: '1' });
  await expect(backlog.locator('#tracker option')).toHaveText(['All eligible trackers', 'Feature']);
  await expect(backlog.locator('#filter-controls')).toBeVisible();
});
