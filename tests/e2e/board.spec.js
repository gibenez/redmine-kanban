import { test, expect } from '@playwright/test';

async function setup(page, { deny = false, ignored = false, denyVersions = false, user = { id: 7, firstname: 'Team', lastname: 'Member' } } = {}) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 3, name: 'Review' }, { id: 5, name: 'Done', is_closed: true }];
  const versions = [{ id: 10, name: 'Sprint 10', status: 'open' }, { id: 11, name: 'Sprint 9', status: 'closed' }];
  const base = { tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, allowed_statuses: statuses };
  const issues = [
    { ...base, id: 1, subject: 'Build backlog feature', status: statuses[0], estimated_hours: null },
    { ...base, id: 2, subject: 'Already underway', status: statuses[1], fixed_version: versions[0], assigned_to: { id: 7, name: 'Team Member' }, estimated_hours: 3 },
    { ...base, id: 3, subject: '<img src=x onerror="window.injected=true">', status: statuses[0], estimated_hours: 0 },
    { ...base, id: 4, subject: 'Unmapped status still visible', status: { id: 8, name: 'Waiting' }, fixed_version: versions[0], estimated_hours: null },
  ];
  const writes = [], requests = [];
  await page.route('**/redmine/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/redmine', '');
    requests.push(request);
    const send = data => route.fulfill({ json: data });
    if (path === '/users/current.json') return send({ user });
    if (path === '/issue_statuses.json') return send({ issue_statuses: [...statuses, { id: 8, name: 'Waiting' }] });
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: [{ id: 2, name: 'Normal' }] });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Bug' }] }, { id: 2, name: 'Other project', trackers: [{ id: 1, name: 'Feature' }] }] });
    if (path.endsWith('/memberships.json')) return send({ memberships: [{ user: { id: 7, name: 'Team Member' } }, { user: { id: 9, name: 'Other Member' } }] });
    if (path === '/projects/1/versions.json' && denyVersions) return route.fulfill({ status: 403, json: {} });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (path.startsWith('/versions/')) return send({ version: versions.find(v => v.id === Number(path.match(/\d+/)[0])) });
    if (path === '/issues.json') {
      const version = url.searchParams.get('fixed_version_id'), project = Number(url.searchParams.get('project_id'));
      const status = url.searchParams.get('status_id');
      const unplanned = issue => !issue.fixed_version && (status === 'open' ? !issue.status.is_closed : issue.status.id === Number(status));
      let selected = issues.filter(issue => issue.project.id === project && (version === '!*' ? unplanned(issue) : issue.fixed_version?.id === Number(version)));
      const tracker = url.searchParams.get('tracker_id'), assignee = url.searchParams.get('assigned_to_id'), subject = url.searchParams.get('subject'), issueId = url.searchParams.get('issue_id');
      if (tracker) selected = selected.filter(issue => issue.tracker.id === Number(tracker));
      if (assignee) selected = selected.filter(issue => assignee === '!*' ? !issue.assigned_to : issue.assigned_to?.id === Number(assignee));
      if (subject) selected = selected.filter(issue => issue.subject.toLowerCase().includes(subject.replace(/^~/, '').toLowerCase()));
      if (issueId) selected = selected.filter(issue => issue.id === Number(issueId));
      selected.sort((a, b) => a.id - b.id);
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 25);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (path.startsWith('/issues/')) {
      const issue = issues.find(item => item.id === Number(path.match(/\d+/)[0]));
      if (request.method() === 'GET') return send({ issue });
      const patch = request.postDataJSON().issue; writes.push(patch);
      if (deny) return route.fulfill({ status: 403, json: {} });
      if (!ignored) {
        if ('fixed_version_id' in patch) issue.fixed_version = versions.find(v => v.id === patch.fixed_version_id);
        if ('status_id' in patch) issue.status = statuses.find(s => s.id === patch.status_id);
        if ('estimated_hours' in patch) issue.estimated_hours = patch.estimated_hours;
        if ('assigned_to_id' in patch) issue.assigned_to = patch.assigned_to_id ? { id: 7, name: 'Team Member' } : undefined;
      }
      return route.fulfill({ status: 204, body: '' });
    }
    throw new Error(`Unexpected API path ${path}`);
  });
  return { issues, versions, writes, requests, allowVersions: () => { denyVersions = false; } };
}
async function login(page, remember = false) {
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-personal-key');
  if (remember) await page.getByLabel('Remember API key on this browser').check();
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
}
async function signOut(page) {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}
async function setAppearance(page, mode) {
  const button = page.getByRole('button', { name: /^Appearance:/ });
  for (let step = 0; step < 3 && await button.getAttribute('data-theme') !== mode; step++) await button.click();
  await expect(button).toHaveAttribute('data-theme', mode);
}
async function drag(page, id, target) {
  const source = page.locator(`[data-eid="${id}"] h3`), destination = page.locator(`[data-id="${target}"] .kanban-drag`);
  await source.dragTo(destination);
}

for (const activation of ['click', 'keyboard']) {
  test(`issue ID opens Redmine in a new tab via ${activation}`, async ({ page }) => {
    const fixture = await setup(page);
    await page.route('**/config.json', route => route.fulfill({ json: {
      redminePublicUrl: 'https://redmine.example.test', backlogStatusId: 1,
      columnStatusIds: [1, 2, 3, 5], refreshSeconds: 60,
    } }));
    let navigationHeaders;
    await page.context().route('https://redmine.example.test/issues/1', route => {
      navigationHeaders = route.request().headers();
      return route.fulfill({ contentType: 'text/html', body: '<h1>Redmine issue #1</h1>' });
    });
    await login(page);
    const boardUrl = page.url();
    const link = page.getByRole('link', { name: '#1', exact: true });
    const [issuePage] = await Promise.all([
      page.waitForEvent('popup', { timeout: 2000 }),
      activation === 'click' ? link.click() : link.focus().then(() => page.keyboard.press('Enter')),
    ]);
    await issuePage.waitForLoadState();
    expect(issuePage.url()).toBe('https://redmine.example.test/issues/1');
    expect(await issuePage.evaluate(() => window.opener)).toBeNull();
    expect(navigationHeaders['x-redmine-api-key']).toBeUndefined();
    expect(page.url()).toBe(boardUrl);
    expect(fixture.writes).toEqual([]);
    await expect(page.locator('#editor')).not.toBeVisible();
    await issuePage.close();
  });
}

