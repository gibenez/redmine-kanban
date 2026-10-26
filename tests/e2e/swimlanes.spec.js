import { test, expect } from '@playwright/test';

async function setup(page, mode = 'version', deniedId) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }, { id: 8, name: 'Waiting' }];
  const versions = [{ id: 100, name: 'Sprint 100', status: 'open', due_date: '2027-01-01' }, { id: 99, name: 'Previous', status: 'open', due_date: '2027-02-01' }];
  const base = { project: { id: 1, name: 'Team' }, tracker: { id: 2, name: 'Task' }, priority: { id: 1, name: 'Normal' }, allowed_statuses: statuses, estimated_hours: null };
  const make = (id, subject, status = 1, parent) => ({ ...base, id, subject, status: statuses.find(row => row.id === status), ...(parent ? { parent: { id: parent } } : {}) });
  const rows = [
    { ...make(1, 'Parent feature'), tracker: { id: 1, name: 'Feature' } },
    make(2, 'Implement child', 2, 1),
    { ...make(3, 'Nested bug', 1, 1), tracker: { id: 3, name: 'Bug' } },
    make(4, 'Completed grandchild', 5, 3),
    make(6, 'Waiting child', 8, 1),
    { ...make(7, 'Independent work', 2), fixed_version: versions[0] },
    { ...make(8, 'Foreign child', 1, 1), project: { id: 2, name: 'Other' } },
    ...versions.map(version => ({ ...make(version.id, version.name), tracker: { id: 9, name: 'Build' } })),
  ];
  let nextRelation = 10;
  let relations = [
    { id: 1, issue_id: 100, issue_to_id: 7, relation_type: 'relates' },
    { id: 2, issue_id: 99, issue_to_id: 2, relation_type: 'relates' },
    { id: 3, issue_id: 100, issue_to_id: 1, relation_type: 'blocks' },
  ];
  const writes = [];
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1, columnStatusIds: [1, 2, 5],
    sprintSource: mode, buildTrackerId: 9, refreshSeconds: 60, swimlaneTrackers: ['Feature', 'Bug', 'Improvement'],
  } }));
  await page.route('**/redmine/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/redmine', ''), method = request.method();
    const send = json => route.fulfill({ json });
    if (path === '/users/current.json') return send({ user: { id: 1, firstname: 'Team', lastname: 'Member' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: statuses });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Task' }, { id: 3, name: 'Bug' }, { id: 9, name: 'Build' }] }] });
    if (path === '/projects/1.json') return send({ project: { id: 1, issue_categories: [] } });
    if (path.endsWith('/memberships.json')) return send({ memberships: [] });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (path.startsWith('/versions/')) return send({ version: versions.find(version => version.id === Number(path.match(/\d+/)[0])) });
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: [{ id: 1, name: 'Normal' }] });
    if (path.startsWith('/relations/')) {
      const id = Number(path.match(/\d+/)[0]); writes.push({ method, relation: relations.find(row => row.id === id) });
      relations = relations.filter(row => row.id !== id); return route.fulfill({ status: 204, body: '' });
    }
    if (/^\/issues\/\d+\/relations.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]);
      if (method === 'GET') return send({ relations: relations.filter(row => row.issue_id === id || row.issue_to_id === id) });
      const relation = { id: nextRelation++, issue_id: id, ...request.postDataJSON().relation };
      writes.push({ method, relation });
      if (relation.issue_to_id === deniedId) return route.fulfill({ status: 403, json: {} });
      relations.push(relation); return send({ relation });
    }
    if (path === '/issues.json') {
      const params = url.searchParams;
      let selected = rows.filter(row => row.project.id === Number(params.get('project_id')));
      if (params.has('tracker_id')) selected = selected.filter(row => row.tracker.id === Number(params.get('tracker_id')));
      const version = params.get('fixed_version_id');
      if (version) selected = selected.filter(row => version === '!*' ? !row.fixed_version : row.fixed_version?.id === Number(version));
      const status = params.get('status_id');
      if (status !== '*') selected = selected.filter(row => status === 'open' ? !row.status.is_closed : row.status.id === Number(status));
      if (params.has('issue_id')) selected = selected.filter(row => params.get('issue_id').split(',').map(Number).includes(row.id));
      if (params.has('subject')) selected = selected.filter(row => row.subject.toLowerCase().includes(params.get('subject').replace(/^~/, '').toLowerCase()));
      selected.sort((a, b) => b.id - a.id);
      const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (/^\/issues\/\d+.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]), issue = rows.find(row => row.id === id);
      if (method === 'GET') return send({ issue: { ...issue, children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) } });
      const patch = request.postDataJSON().issue; writes.push({ id, patch, method });
      if (id === deniedId) return route.fulfill({ status: 403, json: {} });
      if ('fixed_version_id' in patch) issue.fixed_version = versions.find(row => row.id === patch.fixed_version_id);
      if ('status_id' in patch) issue.status = statuses.find(row => row.id === patch.status_id);
      return route.fulfill({ status: 204, body: '' });
    }
    throw new Error(`Unexpected ${method} ${path}`);
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  return { rows, writes, relations: () => relations, make };
}

