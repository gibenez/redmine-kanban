import { test, expect } from '@playwright/test';

async function setup(page) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }];
  const versions = [{ id: 100, name: 'Product 100', status: 'open', project: { id: 1 }, sharing: 'descendants' }, { id: 99, name: 'Product 99', status: 'open', project: { id: 1 }, sharing: 'descendants' }];
  const make = (id, parent, tracker = 'Task', values = []) => ({ id, subject: `Issue ${id}`, tracker: { id: tracker === 'Feature' ? 1 : 2, name: tracker }, project: { id: 1 }, status: statuses[0], priority: { id: 2, name: 'Normal' }, allowed_statuses: statuses, fixed_version: { id: 300 }, custom_fields: [{ id: 7, multiple: true, value: values }], ...(parent ? { parent: { id: parent } } : {}) });
  const rows = [make(1, null, 'Feature'), make(2, 1, 'Task', ['100']), make(3, 1), make(4, null, 'Feature', ['100']), make(5, null, 'Feature', ['99']), make(6, null, 'Task', ['99', '100'])];
  const writes = [];
  await page.route('**/config.json', route => route.fulfill({ json: { openedStatusId: 2, sprintFieldId: 7, redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1, columnStatusIds: [1, 2, 5], swimlaneTrackers: ['Feature'] } }));
  await page.route('**/redmine/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/redmine', ''), params = url.searchParams;
    const send = json => route.fulfill({ json });
    if (path === '/users/current.json') return send({ user: { id: 1, firstname: 'Product', lastname: 'Planner' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: statuses });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Product', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Task' }] }] });
    if (path.endsWith('/memberships.json')) return send({ memberships: [] });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (path.startsWith('/versions/')) return send({ version: versions.find(version => version.id === Number(path.match(/\d+/)[0])) });
    if (path === '/issues.json') {
      let selected = rows;
      const tracker = params.get('tracker_id'), value = params.get('cf_7'), status = params.get('status_id');
      if (tracker) selected = selected.filter(row => tracker.startsWith('!') ? !tracker.slice(1).split('|').map(Number).includes(row.tracker.id) : tracker.split('|').map(Number).includes(row.tracker.id));
      if (value) selected = selected.filter(row => value === '!*' ? row.custom_fields[0]?.value.length === 0 : value.startsWith('!') ? !row.custom_fields[0]?.value.includes(value.slice(1)) : row.custom_fields[0]?.value.includes(value));
      if (status !== '*') selected = selected.filter(row => status === 'open' ? !row.status.is_closed : row.status.id === Number(status));
      if (params.has('subject')) selected = selected.filter(row => row.subject.includes(params.get('subject').slice(1)));
      const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (/^\/issues\/\d+\.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]), issue = rows.find(row => row.id === id);
       if (request.method() === 'GET') return send({ issue: { ...issue, children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) } });
      const patch = request.postDataJSON().issue; writes.push({ id, patch });
      if (patch.custom_fields) issue.custom_fields = patch.custom_fields;
      if (patch.status_id) issue.status = statuses.find(row => row.id === patch.status_id);
      return route.fulfill({ status: 204, body: '' });
    }
    throw new Error(`Unexpected ${path}`);
  });
  await page.goto('/'); await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  return { rows, writes };
}
const heading = (page, id) => page.locator(`.swimlane-headers > [data-lane="${id}"]`);
const backlog = (page, id) => page.locator(`[data-id="backlog"] [data-eid="${id}"]`);
const laneCard = (page, lane, id) => page.locator(`[data-id="status-1"] [data-lane="${lane}"] [data-eid="${id}"]`);
test('background indicators finish even when Backlog search changes during the scan', async ({ page }) => {
  await setup(page);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route('**/redmine/issues/4.json?**', async route => {
    await blocked;
    await route.fallback();
  });
  try {
    await refresh(page);
    const add = heading(page, 4).getByRole('button', { name: 'Add missing subtasks for #4' });
    await expect(add).toHaveAttribute('title', /Checking/);
    await page.getByLabel('Search backlog').fill('absent');
    await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match');
    release();
    await expect(add).toHaveAttribute('title', /\(0 missing\)/);
    await expect(add).toBeDisabled();
  } finally { release(); }
});
test('renders and unlocks the board before hierarchy checks finish, ignoring stale results', async ({ page }) => {
  await setup(page);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  await page.route('**/redmine/issues/4.json?**', async route => {
    started();
    await blocked;
    await route.fulfill({ status: 403, json: {} }).catch(() => {});
  });
  try {
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    await requested;
    await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
    await expect(heading(page, 4)).toBeVisible();
    const add = heading(page, 4).getByRole('button', { name: 'Add missing subtasks for #4' });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute('title', /Checking/);
    await page.locator('#sprint').selectOption('99');
    await expect(heading(page, 5)).toBeVisible();
    release();
    await expect(heading(page, 4)).toHaveCount(0);
    await expect(heading(page, 5).getByRole('button')).not.toHaveAttribute('title', /unknown/);
  } finally { release(); }
});
async function refresh(page) {
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
}