for (const control of ['query', 'tracker', 'assignee']) {
  test(`${control} updates only matching cards without removing the board`, async ({ page }) => {
    await setup(page); await login(page);
    await page.evaluate(() => {
      window.stableBoard = document.querySelector('.kanban-container');
      window.stableColumns = [...document.querySelectorAll('.kanban-board')];
      window.stableCard = document.querySelector('[data-eid="2"]');
      window.stableHeading = window.stableCard.querySelector('h3');
      window.boardRemovals = 0;
      new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node === window.stableBoard || window.stableColumns.includes(node) || node === window.stableCard) window.boardRemovals++;
        }
      }).observe(document.getElementById('board'), { childList: true, subtree: true });
    });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/redmine/issues.json?**', async route => { await gate; await route.fallback(); });
    if (control === 'query') await page.getByLabel('Find an issue').fill('Already');
    if (control === 'tracker') await page.getByLabel('Tracker', { exact: true }).selectOption('1');
    if (control === 'assignee') await page.getByLabel('Assignee', { exact: true }).selectOption('7');
    try {
      await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'true');
      expect(await page.evaluate(() => window.stableBoard.isConnected && window.stableColumns.every(node => node.isConnected))).toBe(true);
      await expect(page.locator('[data-eid="2"]')).toBeVisible();
    } finally { release(); }
    await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => ({
      sameBoard: window.stableBoard === document.querySelector('.kanban-container'),
      sameColumns: window.stableColumns.every(node => node.isConnected),
      sameCard: window.stableCard === document.querySelector('[data-eid="2"]'),
      sameHeading: window.stableHeading === document.querySelector('[data-eid="2"] h3'),
      removals: window.boardRemovals,
    }))).toEqual({ sameBoard: true, sameColumns: true, sameCard: true, sameHeading: true, removals: 0 });
  });
}

test('unchanged filters preserve column scroll, horizontal scroll, focus and card nodes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  const fixture = await setup(page);
  for (let id = 100; id < 120; id++) fixture.issues.push({ ...fixture.issues[1], id, subject: `Already underway ${id}` });
  await login(page);
  await page.locator('#filter-controls > summary').click();
  await page.evaluate(() => {
    const board = document.getElementById('board'), list = document.querySelector('[data-id="status-2"] .kanban-drag');
    board.scrollLeft = 300; list.scrollTop = 160; list.focus({ preventScroll: true });
    window.position = { x: board.scrollLeft, y: list.scrollTop, list, card: list.firstElementChild };
    document.getElementById('tracker').value = '1';
    document.getElementById('tracker').dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => ({
    x: document.getElementById('board').scrollLeft, y: window.position.list.scrollTop,
    sameFocus: document.activeElement === window.position.list,
    sameCard: window.position.card === window.position.list.firstElementChild,
    expectedX: window.position.x, expectedY: window.position.y,
  }))).toEqual({ x: 300, y: 160, sameFocus: true, sameCard: true, expectedX: 300, expectedY: 160 });
});

test('failed search keeps the confirmed cards and does not page with the previous filter', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id });
  await login(page);
  const before = await page.locator('[data-id="backlog"] .kanban-item').count();
  await page.evaluate(() => { window.confirmedCard = document.querySelector('[data-eid="1"]'); });
  let failedRequests = 0;
  await page.route('**/redmine/issues.json?**', route => { failedRequests++; return route.fulfill({ status: 422, json: { errors: ['Search unavailable'] } }); });
  await page.getByLabel('Find an issue').fill('failed');
  await expect(page.locator('#filtered')).toContainText('showing previous results');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(before);
  expect(await page.evaluate(() => window.confirmedCard.isConnected)).toBe(true);
  const requestsAfterFailure = failedRequests;
  await page.getByLabel('Backlog issues', { exact: true }).evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(failedRequests).toBe(requestsAfterFailure);
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('Previous results');
  await page.unroute('**/redmine/issues.json?**');
  await page.getByLabel('Find an issue').fill('Build');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#filtered')).not.toContainText('unavailable');
});

test('filtered totals appear only with active filters and do not shift the layout', async ({ page }) => {
  await setup(page); await login(page);
  const summary = page.locator('#filtered');
  await expect(summary).toBeEmpty();
  const before = await page.locator('#board').boundingBox();
  const searchBefore = await page.locator('#query').boundingBox();
  const filterRow = await page.locator('.filters').boundingBox();
  const lastFilter = await page.locator('#assignee').boundingBox();
  expect(Math.abs(lastFilter.x + lastFilter.width - filterRow.x - filterRow.width)).toBeLessThanOrEqual(1);
  await page.getByLabel('Find an issue').fill('#2');
  await expect(summary).toContainText('1 issues · 3 h · 0 unestimated');
  await expect(page.locator('#totals')).toContainText('2issues');
  expect(await page.locator('#board').boundingBox()).toEqual(before);
  expect(await page.locator('#query').boundingBox()).toEqual(searchBefore);
  await page.getByLabel('Find an issue').fill('');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toBeEmpty();
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await expect(summary).toContainText('Visible sprint:');
  await page.getByLabel('Tracker', { exact: true }).selectOption('');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toBeEmpty();
  expect(await page.locator('#board').boundingBox()).toEqual(before);
});

test('empty search results do not change the board or column geometry', async ({ page }) => {
  await setup(page); await login(page);
  const before = await page.locator('.kanban-container').boundingBox();
  const columns = await page.locator('.kanban-board').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  await page.getByLabel('Find an issue').fill('No issue can match this');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('.kanban-item')).toHaveCount(0);
  expect(await page.locator('.kanban-container').boundingBox()).toEqual(before);
  expect(await page.locator('.kanban-board').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))).toEqual(columns);
});

