import { test, expect } from '@playwright/test';

// Own Redmine boundary: board discovery and editor discovery deliberately share
// the server, not a client cache. Targets live outside the board's issue lists.
async function setup(page) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }];
  const feature = { id: 1, name: 'Feature' }, task = { id: 2, name: 'Task' };
  const projects = [{ id: 1, name: 'Product', trackers: [feature, task] }];
  const versions = [{ id: 100, name: 'Sprint 100', status: 'open', project: { id: 1 }, sharing: 'descendants' }];
  const make = (id, tracker, values, parent) => ({
    id, subject: `Issue ${id}`, description: 'Original description', tracker,
    project: { id: 1, name: 'Product' }, status: statuses[0], priority: { id: 2, name: 'Normal' },
    custom_fields: [{ id: 7, multiple: true, value: values }], allowed_statuses: statuses,
    ...(parent ? { parent: { id: parent } } : {}),
  });
  const rows = [make(10, feature, ['100']), make(20, task, ['100'], 10),
    make(21, task, ['100']), make(30, feature, [])];
  const state = {
    rows, targets: new Map([90, 91, 92].map(id => [id, make(id, task, [])])),
    relations: new Map(), relationRequests: [], issueRequests: [], writes: [],
    // Optional handlers let individual tests hold or fail precisely one read.
    onRelations: null, onIssue: null,
  };
  await page.route('**/config.json', route => route.fulfill({ json: {
    openedStatusId: 2, sprintFieldId: 7, redminePublicUrl: 'https://redmine.example.test',
    backlogStatusId: 1, columnStatusIds: [1, 2, 5], swimlaneTrackers: ['Feature'],
  } }));
  await page.route('**/redmine/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname.replace('/redmine', ''), params = url.searchParams;
    const send = json => route.fulfill({ json });
    if (path === '/users/current.json') return send({ user: { id: 1, firstname: 'Sprint', lastname: 'Planner' } });
    if (path === '/issue_statuses.json') return send({ issue_statuses: statuses });
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: [{ id: 2, name: 'Normal' }] });
    if (path === '/projects.json') return send({ projects });
    if (path.endsWith('/memberships.json')) return send({ memberships: [{ user: { id: 8, name: 'Developer' } }] });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (/^\/versions\/\d+\.json$/.test(path)) return send({ version: versions[0] });
    if (path === '/issues.json' && request.method() === 'GET') {
      let selected = rows;
      const tracker = params.get('tracker_id'), value = params.get('cf_7'), status = params.get('status_id');
      if (tracker) selected = selected.filter(row => tracker.startsWith('!') ? !tracker.slice(1).split('|').map(Number).includes(row.tracker.id) : tracker.split('|').map(Number).includes(row.tracker.id));
      if (value) selected = selected.filter(row => value === '!*' ? row.custom_fields[0].value.length === 0 : row.custom_fields[0].value.includes(value));
      if (status && status !== '*') selected = selected.filter(row => status === 'open' ? !row.status.is_closed : row.status.id === Number(status));
      if (params.has('subject')) selected = selected.filter(row => row.subject.includes(params.get('subject').slice(1)));
      const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (/^\/issues\/\d+\/relations\.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]);
      state.relationRequests.push(id);
      if (state.onRelations && await state.onRelations(route, id)) return;
      return send({ relations: state.relations.get(id) || [] });
    }
    if (/^\/issues\/\d+\.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]);
      const issue = rows.find(row => row.id === id) || state.targets.get(id);
      if (request.method() === 'GET') {
        state.issueRequests.push(id);
        if (state.onIssue && await state.onIssue(route, id)) return;
        return send({ issue: { ...issue, children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) } });
      }
      if (request.method() === 'PUT') {
        const patch = request.postDataJSON().issue;
        state.writes.push({ id, patch });
        for (const key of ['subject', 'description', 'custom_fields']) if (key in patch) issue[key] = patch[key];
        if ('assigned_to_id' in patch) issue.assigned_to = patch.assigned_to_id ? { id: patch.assigned_to_id, name: 'Developer' } : undefined;
        return route.fulfill({ status: 204, body: '' });
      }
    }
    throw new Error(`Unexpected ${request.method()} ${path}`);
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  return state;
}