const lane = (page, status = 1, id = 1) => page.locator(`.kanban-board[data-id="status-${status}"] .swimlane-section[data-lane="${id}"]`);
async function plan(page) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.kanban-board[data-id="backlog"] [data-eid="1"] h3').dragTo(page.locator('.kanban-board[data-id="status-2"] .swimlane-cards'));
  await expect(lane(page).getByRole('link', { name: '#1 — Parent feature', exact: true })).toBeVisible();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
}

for (const mode of ['version', 'build']) {
  test(`${mode}: planning explodes descendants without changing statuses; removal respects other memberships`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = await setup(page, mode); await plan(page);
    await expect(lane(page, 2).locator('[data-eid="2"]')).toBeVisible();
    await expect(lane(page, 1).locator('[data-eid="3"]')).toBeVisible();
    await expect(lane(page, 5).locator('[data-eid="4"]')).toBeVisible();
    await expect(page.locator('.swimlane-section[data-lane="3"]')).toHaveCount(0);
    await expect(page.locator('.kanban-board')).toHaveCount(4);
    await expect(page.locator('.kanban-board:not([data-id="backlog"]) [data-eid="1"]')).toHaveCount(0);
    await expect(lane(page).getByRole('link', { name: '#1 — Parent feature', exact: true })).toHaveAttribute('href', 'https://redmine.example.test/issues/1');
    await expect(lane(page).locator('summary')).toContainText('1 issues outside displayed statuses');
    await lane(page).locator('summary').click();
    await expect(lane(page).getByRole('link', { name: '#6 — Waiting child' })).toBeVisible();
    await expect(page.locator('#notice')).toContainText('Excluded cross-project descendants: #8');
    expect(fixture.writes.some(write => write.patch && 'status_id' in write.patch)).toBe(false);
    await expect.poll(async () => {
      const positions = await page.locator('.swimlane-section[data-lane="ungrouped"]').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
      return new Set(positions).size;
    }).toBe(1);
    const colors = await page.locator('.swimlane-section[data-lane="1"]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    expect(new Set(colors).size).toBe(1); expect(colors[0]).not.toBe('rgba(0, 0, 0, 0)');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove Swimlane #1 from Sprint' }).click();
    await expect(page.locator('#notice')).toContainText('5 issues removed from Sprint');
    await expect(page.locator('.swimlane-section[data-lane="1"]')).toHaveCount(0);
    expect(fixture.rows.find(row => row.id === 2).status.id).toBe(2);
    if (mode === 'build') {
      expect(fixture.relations().some(row => row.id === 2)).toBe(true);
      expect(fixture.relations().some(row => row.id === 3)).toBe(true);
      expect(fixture.writes.some(write => write.patch && 'fixed_version_id' in write.patch)).toBe(false);
    }
    expect(errors).toEqual([]);
  });
}