test('a delayed old search cannot overwrite newer results', async ({ page }) => {
  await setup(page); await login(page);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const firstRequest = new Promise(resolve => { started = resolve; });
  await page.route('**/redmine/issues.json?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('subject') === '~Build' && params.get('fixed_version_id') === '!*') {
      started(); await gate;
    }
    await route.fallback();
  });
  await page.getByLabel('Find an issue').fill('Build');
  await firstRequest;
  await page.getByLabel('Find an issue').fill('Already');
  try {
    await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
    await expect(page.locator('[data-eid="2"]')).toBeVisible();
  } finally { release(); }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
  await expect(page.getByLabel('Find an issue')).toHaveValue('Already');
});

test('refresh patches changed fields without replacing cards or their controls', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.evaluate(() => {
    window.updatedCard = document.querySelector('[data-eid="2"]');
    window.updatedTitle = window.updatedCard.querySelector('h3');
    window.updatedButton = window.updatedCard.querySelector('.plan');
  });
  fixture.issues[1].subject = 'Updated on Redmine';
  fixture.issues[1].priority = { id: 5, name: 'Urgent' };
  fixture.issues[1].estimated_hours = 8;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('[data-eid="2"] h3')).toHaveText('Updated on Redmine');
  await expect(page.locator('[data-eid="2"]')).toHaveClass(/prio-urgent/);
  await expect(page.locator('[data-eid="2"] .card-footer strong')).toHaveText('8 h');
  expect(await page.evaluate(() => window.updatedCard === document.querySelector('[data-eid="2"]') && window.updatedTitle === window.updatedCard.querySelector('h3') && window.updatedButton === window.updatedCard.querySelector('.plan'))).toBe(true);
});

for (const name of ['High', 'Alta']) {
  test(`priority ${name} has a visibly colored label, not just a muted stripe`, async ({ page }) => {
    const fixture = await setup(page);
    fixture.issues[0].priority = { id: 42, name };
    await login(page);
    const priority = page.locator('[data-eid="1"] .card-field').first();
    const colors = await priority.evaluate(node => ({
      text: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor,
      neutral: getComputedStyle(node.parentElement).color,
      stripe: getComputedStyle(node.closest('.kanban-item')).borderLeftColor,
      fallback: getComputedStyle(node.closest('.kanban-item')).getPropertyValue('--priority-none').trim(),
    }));
    expect(colors.text).not.toBe(colors.neutral);
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('[data-eid="1"]')).toHaveClass(/prio-high/);
  });
}

test('column heading text, counts and scope controls share the same vertical center', async ({ page }) => {
  await setup(page); await login(page);
  const headers = await page.locator('.kanban-board header').evaluateAll(nodes => nodes.map(header => {
    const title = header.querySelector('.kanban-title-board');
    const range = document.createRange(); range.selectNodeContents(title.firstChild);
    const text = range.getBoundingClientRect(), bounds = header.getBoundingClientRect();
    const count = header.querySelector('.count')?.getBoundingClientRect();
    const toggle = header.querySelector('.scope-toggle')?.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height, center: bounds.top + bounds.height / 2,
      textCenter: text.top + text.height / 2,
      countCenter: count ? count.top + count.height / 2 : null,
      toggleCenter: toggle ? toggle.top + toggle.height / 2 : null };
  }));
  for (const header of headers) {
    expect(header.top).toBe(headers[0].top);
    expect(header.height).toBe(headers[0].height);
    expect(Math.abs(header.textCenter - headers[0].textCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(header.textCenter - header.center)).toBeLessThanOrEqual(1);
    if (header.countCenter != null) expect(Math.abs(header.countCenter - header.center)).toBeLessThanOrEqual(1);
    if (header.toggleCenter != null) expect(Math.abs(header.toggleCenter - header.center)).toBeLessThanOrEqual(1);
  }
});

test('topbar help is keyboard-accessible before login and returns focus on Escape', async ({ page }) => {
  await page.goto('/');
  const help = page.getByRole('banner').getByRole('button', { name: 'Help', exact: true });
  await expect(help).toHaveText('?');
  await help.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Sprint board · Quick guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close help', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).not.toBeVisible();
  await expect(help).toBeFocused();
});

for (const theme of ['light', 'dark']) {
  test(`mini guide fits a narrow ${theme} viewport without changing the board`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 650 });
    await page.emulateMedia({ colorScheme: theme });
    const fixture = await setup(page); await login(page);
    await expect(page.locator('.board-help')).toHaveCount(0);
    const board = await page.locator('.kanban-container').elementHandle();
    const before = await page.locator('#board').boundingBox();
    const help = page.getByRole('button', { name: 'Help', exact: true });
    await expect(help).toBeInViewport(); await help.click();
    const guide = page.getByRole('dialog', { name: 'Sprint board · Quick guide' });
    await expect(guide).toBeVisible(); await expect(guide).toBeInViewport();
    await expect(guide).toContainText('Drag a Card');
    await expect(page.locator('#build-help')).not.toBeVisible();
    await expect(guide).toHaveCSS('background-color', theme === 'dark' ? 'rgb(30, 31, 34)' : 'rgb(255, 255, 255)');
    const geometry = await guide.boundingBox();
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(390);
    expect(geometry.y + geometry.height).toBeLessThanOrEqual(650);
    await page.getByRole('button', { name: 'Close help', exact: true }).click();
    await expect(help).toBeFocused();
    expect(await board.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.locator('#board').boundingBox()).toEqual(before);
    expect(fixture.writes).toEqual([]);
  });
}

test('dark mode follows the system preference on login, board and dialogs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await setup(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('#login')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await expect(page.getByLabel('Personal API key')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await page.getByLabel('Personal API key').fill('test-personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('.summary')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await expect(page.locator('.kanban-item').first()).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await expect(page.locator('#project')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#editor')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.route('**/redmine/issues.json?**', route => route.fulfill({ status: 422, json: { errors: ['A theme test error'] } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#notice.error')).toContainText('A theme test error');
  await expect(page.locator('#notice')).toHaveCSS('color', 'rgb(255, 188, 170)');
  await expect(page.locator('#notice')).toHaveCSS('background-color', 'rgb(56, 37, 31)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('.summary')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#notice')).toHaveCSS('background-color', 'rgb(255, 235, 236)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.summary')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
});