const dialog = page => page.locator('#editor');
const related = (page, id) => dialog(page).locator(`#editor-feedback #editor-related details[data-related="${id}"]`);
const boardRelated = (page, id = 10) => page.locator(`.swimlane-headers > [data-lane="${id}"] details[data-related="${id}"]`);
const count = (requests, id) => requests.filter(value => value === id).length;
const relation = (from, to, type = 'relates') => ({ issue_id: from, issue_to_id: to, relation_type: type });
async function open(page, id = 20, { expectRelated = true } = {}) {
  await page.locator(`[data-edit="${id}"]`).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('#editor-issue-id')).toHaveText(`#${id}`);
  if (expectRelated) await expect(related(page, id)).toBeVisible();
}
async function close(page) {
  await dialog(page).getByRole('button', { name: 'Close editor' }).click();
  await expect(dialog(page)).not.toBeVisible();
}
async function refresh(page) {
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
}

for (const width of [1440, 390]) {
  test(`existing Card, Swimlane and Backlog editors put related issues left of Save at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await setup(page);
    for (const id of [20, 10, 30]) {
      state.relations.set(id, [relation(id, 90)]);
      const before = count(state.relationRequests, id);
      await open(page, id);
      await expect.poll(() => count(state.relationRequests, id)).toBe(before + 1);
      const details = related(page, id);
      await expect(details).not.toHaveAttribute('open');
      const header = dialog(page).locator('#editor-issue-id');
      await expect(header).toHaveAttribute('href', `https://redmine.example.test/issues/${id}`);
      await expect(dialog(page).locator('#issue-link')).toHaveCount(0);
      await expect(dialog(page).getByRole('link', { name: /Open in Redmine/i })).toHaveCount(0);
      await details.locator('summary').click();
      await expect(details.getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
      await expect(async () => {
        const footer = await dialog(page).locator('.dialog-actions').boundingBox();
        const disclosure = await details.boundingBox();
        const button = await dialog(page).getByRole('button', { name: 'Save', exact: true }).boundingBox();
        expect(disclosure.x).toBeCloseTo(footer.x, 0);
        expect(disclosure.x + disclosure.width).toBeLessThanOrEqual(button.x - 15);
        expect(disclosure.y).toBeGreaterThanOrEqual(footer.y);
        expect(disclosure.y + disclosure.height).toBeLessThanOrEqual(footer.y + footer.height + 1);
        expect(button.x + button.width).toBeCloseTo(footer.x + footer.width, 0);
        expect(button.y + button.height).toBeCloseTo(footer.y + footer.height, 0);
      }).toPass();
      await close(page);
    }
    expect(state.writes).toEqual([]);
  });
}


for (const id of [20, 10, 30]) {
  test(`issue #${id} hides related accordion while discovering and after an empty read`, async ({ page }) => {
    const state = await setup(page);
    // First populate the editor to ensure reopening cannot retain old markup.
    state.relations.set(id, [relation(id, 90)]);
    await open(page, id);
    await related(page, id).locator('summary').click();
    await expect(related(page, id).getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
    await close(page);
    let release, started = false;
    const gate = new Promise(resolve => { release = resolve; });
    state.onRelations = async (route, requestedId) => {
      if (requestedId !== id) return false;
      started = true;
      await gate;
      await route.fulfill({ json: { relations: [] } });
      return true;
    };
    try {
      await open(page, id, { expectRelated: false });
      await expect.poll(() => started).toBe(true);
      await expect(dialog(page).locator('#editor-related details')).toHaveCount(0);
      const response = page.waitForResponse(response => new URL(response.url()).pathname === `/redmine/issues/${id}/relations.json`);
      release();
      await (await response).finished();
      // Allow the response's JSON continuation and render to complete before
      // asserting absence, so a transient pending state cannot satisfy the test.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(dialog(page).locator('#editor-related details')).toHaveCount(0);
      await expect(dialog(page).locator('#editor-related')).toBeEmpty();
      await expect(dialog(page)).not.toContainText('No related issues');
      await expect(dialog(page).locator('#issue-link')).toHaveCount(0);
      expect(count(state.issueRequests, 90)).toBe(1);
      expect(state.writes).toEqual([]);
    } finally {
      release();
    }
  });
}

test('editor eagerly discovers relations, lazily loads targets, and caches collapse/re-expansion', async ({ page }) => {
  const state = await setup(page);
  state.relations.set(20, [relation(20, 90, 'blocks'), relation(91, 20, 'precedes'), relation(20, 90, 'relates')]);
  Object.assign(state.targets.get(90), { subject: '<img src=x onerror="window.relatedInjected=true"> & closed', status: { id: 5, name: 'Done' } });
  await open(page);
  const details = related(page, 20);
  await expect(details.locator('summary')).toHaveText('3 related issues');
  expect(count(state.relationRequests, 20)).toBe(1);
  expect(state.issueRequests.filter(id => id >= 90)).toEqual([]);
  await details.locator('summary').click();
  await expect(details.locator('li')).toHaveCount(3);
  await expect(details).toContainText('blocks · #90');
  await expect(details).toContainText('follows · #91');
  const closed = details.getByRole('link', { name: '#90 — <img src=x onerror="window.relatedInjected=true"> & closed', exact: true });
  await expect(closed).toHaveCount(2);
  await expect(closed.first()).toHaveAttribute('href', 'https://redmine.example.test/issues/90');
  await expect(closed.first()).toHaveAttribute('target', '_blank');
  await expect(closed.first()).toHaveAttribute('rel', /noopener/);
  await expect(closed.first()).toHaveCSS('text-decoration-line', 'line-through');
  await expect(details.getByRole('link', { name: '#91 — Issue 91' })).toHaveCSS('text-decoration-line', 'none');
  await expect(details.locator('li').first()).toHaveCSS('text-decoration-line', 'none');
  await expect(details.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.relatedInjected)).toBeUndefined();
  expect(count(state.issueRequests, 90)).toBe(1);
  expect(count(state.issueRequests, 91)).toBe(1);
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open');
  await expect(closed.first()).not.toBeVisible();
  await details.locator('summary').click();
  await expect(closed.first()).toBeVisible();
  expect(count(state.relationRequests, 20)).toBe(1);
  expect(count(state.issueRequests, 90)).toBe(1);
  expect(state.writes).toEqual([]);
});