test('refresh is read-only; missing descendants are added explicitly; empty Swimlanes remain', async ({ page }) => {
  const fixture = await setup(page); await plan(page);
  const count = fixture.writes.length;
  fixture.rows.push(fixture.make(9, 'Later child', 2, 1));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(fixture.writes.length).toBe(count);
  await expect(lane(page, 2).locator('[data-eid="9"]')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Add missing descendants of #1' }).click();
  await expect(lane(page, 2).locator('[data-eid="9"]')).toBeVisible();
  for (const row of fixture.rows) if ([2, 3, 4, 6, 9].includes(row.id)) row.fixed_version = undefined;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(lane(page)).toContainText('No descendants in this Sprint.');
});

test('individual Cards change status without changing hierarchy or siblings', async ({ page }) => {
  const fixture = await setup(page); await plan(page);
  await lane(page, 2).locator('[data-eid="2"] h3').dragTo(lane(page, 5).locator('.swimlane-cards'));
  await expect(lane(page, 5).locator('[data-eid="2"]')).toBeVisible();
  expect(fixture.rows.find(row => row.id === 1).status.id).toBe(1);
  expect(fixture.rows.find(row => row.id === 3).status.id).toBe(1);
  await lane(page, 5).getByRole('button', { name: 'Plan #2', exact: true }).click();
  await page.getByLabel('Destination').selectOption('backlog');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(lane(page, 5).locator('[data-eid="2"]')).toHaveCount(0);
  await expect(lane(page, 1).locator('[data-eid="3"]')).toBeVisible();
  // A nested qualifying tracker is still an independently removable Card.
  await lane(page, 1).getByRole('button', { name: 'Plan #3', exact: true }).click();
  await page.getByLabel('Destination').selectOption('backlog');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(lane(page, 1).locator('[data-eid="3"]')).toHaveCount(0);
  await expect(lane(page, 5).locator('[data-eid="4"]')).toBeVisible();
});

test('partial group failures report the issue and reload observed memberships without rollback', async ({ page }) => {
  const fixture = await setup(page, 'version', 2); await plan(page);
  await expect(page.locator('#notice')).toContainText('Failed: #2');
  await expect(lane(page, 2).locator('[data-eid="2"]')).toHaveCount(0);
  await expect(lane(page, 5).locator('[data-eid="4"]')).toBeVisible();
  expect(fixture.writes.filter(write => write.patch).length).toBe(5);
  expect(fixture.writes.some(write => write.patch?.fixed_version_id === null)).toBe(false);
});

test('replacement and removal confirmations can cancel without any writes', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows.find(row => row.id === 2).fixed_version = { id: 99 };
  let prompt;
  page.once('dialog', dialog => { prompt = dialog.message(); return dialog.dismiss(); });
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByLabel('Destination').selectOption('sprint');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(prompt).toContain('Replace another target-version Sprint for: #2');
  expect(fixture.writes).toEqual([]);
  await expect(lane(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close editor' }).click();
  await plan(page);
  const count = fixture.writes.length;
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Remove Swimlane #1 from Sprint' }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(fixture.writes.length).toBe(count);
  await expect(lane(page)).toBeVisible();
});

test('filters retain Swimlane context and the title opens Redmine without forwarding the API key', async ({ page }) => {
  await setup(page); await plan(page);
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(lane(page).getByRole('link', { name: '#1 — Parent feature', exact: true })).toBeVisible();
  await expect(page.locator('.kanban-board:not([data-id="backlog"]) .kanban-item')).toHaveCount(0);
  let headers;
  await page.context().route('https://redmine.example.test/issues/1', route => {
    headers = route.request().headers(); return route.fulfill({ contentType: 'text/html', body: '<h1>Parent feature</h1>' });
  });
  const link = lane(page).getByRole('link', { name: '#1 — Parent feature', exact: true });
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.focus().then(() => page.keyboard.press('Enter'))]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe('https://redmine.example.test/issues/1');
  expect(headers['x-redmine-api-key']).toBeUndefined();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
});

test('Card planner creates a subdued Swimlane on a narrow dark viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await setup(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByLabel('Destination').selectOption('sprint');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(lane(page)).toBeVisible();
  await expect(page.locator('#editor')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const darkColor = await lane(page).evaluate(node => getComputedStyle(node).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => lane(page).evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(darkColor);
});

test('Swimlane actions are icon-only, labelled, and right-aligned beside a wrapping title', async ({ page }) => {
  const fixture = await setup(page); await plan(page);
  fixture.rows.find(row => row.id === 1).subject = 'A long parent issue title that wraps without pushing its actions onto a separate row';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add missing descendants of #1' });
  const remove = page.getByRole('button', { name: 'Remove Swimlane #1 from Sprint' });
  await expect(add).toHaveAttribute('title', 'Add missing descendants');
  await expect(remove).toHaveAttribute('title', 'Remove Swimlane from Sprint');
  for (const button of [add, remove]) {
    await expect(button).toHaveText('');
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await lane(page).locator('.swimlane-title-row').evaluate(row => {
      const bounds = row.getBoundingClientRect(), title = row.querySelector('strong').getBoundingClientRect(), actions = row.querySelector('.swimlane-actions').getBoundingClientRect();
      return { rowRight: bounds.right, actionsRight: actions.right, rowTop: bounds.top, actionsTop: actions.top, titleRight: title.right, actionsLeft: actions.left };
    });
    expect(Math.abs(geometry.actionsRight - geometry.rowRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.actionsTop - geometry.rowTop)).toBeLessThanOrEqual(1);
    expect(geometry.actionsLeft).toBeGreaterThan(geometry.titleRight);
  }
  await add.focus();
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
});

test('only the far-right status scrollbar is visible while every status list stays synchronized', async ({ page }) => {
  const fixture = await setup(page);
  const version = fixture.rows.find(row => row.id === 7).fixed_version;
  for (let id = 200; id < 220; id++) {
    fixture.rows.push({ ...fixture.make(id, `Parent ${id}`), tracker: { id: 1, name: 'Feature' }, fixed_version: version });
  }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const lists = page.locator('.kanban-drag.has-swimlanes');
  await expect(lists.first().locator('.swimlane-section')).toHaveCount(21);
  await expect(lists.nth(0)).toHaveCSS('scrollbar-width', 'none');
  await expect(lists.nth(1)).toHaveCSS('scrollbar-width', 'none');
  await expect(lists.last()).toHaveCSS('scrollbar-width', 'auto');
  await expect(page.locator('.kanban-board[data-id="backlog"] .kanban-drag')).toHaveCSS('scrollbar-width', 'auto');
  for (const list of await lists.all()) await expect(list).toHaveCSS('overflow-y', 'auto');

  // Hiding the scrollbar must not disable wheel or keyboard scrolling.
  await lists.first().hover();
  await page.mouse.wheel(0, 260);
  await expect.poll(() => lists.evaluateAll(nodes => nodes.every(node => node.scrollTop > 0 && node.scrollTop === nodes[0].scrollTop))).toBe(true);
  await lists.first().press('End');
  await expect.poll(() => lists.evaluateAll(nodes => nodes.every(node => Math.abs(node.scrollTop - (node.scrollHeight - node.clientHeight)) <= 1))).toBe(true);

  // Moving the visible rightmost scrollbar also updates all hidden-scrollbar lists.
  await lists.last().evaluate(node => { node.scrollTop = 180; });
  await expect.poll(() => lists.evaluateAll(nodes => nodes.every(node => node.scrollTop === 180))).toBe(true);
});

for (const colorScheme of ['light', 'dark']) {
  test(`Swimlane rows alternate neutral shades by position in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const fixture = await setup(page);
    const version = fixture.rows.find(row => row.id === 7).fixed_version;
    // Both IDs are even: striping must follow row position, not issue identity.
    fixture.rows.push(
      { ...fixture.make(10, 'First parent'), tracker: { id: 1, name: 'Feature' }, fixed_version: version },
      { ...fixture.make(12, 'Second parent'), tracker: { id: 4, name: 'Improvement' }, fixed_version: version },
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const rows = page.locator('.kanban-board[data-id="status-1"] .swimlane-section');
    await expect(rows).toHaveCount(3);
    const colors = await rows.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    expect(colors[0]).toBe(colors[2]);
    expect(colors[0]).not.toBe(colors[1]);
    // Theme surfaces are achromatic (or nearly so), not issue-specific pastel hues.
    for (const color of colors) {
      const channels = color.match(/\d+/g).slice(0, 3).map(Number);
      expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(5);
    }
    for (const status of [2, 5]) {
      const other = await page.locator(`.kanban-board[data-id="status-${status}"] .swimlane-section`).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
      expect(other).toEqual(colors);
    }
  });
}