for (const theme of ['light', 'dark']) {
  test(`initials avatar opens a dismissible account popover in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 650 });
    await page.emulateMedia({ colorScheme: theme });
    const fixture = await setup(page, { user: { id: 7, firstname: 'Giacomo', lastname: 'Benedetti' } });
    await login(page, true);
    const avatar = page.getByRole('button', { name: 'Account: Giacomo Benedetti', exact: true });
    const popover = page.getByRole('dialog', { name: 'Account', exact: true });
    await expect(avatar).toHaveText('GB');
    await expect(avatar).toBeInViewport();
    await expect(page.locator('#user-name')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).not.toBeVisible();
    const before = await page.locator('#board').boundingBox();
    await avatar.click();
    await expect(popover).toBeVisible();
    await expect(avatar).toHaveAttribute('aria-expanded', 'true');
    await expect(popover).toContainText('Giacomo Benedetti');
    await expect(popover).toHaveCSS('background-color', theme === 'dark' ? 'rgb(30, 31, 34)' : 'rgb(255, 255, 255)');
    const bounds = await popover.boundingBox(), anchor = await avatar.boundingBox();
    expect(Math.abs(bounds.x + bounds.width - anchor.x - anchor.width)).toBeLessThanOrEqual(1);
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(650);
    expect(await page.locator('#board').boundingBox()).toEqual(before);
    await page.getByRole('heading', { name: 'Sprint board', exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(avatar).toHaveAttribute('aria-expanded', 'false');
    await avatar.focus(); await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
    await expect(avatar).toBeFocused();
    await signOut(page);
    await expect(page.getByLabel('Personal API key')).toBeFocused();
    await expect(page.locator('#identity')).not.toBeVisible();
    await expect(popover).not.toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.api-key'))).toBeNull();
    expect(fixture.writes).toEqual([]);
  });
}

for (const [user, initials] of [
  [{ id: 7, firstname: 'Giacomo Andrea', lastname: 'Benedetti' }, 'GB'],
  [{ id: 7, login: 'giacomo.benedetti' }, 'GB'],
  [{ id: 7, firstname: 'Giacomo' }, 'G'],
]) {
  test(`account initials use first and last names or login: ${JSON.stringify(user)}`, async ({ page }) => {
    await setup(page, { user }); await login(page);
    await expect(page.locator('#user-avatar')).toHaveText(initials);
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 650 }]) {
  test(`refresh lives in the topbar and last update in a thin bottom bar at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    await page.goto('/');
    await expect(page.locator('#refresh')).not.toBeVisible();
    await expect(page.locator('#statusbar')).not.toBeVisible();
    await login(page);
    const refresh = page.getByRole('banner').getByRole('button', { name: 'Refresh', exact: true });
    const statusbar = page.getByRole('contentinfo', { name: 'Board status' });
    await expect(refresh).toBeInViewport();
    await expect(refresh).toHaveText('');
    await expect(refresh.locator('svg')).toBeVisible();
    await expect(page.locator('.toolbar #refresh, .toolbar #updated')).toHaveCount(0);
    await expect(statusbar).toContainText('Updated');
    const status = await statusbar.boundingBox(), board = await page.locator('#board').boundingBox();
    expect(status.height).toBe(24);
    expect(status.x).toBe(0); expect(status.width).toBe(viewport.width);
    expect(status.y + status.height).toBe(viewport.height);
    expect(board.y + board.height).toBeLessThanOrEqual(status.y);
    const previousUpdate = await page.locator('#updated').textContent();
    const previousRequests = fixture.requests.length;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/redmine/issues.json?**', async route => { await gate; await route.fallback(); });
    await refresh.click();
    try {
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#updated')).toHaveText(previousUpdate);
      expect(await statusbar.boundingBox()).toEqual(status);
    } finally { release(); }
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveAttribute('aria-busy', 'false');
    expect(fixture.requests.length).toBeGreaterThan(previousRequests);
    expect(fixture.writes).toEqual([]);
    await signOut(page);
    await expect(refresh).not.toBeVisible();
    await expect(statusbar).not.toBeVisible();
    await expect(page.locator('#updated')).toBeEmpty();
  });
}

test('appearance overrides the OS, persists, and returns to live system mode', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const appearance = page.getByRole('button', { name: /^Appearance:/ });
  const bounds = await appearance.boundingBox();
  await expect(appearance).toHaveAttribute('data-theme', 'system');
  await expect(appearance).toHaveAccessibleName('Appearance: System. Switch to Light');
  await expect(appearance.locator('[data-theme-icon]:not([hidden])')).toHaveAttribute('data-theme-icon', 'system');
  await expect(appearance.locator('select')).toHaveCount(0);
  await appearance.focus(); await page.keyboard.press('Space');
  await expect(appearance).toHaveAccessibleName('Appearance: Light. Switch to Dark');
  await expect(appearance.locator('[data-theme-icon]:not([hidden])')).toHaveAttribute('data-theme-icon', 'light');
  expect(await appearance.boundingBox()).toEqual(bounds);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(appearance).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await appearance.click();
  await expect(appearance).toHaveAccessibleName('Appearance: Dark. Switch to System');
  await expect(appearance.locator('[data-theme-icon]:not([hidden])')).toHaveAttribute('data-theme-icon', 'dark');
  expect(await appearance.boundingBox()).toEqual(bounds);
  await page.reload();
  await expect(appearance).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await appearance.focus(); await page.keyboard.press('Enter');
  await expect(appearance).toHaveAccessibleName('Appearance: System. Switch to Light');
  await expect(appearance.locator('[data-theme-icon]:not([hidden])')).toHaveAttribute('data-theme-icon', 'system');
  expect(await appearance.boundingBox()).toEqual(bounds);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.theme'))).toBeNull();
});

test('appearance works without storage and ignores invalid stored preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('redmine-sprint-board.theme', 'invalid');
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
    Storage.prototype.removeItem = () => { throw new Error('Storage unavailable'); };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Appearance:/ })).toHaveAttribute('data-theme', 'system');
  await setAppearance(page, 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await setAppearance(page, 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
});