test('editor cache and expansion are independent from the same Swimlane heading', async ({ page }) => {
  const state = await setup(page);
  state.relations.set(10, [relation(10, 90)]);
  await refresh(page);
  const heading = boardRelated(page);
  await heading.locator('summary').click();
  await expect(heading.getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
  const before = count(state.relationRequests, 10);
  await open(page, 10);
  const details = related(page, 10);
  await expect(details).not.toHaveAttribute('open');
  await expect.poll(() => count(state.relationRequests, 10)).toBe(before + 1);
  await details.locator('summary').click();
  await expect(details.getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
  expect(count(state.issueRequests, 90)).toBe(2);
  await details.locator('summary').click();
  await expect(heading).toHaveAttribute('open');
  await close(page);
  await heading.locator('summary').click();
  await open(page, 10);
  await details.locator('summary').click();
  await expect(details.getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
  await expect(heading).not.toHaveAttribute('open');
  expect(count(state.issueRequests, 90)).toBe(3);
  expect(state.writes).toEqual([]);
});

for (const status of [403, 404]) {
  test(`unavailable target (${status}) stays private and does not offer network retry`, async ({ page }) => {
    const state = await setup(page);
    state.relations.set(20, [relation(20, 90), relation(20, 91)]);
    state.onIssue = async (route, id) => {
      if (id !== 90) return false;
      await route.fulfill({ status, json: { errors: ['Private issue title must not leak'] } });
      return true;
    };
    await open(page);
    await related(page, 20).locator('summary').click();
    await expect(related(page, 20)).toContainText('Issue unavailable');
    await expect(related(page, 20).getByRole('link', { name: '#91 — Issue 91' })).toBeVisible();
    await expect(related(page, 20).getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(related(page, 20)).not.toContainText('Private issue title');
    await expect(related(page, 20).locator('a[href$="/90"]')).toHaveCount(0);
    await related(page, 20).locator('summary').click();
    await related(page, 20).locator('summary').click();
    expect(count(state.issueRequests, 90)).toBe(1);
  });
}

for (const failure of ['discovery', 'target']) {
  test(`${failure} network error offers explicit retry without losing successful targets`, async ({ page }) => {
    const state = await setup(page);
    state.relations.set(20, [relation(20, 90), relation(20, 91)]);
    let fail = true;
    state.onRelations = async (route, id) => {
      if (failure !== 'discovery' || id !== 20 || !fail) return false;
      await route.abort('failed'); return true;
    };
    state.onIssue = async (route, id) => {
      if (failure !== 'target' || id !== 90 || !fail) return false;
      await route.abort('failed'); return true;
    };
    await open(page);
    const details = related(page, 20);
    await details.locator('summary').click();
    await expect(details.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(details).toContainText('could not be loaded');
    if (failure === 'target') await expect(details.getByRole('link', { name: '#91 — Issue 91' })).toBeVisible();
    fail = false;
    await details.getByRole('button', { name: 'Retry' }).click();
    await expect(details.getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
    await expect(details.getByRole('link', { name: '#91 — Issue 91' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(count(state.relationRequests, 20)).toBe(failure === 'discovery' ? 2 : 1);
    expect(count(state.issueRequests, 90)).toBe(failure === 'target' ? 2 : 1);
    expect(count(state.issueRequests, 91)).toBe(1);
    expect(state.writes).toEqual([]);
  });
}

for (const pending of ['discovery', 'target']) {
  test(`late ${pending} response cannot replace another editor or a fresh reopened issue`, async ({ page }) => {
    const state = await setup(page);
    state.relations.set(20, [relation(20, 90)]);
    state.relations.set(21, [relation(21, 91)]);
    let release, responded, started = false;
    const gate = new Promise(resolve => { release = resolve; });
    const responseFinished = new Promise(resolve => { responded = resolve; });
    const hold = async (route, id) => {
      if (id !== (pending === 'discovery' ? 20 : 90) || started) return false;
      started = true;
      await gate;
      // Closing the editor may abort the browser request before this response.
      await route.fulfill({ json: pending === 'discovery'
        ? { relations: [relation(20, 90)] }
        : { issue: { ...state.targets.get(90), subject: 'Stale target title' } } }).catch(() => {});
      responded();
      return true;
    };
    if (pending === 'discovery') state.onRelations = hold;
    else state.onIssue = hold;
    try {
      await open(page, 20, { expectRelated: pending !== 'discovery' });
      if (pending === 'target') await related(page, 20).locator('summary').click();
      await expect.poll(() => started).toBe(true);
      await close(page);
      await open(page, 21);
      await related(page, 21).locator('summary').click();
      await expect(related(page, 21).getByRole('link', { name: '#91 — Issue 91' })).toBeVisible();
      release();
      await responseFinished;
      await expect(dialog(page).locator('[data-related]')).toHaveAttribute('data-related', '21');
      await expect(dialog(page)).not.toContainText('Stale target title');
      await close(page);
      state.relations.set(20, [relation(20, 92)]);
      await open(page);
      await expect(related(page, 20)).not.toHaveAttribute('open');
      await related(page, 20).locator('summary').click();
      await expect(related(page, 20).getByRole('link', { name: '#92 — Issue 92' })).toBeVisible();
      await expect(related(page, 20).locator('a[href$="/90"]')).toHaveCount(0);
      await expect(dialog(page)).not.toContainText('Stale target title');
      expect(count(state.relationRequests, 20)).toBe(2);
      expect(state.writes).toEqual([]);
    } finally {
      release();
    }
  });
}

test('toggling related issues preserves the unsaved title, description and assignee draft', async ({ page }) => {
  const state = await setup(page);
  state.relations.set(20, [relation(20, 90)]);
  await open(page);
  await dialog(page).locator('#edit-title').click();
  await dialog(page).getByLabel('Title', { exact: true }).fill('Draft title');
  await dialog(page).getByRole('button', { name: 'Edit description', exact: true }).click();
  await dialog(page).locator('#edit-description').fill('Draft **description**');
  await dialog(page).getByLabel('Assignee', { exact: true }).selectOption('8');
  for (let index = 0; index < 2; index++) {
    await related(page, 20).locator('summary').click();
    await expect(related(page, 20).getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
    await related(page, 20).locator('summary').click();
  }
  await expect(dialog(page).locator('#editor-subject')).toHaveValue('Draft title');
  await expect(dialog(page).locator('#edit-description')).toHaveValue('Draft **description**');
  await expect(dialog(page).getByLabel('Assignee', { exact: true })).toHaveValue('8');
  expect(state.writes).toEqual([]);
  // The disclosure is UI state, not part of the submitted issue patch.
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].id).toBe(20);
  expect(state.writes[0].patch).toEqual({ subject: 'Draft title', description: expect.stringContaining('<strong>description</strong>'), assigned_to_id: 8 });
});

test('new-subtask drafts clear and hide related issues without requesting relations', async ({ page }) => {
  const state = await setup(page);
  state.relations.set(20, [relation(20, 90)]);
  await open(page);
  await related(page, 20).locator('summary').click();
  await expect(related(page, 20).getByRole('link', { name: '#90 — Issue 90' })).toBeVisible();
  await close(page);
  const before = [...state.relationRequests];
  await page.getByRole('button', { name: 'Add Subtask to #10', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New subtask' })).toBeVisible();
  await expect(dialog(page).locator('#editor-related')).toBeHidden();
  await expect(dialog(page).locator('#editor-related')).toBeEmpty();
  await expect(dialog(page).locator('[data-related]')).toHaveCount(0);
  await dialog(page).getByLabel('Title', { exact: true }).fill('New child draft');
  await dialog(page).getByLabel('Project', { exact: true }).selectOption('1');
  await expect(dialog(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(state.relationRequests).toEqual(before);
  expect(state.writes).toEqual([]);
  page.once('dialog', prompt => prompt.accept());
  await close(page);
  await open(page);
  await expect(related(page, 20)).not.toHaveAttribute('open');
});
