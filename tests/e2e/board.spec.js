import { test, expect } from '@playwright/test';

async function setup(page, { deny = false, ignored = false, denyVersions = false } = {}) {
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
    if (path === '/users/current.json') return send({ user: { id: 7, firstname: 'Team', lastname: 'Member' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: [...statuses, { id: 8, name: 'Waiting' }] });
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: [{ id: 2, name: 'Normal' }] });
    if (path === '/projects.json') return send({ projects: [{ id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Bug' }] }, { id: 2, name: 'Other project', trackers: [{ id: 1, name: 'Feature' }] }] });
    if (path.endsWith('/memberships.json')) return send({ memberships: [{ user: { id: 7, name: 'Team Member' } }, { user: { id: 9, name: 'Other Member' } }] });
    if (path === '/projects/1/versions.json' && denyVersions) return route.fulfill({ status: 403, json: {} });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (path.startsWith('/versions/')) return send({ version: versions.find(v => v.id === Number(path.match(/\d+/)[0])) });
    if (path === '/issues.json') {
      const version = url.searchParams.get('fixed_version_id'), project = Number(url.searchParams.get('project_id'));
      let selected = issues.filter(issue => issue.project.id === project && (version === '!*' ? !issue.fixed_version && issue.status.id === Number(url.searchParams.get('status_id')) : issue.fixed_version?.id === Number(version)));
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
async function drag(page, id, target) {
  const source = page.locator(`[data-eid="${id}"] h3`), destination = page.locator(`[data-id="${target}"] .kanban-drag`);
  await source.dragTo(destination);
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
    await page.getByText('Board help', { exact: true }).click();
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBe(viewport.height);
    await page.getByRole('button', { name: 'Forget key / Sign out' }).click();
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
  // One search for three keystrokes, restarted at offset 0.
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(10);
  const searches = fixture.requests.filter(request => new URL(request.url()).searchParams.has('subject') && new URL(request.url()).searchParams.get('fixed_version_id') === '!*');
  expect(searches).toHaveLength(1);
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
  await expect(page.locator('#identity')).toContainText('Team Member');
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
  await page.getByRole('button', { name: 'Forget key / Sign out' }).click();
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
  await expect(page.getByLabel('Sprint', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByLabel('Include closed sprints').check();
  await expect(page.getByLabel('Sprint', { exact: true }).locator('option')).toHaveCount(2);
  await page.getByLabel('Sprint', { exact: true }).selectOption('11');
  await expect(page.locator('#sprint-state')).toContainText('read only');
  await page.getByRole('button', { name: 'View #1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(writes).toEqual([]);
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