for (const mode of ['light', 'dark']) {
  test(`Redmine logo is served locally and stays compact in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 650 });
    await page.emulateMedia({ colorScheme: mode });
    await setup(page); await login(page);
    const logo = page.getByRole('banner').getByRole('img', { name: 'Redmine', exact: true });
    await expect(logo).toBeInViewport();
    await expect(logo).toHaveAttribute('src', '/branding/redmine-logo.png');
    await expect.poll(() => logo.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    await expect(logo).toHaveCSS('width', '32px');
    await expect(logo).toHaveCSS('height', '32px');
    await expect(page.locator('.brand-mark')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBe(390);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(logo).toBeInViewport();
    await expect(logo).toHaveCSS('width', '32px');
  });
}

test('dropdowns retain the native arrow in forced-colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await setup(page); await login(page);
  await expect(page.locator('#project')).toHaveCSS('appearance', 'auto');
  await expect(page.locator('#project')).toHaveCSS('background-image', 'none');
});

for (const mode of ['light', 'dark']) {
  test(`dropdown chevrons have consistent inset spacing in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    await setup(page); await login(page);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    for (const id of ['project', 'sprint', 'tracker', 'assignee', 'edit-assignee', 'edit-status', 'edit-destination']) {
      const style = await page.locator(`#${id}`).evaluate(node => {
        const css = getComputedStyle(node);
        return { appearance: css.appearance, padding: css.paddingRight, left: css.paddingLeft,
          image: css.backgroundImage, position: css.backgroundPositionX, size: css.backgroundSize };
      });
      expect(style.appearance).toBe('none');
      expect(style.padding).toBe('32px'); expect(style.left).toBe('8px');
      expect(style.position).toContain('10px'); expect(style.size).toBe('12px 12px');
      expect(style.image).toContain(mode === 'dark' ? '9da0a8' : '6c707e');
    }
    await expect(page.locator('#editor')).toBeVisible();
    await page.locator('#edit-status').selectOption('2');
    await expect(page.locator('#edit-status')).toHaveValue('2');
    await page.getByRole('button', { name: 'Close editor' }).click();
  });

  test(`Alta is red, Media yellow and Bassa green in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    ['Alta', 'Media', 'Bassa', 'Normale'].forEach((name, index) => { fixture.issues[index].priority = { id: index + 40, name }; });
    await login(page);
    const colors = mode === 'light'
      ? ['rgb(220, 71, 71)', 'rgb(224, 181, 27)', 'rgb(60, 155, 85)']
      : ['rgb(239, 116, 116)', 'rgb(226, 195, 77)', 'rgb(106, 191, 123)'];
    for (let index = 0; index < 3; index++) {
      await expect(page.locator(`[data-eid="${index + 1}"]`)).toHaveCSS('border-left-color', colors[index]);
    }
    // Normal/Normale and Medium/Media represent the same middle tier.
    await expect(page.locator('[data-eid="4"]')).toHaveCSS('border-left-color', colors[1]);
  });

  test(`cards keep priority colors consistent and metadata aligned in ${mode} mode`, async ({ page }) => {
    const fixture = await setup(page);
    const names = ['Low', 'Normal', 'High', 'Urgent', 'Immediate', 'Custom priority'];
    names.forEach((name, index) => fixture.issues.push({ ...fixture.issues[0], id: 100 + index,
      subject: `Issue with ${name.toLowerCase()} priority`, priority: { id: 100 + index, name },
      assigned_to: { id: 9, name: 'Alexandra Example With A Very Long Name' } }));
    await login(page);
    await setAppearance(page, mode);
    const colors = [];
    for (let index = 0; index < names.length; index++) {
      const card = page.locator(`[data-eid="${100 + index}"]`);
      await expect(card).toBeVisible();
      const geometry = await card.evaluate(node => {
        const field = node.querySelector('.card-field');
        const assignee = node.querySelector('.card-assignee').getBoundingClientRect();
        const hours = node.querySelector('.card-footer strong').getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
          value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const ink = luminance(getComputedStyle(field).color), fill = luminance(getComputedStyle(field).backgroundColor);
        return { contrast: (Math.max(ink, fill) + .05) / (Math.min(ink, fill) + .05), stripe: getComputedStyle(node).borderLeftColor, dot: getComputedStyle(field, '::before').backgroundColor,
          assigneeRight: assignee.right, hoursLeft: hours.left, hoursRight: hours.right, cardRight: bounds.right };
      });
      expect(geometry.dot).toBe(geometry.stripe);
      expect(geometry.contrast).toBeGreaterThanOrEqual(4.5);
      expect(geometry.assigneeRight).toBeLessThanOrEqual(geometry.hoursLeft);
      expect(geometry.hoursRight).toBeLessThan(geometry.cardRight);
      colors.push(geometry.stripe);
    }
    expect(new Set(colors.slice(0, 5)).size).toBe(5);
    const fallback = await page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--priority-none').trim());
    expect(colors[5]).toBe(await page.evaluate(color => {
      const node = document.createElement('span'); node.style.color = color; document.body.append(node);
      const value = getComputedStyle(node).color; node.remove(); return value;
    }, fallback));
    await expect(page.locator('[data-id="status-2"] .kanban-title-board')).toHaveCSS('display', 'flex');
    expect(fixture.writes).toEqual([]);
    if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: `/tmp/sprint-board-${mode}.png` });
  });
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 1000 }]) {
  test(`board fits ${viewport.width}×${viewport.height} with independently scrolling columns`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    for (let id = 100; id < 112; id++) fixture.issues.push({ ...fixture.issues[1], id, subject: `Long status issue ${id} ${'wrapped content '.repeat(12)}` });
    for (let id = 200; id < 206; id++) fixture.issues.push({ ...fixture.issues[0], id });
    await login(page);
    const toolbar = await page.locator('.planning-row .toolbar').boundingBox();
    const commitment = page.getByRole('region', { name: 'Sprint commitment' });
    const summary = await commitment.boundingBox();
    expect(summary.y).toBe(toolbar.y);
    expect(summary.x).toBeGreaterThanOrEqual(toolbar.x + toolbar.width);
    await expect(commitment).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const geometry = await page.evaluate(() => {
      const root = document.scrollingElement, board = document.getElementById('board');
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; };
      return { pageWidth: root.scrollWidth, pageHeight: root.scrollHeight, boardWidth: board.clientWidth, boardScrollWidth: board.scrollWidth,
        columns: [...board.querySelectorAll('.kanban-board')].map(rect),
        controls: ['project', 'sprint', 'query', 'tracker', 'assignee', 'totals', 'identity', 'backlog-more'].map(id => document.getElementById(id)).filter(Boolean).map(rect) };
    });
    expect(geometry.pageWidth).toBe(viewport.width);
    expect(geometry.pageHeight).toBe(viewport.height);
    expect(geometry.boardScrollWidth).toBeLessThanOrEqual(geometry.boardWidth);
    for (const rect of [...geometry.columns, ...geometry.controls]) {
      expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.top).toBeGreaterThanOrEqual(0); expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
      expect(rect.height).toBeGreaterThan(0);
    }
    const status = page.locator('[data-id="status-2"] .kanban-drag');
    await status.focus(); await page.keyboard.press('PageDown');
    await expect.poll(() => status.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
    const header = page.locator('[data-id="status-2"] header');
    const before = await header.boundingBox();
    await status.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await header.boundingBox()).toEqual(before);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBe(viewport.height);
    await page.getByRole('button', { name: 'Close help', exact: true }).click();
    await signOut(page);
    await expect(page.locator('body')).not.toHaveClass(/board-active/);
  });
}

test('long notices keep the board usable and expose the complete message', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page); await login(page);
  const message = 'Detailed upstream explanation. '.repeat(60);
  await page.route('**/redmine/issues.json?**', route => route.fulfill({ status: 422, json: { errors: [message] } }));
  await page.getByLabel('Find an issue').fill('failed search');
  await page.getByRole('button', { name: 'Full message', exact: true }).click();
  await expect(page.locator('#notice-dialog')).toBeVisible();
  await expect(page.locator('#notice-message')).toContainText(message.trim());
  await page.getByRole('button', { name: 'Close message' }).click();
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBe(720);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport();
});

test('compact board exposes filters and allows board-only horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await setup(page); await login(page);
  await expect(page.getByLabel('Find an issue')).not.toBeVisible();
  await page.locator('#filter-controls > summary').click();
  await expect(page.getByLabel('Find an issue')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.scrollingElement.scrollWidth, height: document.scrollingElement.scrollHeight,
    boardWidth: document.getElementById('board').clientWidth, boardScrollWidth: document.getElementById('board').scrollWidth,
  }));
  expect(dimensions.width).toBe(800); expect(dimensions.height).toBe(650);
  expect(dimensions.boardScrollWidth).toBeGreaterThan(dimensions.boardWidth);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByLabel('Find an issue')).toBeVisible();
  await expect(page.locator('#filter-controls > summary')).not.toBeVisible();
});

test('phone layout keeps appearance, planning controls and board inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await login(page);
  await expect(page.getByRole('button', { name: /^Appearance:/ })).toBeInViewport();
  await expect(page.getByLabel('Project', { exact: true })).toBeInViewport();
  await expect(page.getByLabel('Sprint', { exact: true })).toBeInViewport();
  const geometry = await page.evaluate(() => ({
    pageWidth: document.scrollingElement.scrollWidth, pageHeight: document.scrollingElement.scrollHeight,
    boardHeight: document.getElementById('board').clientHeight,
  }));
  expect(geometry.pageWidth).toBe(390);
  expect(geometry.pageHeight).toBe(844);
  expect(geometry.boardHeight).toBeGreaterThan(200);
});

test('backlog requests one column-sized page, not every page', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const requests = fixture.requests.filter(request => new URL(request.url()).searchParams.get('fixed_version_id') === '!*');
  // One request, sized to the visible column: more than the old fixed five, far short of 32.
  expect(requests).toHaveLength(1);
  const limit = Number(new URL(requests[0].url()).searchParams.get('limit'));
  expect(limit).toBeGreaterThan(5);
  expect(limit).toBeLessThan(32);
  await expect(count).toHaveCount(limit);
  // Sized to overflow, so scrolling can take over from here.
  expect(await column.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('Scroll to load more');
});

test('server search finds a backlog issue beyond the loaded page', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: id === 109 ? 'Unseen needle' : `Backlog ${id}` });
  await login(page);
  await page.getByLabel('Find an issue').fill('needle');
  await expect.poll(() => fixture.requests.some(request => new URL(request.url()).searchParams.get('subject') === '~needle')).toBe(true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await expect(page.locator('[data-id="backlog"]')).toContainText('Unseen needle');
});

test('scrolling appends another page without duplicates or reloading metadata', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const metadataCount = fixture.requests.filter(request => new URL(request.url()).pathname.endsWith('/versions.json')).length;
  const firstPage = Number(new URL(fixture.requests.filter(request => new URL(request.url()).searchParams.get('fixed_version_id') === '!*')[0].url()).searchParams.get('limit'));
  await expect(count).toHaveCount(firstPage);
  await column.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await column.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(count).toHaveCount(12);
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('All matching backlog issues loaded');
  const ids = await count.evaluateAll(elements => elements.map(element => element.dataset.eid));
  expect(new Set(ids).size).toBe(12);
  const requests = fixture.requests.filter(request => new URL(request.url()).searchParams.get('fixed_version_id') === '!*');
  // The second page continues from where the first stopped rather than refetching it.
  expect(requests.map(request => new URL(request.url()).searchParams.get('offset'))).toEqual(['0', String(firstPage)]);
  expect(fixture.requests.filter(request => new URL(request.url()).pathname.endsWith('/versions.json'))).toHaveLength(metadataCount);
});

test('tracker and assignee filters query unseen issues on the server and preserve sprint totals', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: id === 109 ? 'Unseen needle' : `Backlog ${id}`, ...(id === 109 ? { tracker: { id: 2, name: 'Bug' }, assigned_to: { id: 9, name: 'Other Member' } } : {}) });
  await login(page);
  await page.getByLabel('Tracker', { exact: true }).selectOption('2');
  await expect(page.locator('[data-id="backlog"]')).toContainText('Unseen needle');
  await page.getByLabel('Assignee', { exact: true }).selectOption('9');
  await page.getByLabel('Find an issue').fill('needle');
  await expect.poll(() => fixture.requests.some(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('subject') === '~needle' && params.get('tracker_id') === '2' && params.get('assigned_to_id') === '9' && params.get('fixed_version_id') === '!*';
  })).toBe(true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await expect(page.locator('#totals')).toContainText('2issues');
  await expect(page.locator('#filtered')).toContainText('0 issues');
  const filteredSprintRequests = fixture.requests.filter(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('fixed_version_id') === '10' && params.get('subject') === '~needle' && params.get('tracker_id') === '2' && params.get('assigned_to_id') === '9';
  });
  expect(filteredSprintRequests).toHaveLength(1);
  const fullSprintRequests = fixture.requests.filter(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('fixed_version_id') === '10' && !params.has('tracker_id') && !params.has('assigned_to_id') && !params.has('subject');
  });
  expect(fullSprintRequests).toHaveLength(1);
});

test('search is debounced and resets the backlog cursor', async ({ page }) => {
  await page.clock.install();
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Needle ${id}` });
  await login(page);
  await expect(page.locator('[data-id="backlog"] .kanban-item').first()).toBeVisible();
  await page.getByLabel('Find an issue').fill('n');
  await page.getByLabel('Find an issue').fill('nee');
  await page.getByLabel('Find an issue').fill('needle');
  await page.clock.runFor(350);
  // One search for three keystrokes, restarted at offset 0. The stable board lets
  // pagination measure real Cards rather than falling back to an empty-board estimate.
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  const searches = fixture.requests.filter(request => new URL(request.url()).searchParams.has('subject') && new URL(request.url()).searchParams.get('fixed_version_id') === '!*');
  expect(searches).toHaveLength(1);
  const limit = Number(new URL(searches[0].url()).searchParams.get('limit'));
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(Math.min(10, limit));
  expect(new URL(searches[0].url()).searchParams.get('subject')).toBe('~needle');
  expect(new URL(searches[0].url()).searchParams.get('offset')).toBe('0');
});