test('own membership alone creates headings and includes children', async ({ page }) => {
  await setup(page);
  await expect(heading(page, 4)).toBeVisible();
  await expect(heading(page, 1)).toHaveCount(0);
  await expect(laneCard(page, 'ungrouped', 2)).toBeVisible();
  await expect(backlog(page, 1)).toBeVisible();
  await expect(laneCard(page, 4, 3)).toHaveCount(0);
});
test('thousands of Backlog parents load only one visible page, then append on scroll', async ({ page }) => {
  const fixture = await setup(page);
  const base = fixture.rows[0];
  for (let id = 100; id < 1500; id++) fixture.rows.push({ ...base, id, subject: `Parent ${id}` });
  const requests = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.endsWith('/issues.json') && url.searchParams.get('cf_7') === '!*') requests.push(url); });
  await refresh(page);
  const list = page.locator('[data-id="backlog"] .kanban-drag');
  const initial = await list.locator('.kanban-item').count();
  expect(initial).toBeLessThan(30);
  expect(requests).toHaveLength(1);
  expect(Number(requests[0].searchParams.get('limit'))).toBeLessThan(30);
  await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => list.locator('.kanban-item').count()).toBeGreaterThan(initial);
  expect(requests).toHaveLength(2);
});
test('dragging a parent opens it regardless of drop column and plans missing children', async ({ page }) => {
  const fixture = await setup(page);
  await backlog(page, 1).locator('h3').dragTo(page.locator('[data-id="status-1"] .swimlane-cards').first());
  await expect(heading(page, 1)).toBeVisible();
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(backlog(page, 1)).toHaveCount(0); await expect(backlog(page, 3)).toHaveCount(0);
  expect(fixture.writes).toEqual([{ id: 1, patch: { custom_fields: [{ id: 7, value: ['100'] }], status_id: 2 } }, { id: 3, patch: { custom_fields: [{ id: 7, value: ['100'] }] } }]);
  expect(fixture.rows.find(row => row.id === 3).status.id).toBe(1);
});
test('parents belonging to another Sprint are excluded from Backlog without writes', async ({ page }) => {
  const fixture = await setup(page);
  await expect(backlog(page, 5)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Plan #5', exact: true })).toHaveCount(0);
  expect(fixture.rows.find(row => row.id === 5).custom_fields[0].value).toEqual(['99']);
  expect(fixture.writes).toEqual([]);
});

test('header action highlights all missing descendants and adds closed and other-Sprint subtasks without confirmation', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100'];
  fixture.rows[2].custom_fields[0].value = ['99'];
  fixture.rows[2].status = { id: 5, name: 'Done', is_closed: true };
  const nested = structuredClone(fixture.rows[4]); nested.id = 7; nested.parent = { id: 1 }; fixture.rows.push(nested);
  const grandchild = structuredClone(fixture.rows[2]); grandchild.id = 8; grandchild.parent = { id: 7 }; fixture.rows.push(grandchild);
  await refresh(page);
  const add = heading(page, 1).getByRole('button', { name: 'Add missing subtasks for #1' });
  await expect(add).toHaveClass(/requires-attention/);
  await expect(add).toHaveAttribute('title', /Add missing subtasks.*\(2 missing\)/);
  await expect(add).toHaveText('');
  await expect(add.locator('svg')).toBeVisible();
  await page.getByLabel('Search backlog').fill('absent');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match');
  await add.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toContainText('Added/confirmed: #3, #8');
  expect(fixture.writes).toEqual([3, 8].map(id => ({ id, patch: { custom_fields: [{ id: 7, value: ['99', '100'] }] } })));
  expect(fixture.rows.find(row => row.id === 7).custom_fields[0].value).toEqual(['99']);
  expect(fixture.rows[2].status.id).toBe(5); expect(fixture.rows[2].fixed_version.id).toBe(300);
  await expect(add).toBeDisabled();
  await expect(add).not.toHaveClass(/requires-attention/);
  const positions = await add.evaluate(button => ({ button: button.getBoundingClientRect().right, header: button.closest('.swimlane-heading').getBoundingClientRect().right }));
  expect(positions.header - positions.button).toBeLessThan(20);
});

