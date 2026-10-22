import { test, expect } from '@playwright/test';

async function setup(page, { failFields = false, denyCategories = false } = {}) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 5, name: 'Done', is_closed: true }];
  const category = id => ({ id, name: id === 4 ? 'Web' : 'Mobile' });
  const base = { project: { id: 1, name: 'Team' }, tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, status: statuses[0], allowed_statuses: statuses, category: category(4) };
  const issues = [
    { ...base, id: 1, subject: 'Versioned but unplanned', fixed_version: { id: 88, name: 'Do not touch' } },
    { ...base, id: 2, subject: 'Member of two Builds', status: statuses[1] },
    { ...base, id: 3, subject: 'Mobile work', category: category(5) },
    { ...base, id: 4, subject: 'Historical completed work', status: statuses[2] },
    { ...base, id: 5, subject: 'Uncategorized work', category: undefined },
    { ...base, id: 6, subject: 'Older active sprint work' },
  ];
  const builds = [
    { ...base, id: 99, subject: '7.2', tracker: { id: 9, name: 'Build' }, status: statuses[2] },
    { ...base, id: 100, subject: '7.1', tracker: { id: 9, name: 'Build' } },
    { ...base, id: 101, subject: '7.2', tracker: { id: 9, name: 'Build' } },
    { ...base, id: 102, subject: '3.0', tracker: { id: 9, name: 'Build' }, category: category(5) },
  ];
  let relationId = 20;
  const relation = (id, from, to, type = 'relates') => ({ id, issue_id: from, issue_to_id: to, relation_type: type });
  const relations = [relation(1, 101, 2), relation(2, 2, 100), relation(3, 100, 6), relation(4, 99, 4), relation(5, 101, 1, 'blocks')];
  const requests = [], writes = [];
  await page.route('**/config.json', route => route.fulfill({ json: { redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1, columnStatusIds: [1, 2, 5], sprintSource: 'build', buildTrackerId: 9, refreshSeconds: 60 } }));
  await page.route('**/redmine/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/redmine', '');
    const method = request.method(); requests.push({ path, method, params: Object.fromEntries(url.searchParams) });
    const send = json => route.fulfill({ json });
    if (path === '/users/current.json') return send({ user: { id: 7, firstname: 'Team', lastname: 'Member' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: statuses });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 9, name: 'Build' }] }] });
    if (path === '/projects/1.json') return send({ project: { id: 1, name: 'Team', issue_categories: [category(4), category(5)] } });
    if (path.endsWith('/issue_categories.json')) return denyCategories ? route.fulfill({ status: 403, json: {} }) : send({ issue_categories: [category(4), category(5)] });
    if (path.endsWith('/memberships.json')) return send({ memberships: [] });
    if (path === '/issues.json') {
      let rows = [...issues, ...builds];
      const p = url.searchParams, tracker = p.get('tracker_id'), status = p.get('status_id'), cat = p.get('category_id'), ids = p.get('issue_id');
      if (tracker) rows = rows.filter(i => i.tracker.id === Number(tracker));
      if (status && status !== '*') rows = rows.filter(i => status === 'open' ? !i.status.is_closed : i.status.id === Number(status));
      if (cat) rows = rows.filter(i => cat === '!*' ? !i.category : i.category?.id === Number(cat));
      if (ids) rows = rows.filter(i => ids.split(',').map(Number).includes(i.id));
      if (p.get('subject')) rows = rows.filter(i => i.subject.toLowerCase().includes(p.get('subject').slice(1).toLowerCase()));
      rows.sort((a, b) => a.id - b.id);
      const offset = Number(p.get('offset') || 0), limit = Number(p.get('limit') || 25);
      return send({ issues: rows.slice(offset, offset + limit), total_count: rows.length, offset });
    }
    const relationMatch = /^\/issues\/(\d+)\/relations\.json$/.exec(path);
    if (relationMatch) {
      const id = Number(relationMatch[1]);
      if (method === 'GET') return send({ relations: relations.filter(r => r.issue_id === id || r.issue_to_id === id) });
      const patch = request.postDataJSON().relation; writes.push({ method, patch });
      const created = relation(++relationId, id, patch.issue_to_id, patch.relation_type); relations.push(created);
      return route.fulfill({ status: 201, json: { relation: created } });
    }
    if (/^\/relations\/\d+\.json$/.test(path) && method === 'DELETE') {
      const id = Number(path.match(/\d+/)[0]); writes.push({ method, id }); relations.splice(relations.findIndex(r => r.id === id), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    if (/^\/issues\/\d+\.json$/.test(path)) {
      const issue = [...issues, ...builds].find(i => i.id === Number(path.match(/\d+/)[0]));
      if (method === 'GET') return send({ issue });
      const patch = request.postDataJSON().issue; writes.push({ method, patch });
      if (failFields) return route.fulfill({ status: 403, json: {} });
      if (patch.status_id) issue.status = statuses.find(s => s.id === patch.status_id);
      if ('estimated_hours' in patch) issue.estimated_hours = patch.estimated_hours;
      if ('assigned_to_id' in patch) issue.assigned_to = undefined;
      return route.fulfill({ status: 204, body: '' });
    }
    throw new Error(`Unexpected Build-mode API ${method} ${path}`);
  });
  return { issues, builds, relations, requests, writes };
}
async function login(page) {
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('synthetic-build-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await page.getByLabel('Category', { exact: true }).selectOption('4');
  await expect(page.locator('#sprint-name')).toHaveText('7.2 (#101)');
}
const column = (page, id) => page.locator(`[data-id="${id}"]`);

test('contributors load category metadata without Manage categories permission', async ({ page }) => {
  const fixture = await setup(page, { denyCategories: true });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('synthetic-contributor-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated', { timeout: 3000 });
  await expect(page.locator('#category option')).toHaveText(['Mobile', 'Web', 'Uncategorized']);
  await expect(page.locator('#sprint-name')).toHaveText('3.0 (#102)');
  expect(fixture.requests.some(r => r.path === '/projects/1.json' && r.params.include === 'issue_categories')).toBe(true);
  expect(fixture.requests.some(r => r.path.endsWith('/issue_categories.json'))).toBe(false);
});

test('Build selectors, backlog category scope, closed sprints and remembered selections', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await expect(page.locator('#sprint option')).toHaveText(['7.2 (#101)', '7.1 (#100)']);
  await expect(column(page, 'backlog').locator('h3')).toHaveText(['Versioned but unplanned']);
  await expect(column(page, 'status-2').locator('h3')).toHaveText(['Member of two Builds']);
  await expect(page.locator('#board h3')).not.toContainText(['7.1']);
  const toggle = page.getByRole('button', { name: 'Filter backlog by category', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Show backlog issues only in the selected category.');
  await toggle.click();
  await expect(column(page, 'backlog').locator('h3')).toHaveText(['Versioned but unplanned', 'Mobile work', 'Uncategorized work']);
  await page.getByLabel('Include closed sprints').check();
  await expect(page.locator('#sprint option')).toHaveText(['7.2 (#101)', '7.1 (#100)', '7.2 (#99) (closed)']);
  await page.getByLabel('Sprint', { exact: true }).selectOption('99');
  await expect(page.locator('#sprint-state')).toContainText('Closed sprint');
  await expect(page.getByRole('button', { name: 'View #4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View #4', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('none');
  await expect(page.locator('#sprint')).toHaveText('No open sprints');
  await page.getByRole('button', { name: 'Filter backlog by category', exact: true }).click();
  await expect(column(page, 'backlog').locator('h3')).toHaveText(['Uncategorized work']);
  await page.getByLabel('Category', { exact: true }).selectOption('4');
  await expect(page.locator('#sprint')).toHaveValue('99');
  await page.getByLabel('Sprint', { exact: true }).selectOption('100');
  await expect(page.locator('#sprint-name')).toHaveText('7.1 (#100)');
  await page.getByLabel('Category', { exact: true }).selectOption('5');
  await expect(page.locator('#sprint-name')).toHaveText('3.0 (#102)');
  await page.getByLabel('Category', { exact: true }).selectOption('4');
  await expect(page.locator('#sprint-name')).toHaveText('7.1 (#100)');
  await page.reload();
  await page.getByLabel('Personal API key').fill('synthetic-build-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#sprint-name')).toHaveText('7.1 (#100)');
  await expect(page.locator('#category')).toHaveValue('4');
  await expect(page.getByRole('button', { name: 'Filter backlog by category', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.requests.some(r => /versions/.test(r.path) || 'fixed_version_id' in r.params)).toBe(false);
});

test('Build controls fit the minimum viewport and paged backlog can show closed-sprint history', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const fixture = await setup(page);
  for (let id = 20; id < 50; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog work ${id}` });
  fixture.issues.push({ ...fixture.issues[0], id: 200, subject: 'Historical open work' });
  fixture.relations.push({ id: 6, issue_id: 99, issue_to_id: 200, relation_type: 'relates' });
  await login(page);
  await page.getByLabel('Include closed sprints').check();
  await page.getByLabel('Sprint', { exact: true }).selectOption('99');
  await expect(column(page, 'status-1').locator('[data-eid="200"]')).toBeVisible();
  const backlog = column(page, 'backlog').locator('.kanban-drag');
  for (let i = 0; i < 10 && !(await column(page, 'backlog').locator('[data-eid="200"]').count()); i++) {
    const before = await backlog.locator('.kanban-item').count();
    await backlog.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => backlog.locator('.kanban-item').count()).toBeGreaterThan(before);
  }
  await expect(column(page, 'backlog').locator('[data-eid="200"]')).toBeVisible();
  const geometry = await page.evaluate(() => ({ width: document.scrollingElement.scrollWidth, height: document.scrollingElement.scrollHeight,
    controls: ['project', 'category', 'sprint'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; }) }));
  expect(geometry.width).toBe(1280); expect(geometry.height).toBe(720);
  for (const r of geometry.controls) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(1280); expect(r.bottom).toBeLessThanOrEqual(720); }
});

test('a successful drag to New is verified and rendered using Redmine REST relation fields', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.locator('[data-eid="1"] h3').dragTo(column(page, 'status-1').locator('.kanban-drag'));
  const links = () => fixture.relations.filter(r => r.issue_id === 101 && r.issue_to_id === 1 && r.relation_type === 'relates');
  await expect.poll(() => links().length).toBe(1);
  await expect(page.locator('#notice')).toContainText('Issue #1 saved in Redmine.', { timeout: 3000 });
  await expect(column(page, 'status-1').locator('[data-eid="1"]')).toBeVisible();
  await expect(column(page, 'backlog').locator('[data-eid="1"]')).toHaveCount(0);
  expect(fixture.writes.filter(w => w.method === 'PUT')).toHaveLength(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(column(page, 'status-1').locator('[data-eid="1"]')).toBeVisible();
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.getByLabel('Planning destination')).toHaveValue('sprint');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.locator('[data-eid="1"] h3').dragTo(column(page, 'backlog').locator('.kanban-drag'));
  await expect(column(page, 'backlog').locator('[data-eid="1"]')).toBeVisible();
  expect(links()).toHaveLength(0);
  expect(fixture.relations.some(r => r.id === 5 && r.relation_type === 'blocks')).toBe(true);
  expect(fixture.issues[0].fixed_version.id).toBe(88);
});

test('drag adds relates membership and status, then removes only selected membership', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.locator('[data-eid="1"] h3').dragTo(column(page, 'status-2').locator('.kanban-drag'));
  await expect(column(page, 'status-2').locator('[data-eid="1"]')).toBeVisible();
  expect(fixture.issues[0].fixed_version.id).toBe(88);
  expect(fixture.writes).toContainEqual({ method: 'PUT', patch: { status_id: 2 } });
  await page.locator('[data-eid="2"] h3').dragTo(column(page, 'backlog').locator('.kanban-drag'));
  await expect(page.locator('[data-eid="2"]')).toHaveCount(0);
  expect(fixture.relations.some(r => r.id === 2)).toBe(true);
  expect(fixture.relations.some(r => r.id === 1)).toBe(false);
  expect(fixture.relations.some(r => r.id === 5 && r.relation_type === 'blocks')).toBe(true);
  expect(fixture.writes.some(w => w.patch && ('fixed_version_id' in w.patch || 'category_id' in w.patch))).toBe(false);
});

test('cross-category planning preserves category and refreshes partial-save state', async ({ page }) => {
  const fixture = await setup(page, { failFields: true }); await login(page);
  await page.getByRole('button', { name: 'Filter backlog by category', exact: true }).click();
  await page.getByRole('button', { name: 'Plan #3', exact: true }).click();
  await page.getByLabel('Planning destination').selectOption('sprint');
  await page.getByLabel('Status', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#editor-notice')).toContainText('Observed sprint membership: present');
  await expect(page.locator('#editor-notice')).toContainText('Requested field values: not retained');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(column(page, 'status-1').locator('[data-eid="3"]')).toBeVisible();
  expect(fixture.issues.find(i => i.id === 3).category.id).toBe(5);
  expect(fixture.relations.some(r => r.issue_id === 101 && r.issue_to_id === 3)).toBe(true);
});