test('a failed lazy page can be retried without skipping issues', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  let failed = false;
  await page.route('**/redmine/issues.json?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('fixed_version_id') === '!*' && params.get('offset') !== '0' && !failed) { failed = true; return route.fulfill({ status: 503, json: {} }); }
    return route.fallback();
  });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const firstPage = await count.count();
  await column.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('#notice')).toContainText('Could not load more backlog issues');
  await expect(count).toHaveCount(firstPage);
  // Scrolling cannot retry from the bottom of the column, so an explicit control appears.
  await page.getByRole('button', { name: 'Retry loading issues', exact: true }).click();
  await expect.poll(() => count.count()).toBeGreaterThan(firstPage);
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry loading issues', exact: true })).toBeHidden();
  const ids = await count.evaluateAll(elements => elements.map(element => element.dataset.eid));
  expect(new Set(ids).size).toBe(ids.length);
});

test('a successful planning move resets pagination before fetching the next page', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const firstPage = await count.count();
  await column.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => count.count()).toBeGreaterThan(firstPage);
  await drag(page, 1, 'status-2');
  // The confirmation survives the reload that follows the write.
  await expect(page.locator('#notice')).toContainText('Issue #1 saved');
  // Back to a single column-sized page with the cursor reset. The page is measured again,
  // so it need not match the first exactly: the notice row costs the column some height.
  await expect.poll(() => count.count()).toBeLessThan(firstPage * 2);
  const reset = await count.count();
  await expect(page.locator('[data-id="backlog"] .count')).toHaveText(`${reset} / 31`);
  await column.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => count.count()).toBeGreaterThan(reset);
  const ids = await count.evaluateAll(elements => elements.map(element => element.dataset.eid));
  expect(new Set(ids).size).toBe(ids.length); expect(ids).not.toContain('1');
});