test('forbidden opened transition aborts the complete Backlog operation', async ({ page }) => {
  const fixture = await setup(page); fixture.rows[0].allowed_statuses = [];
  await backlog(page, 1).locator('h3').dragTo(page.locator('[data-id="status-5"] .swimlane-cards').first());
  await expect(page.locator('#notice')).toContainText('Preflight failed');
  expect(fixture.writes).toEqual([]);
  await expect(backlog(page, 1)).toBeVisible();
});

test('unreadable hierarchy shows unknown state instead of an all-clear', async ({ page }) => {
  await setup(page);
  await page.route('**/redmine/issues/4.json?**', route => route.fulfill({ status: 403, json: {} }));
  await refresh(page);
  const add = heading(page, 4).getByRole('button', { name: 'Add missing subtasks for #4' });
  await expect(add).toHaveClass(/planning-unknown/);
  await expect(add).toHaveAttribute('title', /unknown.*Refresh/);
  await expect(add).toBeDisabled();
});

test('header reports partial writes and stops before remaining subtasks', async ({ page }) => {
  const fixture = await setup(page); fixture.rows[0].custom_fields[0].value = ['100'];
  for (const id of [7, 8]) fixture.rows.push({ ...structuredClone(fixture.rows[2]), id });
  await refresh(page);
  await page.route('**/redmine/issues/7.json**', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 403, json: {} }) : route.fallback());
  await heading(page, 1).getByRole('button', { name: 'Add missing subtasks for #1' }).click();
  await expect(page.locator('#notice')).toContainText('Added/confirmed: #3. Failed/unconfirmed: #7. Not attempted: #8.');
  expect(fixture.writes.map(write => write.id)).toEqual([3]);
  expect(fixture.rows.find(row => row.id === 8).custom_fields[0].value).toEqual([]);
  await expect(heading(page, 1).getByRole('button')).toHaveAttribute('title', /\(2 missing\)/);
});
test('removing parent membership regroups children without removing them', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100']; await refresh(page);
  await expect(laneCard(page, 1, 2)).toBeVisible();
  fixture.rows[0].custom_fields[0].value = []; await refresh(page);
  await expect(heading(page, 1)).toHaveCount(0); await expect(laneCard(page, 'ungrouped', 2)).toBeVisible();
  expect(fixture.writes).toEqual([]);
});
test('individual removal preserves other Sprint values', async ({ page }) => {
  const fixture = await setup(page);
  await page.getByRole('button', { name: 'Plan #6', exact: true }).click();
  await page.getByLabel('Destination').selectOption('backlog');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#notice')).toContainText('still belongs to other Sprints');
  expect(fixture.rows.find(row => row.id === 6).custom_fields[0].value).toEqual(['99']);
  await expect(backlog(page, 6)).toHaveCount(0);
});
test('Show closed only controls Backlog parents, not member headings', async ({ page }) => {
  const fixture = await setup(page); fixture.rows[0].status = { id: 5, name: 'Done', is_closed: true }; await refresh(page);
  await page.getByRole('button', { name: 'Backlog filters', exact: true }).click();
  const closed = page.getByRole('checkbox', { name: 'Show closed issues', exact: true });
  await expect(page.getByRole('button', { name: 'Show all unplanned', exact: true })).toHaveCount(0);
  await expect(closed).toHaveAccessibleDescription('Include closed issues in Backlog.');
  await expect(closed).not.toBeChecked();
  await expect(backlog(page, 1)).toHaveCount(0);
  await closed.check(); await expect(backlog(page, 1)).toBeVisible();
  await expect(closed).toBeChecked();
  fixture.rows[0].custom_fields[0].value = ['100']; await refresh(page);
  await expect(heading(page, 1)).toBeVisible();
  await closed.uncheck(); await expect(heading(page, 1)).toBeVisible();
});
test('filters retain planned empty headings and disabled add action', async ({ page }) => {
  await setup(page); await page.getByLabel('Search backlog').fill('absent');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match these filters');
  await expect(heading(page, 4)).toBeVisible();
  await expect(heading(page, 4).getByRole('button', { name: 'Add missing subtasks for #4' })).toBeDisabled();
  await expect(page.locator('[data-remove-lane]')).toHaveCount(0);
});