test('project versions 403 explains the denied resource and keeps project selection usable', async ({ page }) => {
  const fixture = await setup(page, { denyVersions: true });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.getByRole('button', { name: 'Account: Team Member', exact: true })).toBeVisible();
  await expect(page.locator('#notice')).toContainText('Cannot load sprints for project');
  await expect(page.locator('#notice')).toContainText('Issue tracking');
  expect(fixture.requests.some(request => new URL(request.url()).pathname === '/redmine/projects/1/versions.json')).toBe(true);
  await expect(page.locator('#sprint-name')).toContainText('Sprint data unavailable');
  await expect(page.getByLabel('Project', { exact: true })).toBeEnabled();
  await page.getByLabel('Project', { exact: true }).selectOption('2');
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#notice')).not.toContainText('Cannot load sprints');
});

test('versions 403 pauses polling but manual Refresh retries after permissions change', async ({ page }) => {
  await page.clock.install();
  const fixture = await setup(page, { denyVersions: true });
  const count = () => fixture.requests.filter(request => new URL(request.url()).pathname === '/redmine/projects/1/versions.json').length;
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#notice')).toContainText('Cannot load sprints');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.clock.runFor(125000);
  expect(count()).toBe(1);
  fixture.allowVersions();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#notice')).toBeHidden();
  expect(count()).toBe(2);
});

test('loads backlog, all sprint statuses and totals without executing issue HTML', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = await setup(page); await login(page);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(2);
  await expect(page.locator('[data-id="status-2"]')).toContainText('Already underway');
  await expect(page.locator('[data-id="other"]')).toContainText('Unmapped status still visible');
  await expect(page.locator('#totals')).toContainText('3estimated hours');
  await page.getByLabel('Find an issue').fill('#2');
  await expect(page.locator('#filtered')).toContainText('1 issues · 3 h · 0 unestimated');
  await expect(page.locator('#totals')).toContainText('2issues');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(errors).toEqual([]);
  expect(fixture.requests.every(request => request.headers()['x-redmine-api-key'] === 'test-personal-key')).toBe(true);
  expect(fixture.requests.every(request => !request.url().includes('test-personal-key'))).toBe(true);
});

test('keyboard-accessible planner changes sprint, assignee and estimate', async ({ page }) => {
  const { writes } = await setup(page); await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByLabel('Assignment', { exact: true }).selectOption('7');
  await page.getByLabel('Estimated hours', { exact: true }).fill('5.5');
  await page.getByLabel('Planning destination').selectOption('sprint');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('[data-id="status-1"]')).toContainText('Build backlog feature');
  expect(writes).toEqual([{ assigned_to_id: 7, estimated_hours: 5.5, fixed_version_id: 10 }]);
});

for (const statusId of [1, 2]) {
  test(`drag from backlog into status ${statusId} commits work and only changes necessary fields`, async ({ page }) => {
    const { writes } = await setup(page); await login(page);
    await drag(page, 1, `status-${statusId}`);
    await expect(page.locator('#notice')).toContainText('Issue #1 saved');
    await expect(page.locator(`[data-id="status-${statusId}"] [data-eid="1"]`)).toBeVisible();
    expect(writes).toEqual([statusId === 1 ? { fixed_version_id: 10 } : { fixed_version_id: 10, status_id: 2 }]);
  });
}

test('removing in-progress work does not reset its status', async ({ page }) => {
  const { writes } = await setup(page); await login(page);
  await drag(page, 2, 'backlog');
  await expect(page.locator('#notice')).toContainText('Its status is not the backlog status');
  await expect(page.locator('[data-eid="2"]')).toHaveCount(0);
  expect(writes).toEqual([{ fixed_version_id: null }]);
});

test('rejected writes restore the card and expose permission errors', async ({ page }) => {
  await setup(page, { deny: true }); await login(page);
  await drag(page, 1, 'status-2');
  await expect(page.locator('#notice')).toContainText('Redmine denied');
  await expect(page.locator('[data-id="backlog"] [data-eid="1"]')).toBeVisible();
});

for (const statusId of [1, 2]) {
  test(`detects silent permission-based field rejection moving backlog into status ${statusId}`, async ({ page }) => {
    const { writes } = await setup(page, { ignored: true }); await login(page);
    await drag(page, 1, `status-${statusId}`);
    await expect(page.locator('#notice')).toContainText('did not retain all requested changes');
    await expect(page.locator('[data-id="backlog"] [data-eid="1"]')).toBeVisible();
    expect(writes).toEqual([statusId === 1 ? { fixed_version_id: 10 } : { fixed_version_id: 10, status_id: 2 }]);
  });
}

test('remembers only with consent and forgets the key on signout', async ({ page }) => {
  await setup(page); await login(page, true);
  expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.api-key'))).toBe('test-personal-key');
  await page.reload(); await expect(page.locator('#updated')).toContainText('Updated');
  await signOut(page);
  await expect(page.getByLabel('Personal API key')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.api-key'))).toBeNull();
  await page.reload(); await expect(page.getByLabel('Personal API key')).toBeVisible();
});

test('does not persist the key without consent', async ({ page }) => {
  await setup(page); await login(page);
  expect(await page.evaluate(() => localStorage.getItem('redmine-sprint-board.api-key'))).toBeNull();
});

test('closed sprints are opt-in and read only', async ({ page }) => {
  const { writes } = await setup(page); await login(page);
  const container = await page.locator('.kanban-container').elementHandle();
  await expect(page.getByLabel('Sprint', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByLabel('Include closed sprints').check();
  await expect(page.getByLabel('Sprint', { exact: true }).locator('option')).toHaveCount(2);
  expect(await container.evaluate(node => node.isConnected)).toBe(true);
  await page.getByLabel('Sprint', { exact: true }).selectOption('11');
  await expect(page.locator('#sprint-state')).toContainText('read only');
  expect(await container.evaluate(node => node.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'View #1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(writes).toEqual([]);
});

test('widening the backlog scope opts in to open unplanned issues, and is remembered', async ({ page }) => {
  const fixture = await setup(page);
  const unplanned = { tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, estimated_hours: null };
  fixture.issues.push(
    { ...unplanned, id: 5, subject: 'Unplanned, in progress', status: { id: 2, name: 'Open' } },
    { ...unplanned, id: 6, subject: 'Unplanned and done', status: { id: 5, name: 'Done', is_closed: true } },
  );
  await login(page, true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(2);
  // The control lives in the Backlog column header, not the toolbar.
  const toggle = page.locator('[data-id="backlog"] .scope-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toHaveAttribute('title', /only the New status/);
  await toggle.click();
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
  // Widening admits OPEN unplanned issues only.
  await expect(page.locator('[data-eid="6"]')).toHaveCount(0);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('[data-id="backlog"] .scope-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
});

test('the backlog scope is not a filter and survives clearing a search', async ({ page }) => {
  const fixture = await setup(page);
  fixture.issues.push({ id: 5, subject: 'Unplanned, in progress', status: { id: 2, name: 'Open' }, tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, estimated_hours: null });
  await login(page);
  await page.getByLabel('Show all unplanned').click();
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
  await page.getByLabel('Find an issue').fill('underway');
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toHaveCount(0);
  await page.getByLabel('Find an issue').fill('');
  await expect(page.getByLabel('Show all unplanned')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
});

test('project changes clear the previous project’s issues', async ({ page }) => {
  await setup(page); await login(page);
  await page.getByLabel('Project', { exact: true }).selectOption('2');
  await expect(page.locator('.kanban-item')).toHaveCount(0);
});

test('forbidden workflow transitions never issue a write', async ({ page }) => {
  const fixture = await setup(page); fixture.issues[0].allowed_statuses = [{ id: 1, name: 'New' }];
  await login(page); await drag(page, 1, 'status-2');
  await expect(page.locator('#notice')).toContainText('workflow does not allow');
  await expect(page.locator('[data-id="backlog"] [data-eid="1"]')).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('a sprint closed after loading is checked again before writing', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  fixture.versions[0].status = 'closed';
  await drag(page, 1, 'status-2');
  await expect(page.locator('#notice')).toContainText('no longer open');
  expect(fixture.writes).toEqual([]);
});

test('saving an unchanged issue does not send read-only fields back to Redmine', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.getByRole('button', { name: 'Plan #2', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('save errors are also announced inside the planning dialog', async ({ page }) => {
  await setup(page, { deny: true }); await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByLabel('Estimated hours', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#editor-notice')).toContainText('Redmine denied');
  await expect(page.getByRole('dialog')).toBeVisible();
});
