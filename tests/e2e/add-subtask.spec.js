import { test, expect } from '@playwright/test';

// A stateful Redmine boundary: list refreshes and verification reads see actual
// created issues, while preflight reads can independently observe stale context.
async function setup(page, { closedSprint = false } = {}) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }];
  const feature = { id: 1, name: 'Feature' }, task = { id: 2, name: 'Task' }, bug = { id: 3, name: 'Bug' };
  const projects = [
    { id: 1, name: 'Product', trackers: [feature, task] },
    { id: 2, name: 'Module', parent: { id: 1 }, trackers: [feature, task, bug] },
    { id: 3, name: 'Nested module', parent: { id: 2 }, trackers: [task] },
    { id: 4, name: 'Headings only', parent: { id: 1 }, trackers: [feature] },
    { id: 9, name: 'Outside product', trackers: [task] },
  ];
  const versions = [{ id: 100, name: 'Sprint 100', status: closedSprint ? 'closed' : 'open', project: { id: 1 }, sharing: 'descendants' },
    { id: 99, name: 'Sprint 99', status: 'open', project: { id: 1 }, sharing: 'descendants' }];
  const make = (id, tracker, values = ['100'], parent, status = statuses[0]) => ({
    id, subject: `Issue ${id}`, description: 'Parent description must not be copied', tracker,
    project: { id: 1, name: 'Product' }, status, priority: { id: 2, name: 'Normal' },
    assigned_to: { id: 7, name: 'Parent owner' }, fixed_version: { id: 300 },
    custom_fields: [{ id: 7, multiple: true, value: values }], allowed_statuses: statuses,
    ...(parent ? { parent: { id: parent } } : {}),
  });
  const rows = [make(10, feature, ['99', '100']), make(11, feature),
    make(12, feature, ['100'], null, statuses[2]), make(20, task, ['100'], 10),
    make(21, task), make(30, feature, [])];
  const state = { rows, versions, projects, posts: [], updates: [], issueLists: 0, failure: null };
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
    if (path.endsWith('/memberships.json')) return send({ memberships: [{ user: { id: 8, name: 'Module developer' } }] });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (/^\/versions\/\d+\.json$/.test(path)) return send({ version: versions.find(row => row.id === Number(path.match(/\d+/)[0])) });
    if (path === '/issues.json' && request.method() === 'POST') {
      const patch = request.postDataJSON().issue;
      state.posts.push(patch);
      if (state.failure === 'network') return route.abort('failed');
      if (state.failure === '422') return route.fulfill({ status: 422, json: { errors: ['Title rejected by workflow'] } });
      const issue = { id: 200 + state.posts.length, subject: patch.subject, description: patch.description,
        project: projects.find(row => row.id === patch.project_id), tracker: [feature, task, bug].find(row => row.id === patch.tracker_id),
        parent: { id: patch.parent_issue_id }, status: statuses.find(row => row.id === patch.status_id),
        priority: { id: 2, name: 'Normal' }, custom_fields: patch.custom_fields,
        ...(patch.assigned_to_id ? { assigned_to: { id: patch.assigned_to_id, name: 'Module developer' } } : {}) };
      rows.push(issue);
      return route.fulfill({ status: 201, json: { issue } });
    }
    if (path === '/issues.json') {
      state.issueLists++;
      let selected = rows;
      const tracker = params.get('tracker_id'), value = params.get('cf_7'), status = params.get('status_id');
      if (tracker) selected = selected.filter(row => tracker.startsWith('!') ? !tracker.slice(1).split('|').map(Number).includes(row.tracker.id) : tracker.split('|').map(Number).includes(row.tracker.id));
      if (value) selected = selected.filter(row => value === '!*' ? row.custom_fields[0].value.length === 0 : row.custom_fields[0].value.map(String).includes(value));
      if (status && status !== '*') selected = selected.filter(row => status === 'open' ? !row.status.is_closed : row.status.id === Number(status));
      if (params.has('subject')) selected = selected.filter(row => row.subject.includes(params.get('subject').slice(1)));
      const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (/^\/issues\/\d+\.json$/.test(path) && request.method() === 'PUT') {
      const id = Number(path.match(/\d+/)[0]), patch = request.postDataJSON().issue;
      state.updates.push({ id, patch });
      const issue = rows.find(row => row.id === id);
      for (const key of ['subject', 'description', 'custom_fields']) if (key in patch) issue[key] = patch[key];
      if ('assigned_to_id' in patch) issue.assigned_to = patch.assigned_to_id ? { id: patch.assigned_to_id, name: 'Module developer' } : undefined;
      return route.fulfill({ status: 204, body: '' });
    }
    if (/^\/issues\/\d+\/relations\.json$/.test(path)) return send({ relations: [] });
    if (/^\/issues\/\d+\.json$/.test(path) && request.method() === 'GET') {
      const id = Number(path.match(/\d+/)[0]), issue = rows.find(row => row.id === id);
      return send({ issue: { ...issue, children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) } });
    }
    throw new Error(`Unexpected ${request.method()} ${path}`);
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  return state;
}

const add = (page, id = 10) => page.getByRole('button', { name: `Add Subtask to #${id}`, exact: true });
const editor = page => page.getByRole('dialog', { name: 'New subtask' });
const save = page => editor(page).getByRole('button', { name: 'Save', exact: true });
async function draft(page, { project = '3', title = 'New child' } = {}) {
  await add(page).click();
  await editor(page).getByLabel('Title', { exact: true }).fill(title);
  await editor(page).getByLabel('Project', { exact: true }).selectOption(project);
  await expect(editor(page).getByLabel('Assignee', { exact: true })).toBeEnabled();
}

test('New cells offer Add Subtask only for real parents, including empty Swimlanes', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('[data-create-subtask]')).toHaveCount(3);
  for (const id of [10, 11, 12]) {
    await expect(page.locator(`[data-id="status-1"] [data-lane="${id}"]`).getByRole('button', { name: `Add Subtask to #${id}`, exact: true })).toBeVisible();
  }
  await expect(add(page, 11)).toBeEnabled();
  await expect(add(page, 12)).toBeDisabled();
  await expect(add(page, 12)).toHaveAttribute('title', /Closed parents/);
  await expect(page.locator('[data-id="status-2"] [data-create-subtask], [data-id="status-5"] [data-create-subtask], [data-lane="ungrouped"] [data-create-subtask], [data-id="backlog"] [data-create-subtask]')).toHaveCount(0);
  // A taller neighboring status must push the action to the row bottom,
  // without moving it inside the Card drop target or overlapping New Cards.
  for (let index = 0; index < 6; index++) state.rows.push({ ...state.rows.find(row => row.id === 20), id: 1000 + index, status: { id: 2, name: 'Doing' } });
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('[data-id="status-2"] [data-lane="10"] .kanban-item')).toHaveCount(6);
  await expect(async () => {
    const geometry = await add(page).evaluate(button => {
      const section = button.closest('.swimlane-section'), bounds = section.getBoundingClientRect(), action = button.getBoundingClientRect();
      const stripe = document.querySelector('.swimlane-headers > [data-lane="10"] > .lane-priority-bar').getBoundingClientRect();
      return { left: action.left - stripe.right, bottom: bounds.bottom - action.bottom,
        belowCards: action.top >= section.querySelector('.kanban-item').getBoundingClientRect().bottom,
        inDropTarget: Boolean(button.closest('.swimlane-cards')),
        heights: [...document.querySelectorAll('.swimlane-section[data-lane="10"]')].map(cell => cell.getBoundingClientRect().height) };
    });
    expect(geometry.left).toBeCloseTo(8, 0);
    expect(geometry.bottom).toBeCloseTo(8, 0);
    expect(geometry.belowCards).toBe(true);
    expect(geometry.inDropTarget).toBe(false);
    for (const height of geometry.heights) expect(height).toBeCloseTo(geometry.heights[0], 0);
  }).toPass();
  await add(page, 11).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#creation-parent')).toHaveText('#11 Issue 11');
  expect(state.posts).toEqual([]);
});

test('closed Sprint disables all creation actions', async ({ page }) => {
  const state = await setup(page, { closedSprint: true });
  // Select the closed Sprint explicitly if the planner initially chooses an open one.
  await page.getByLabel('Include closed sprints', { exact: true }).check();
  await page.locator('#sprint').selectOption('100');
  await expect(add(page)).toBeDisabled();
  await expect(add(page)).toHaveAttribute('title', /Closed Sprints/);
  expect(state.posts).toEqual([]);
});

test('blank draft fixes Parent, Sprint and New; Project is explicit and limits Tracker choices', async ({ page }) => {
  await setup(page);
  await add(page).click();
  const dialog = editor(page);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('');
  await expect(page.locator('#edit-description')).toHaveValue('');
  await expect(dialog.getByLabel('Assignee', { exact: true })).toHaveValue('');
  await expect(page.locator('#creation-parent')).toHaveText('#10 Issue 10');
  await expect(page.locator('#creation-parent')).toHaveAttribute('href', 'https://redmine.example.test/issues/10');
  await expect(page.locator('#creation-sprint')).toHaveText('Sprint 100');
  await expect(page.locator('#creation-status')).toHaveText('New');
  await expect(dialog.getByLabel('Status', { exact: true })).not.toBeVisible();
  await expect(page.locator('#editor-swimlane-fields')).toBeHidden();
  const project = dialog.getByLabel('Project', { exact: true }), tracker = dialog.getByLabel('Tracker', { exact: true });
  await expect(project).toHaveValue('');
  await expect(project.locator('option')).toHaveText(['Choose a Project', 'Product', 'Module', 'Nested module']);
  await expect(save(page)).toBeDisabled();
  await project.selectOption('3');
  await expect(tracker).toHaveValue('2');
  await project.selectOption('2');
  await expect(tracker).toHaveValue('');
  await expect(tracker.locator('option')).toHaveText(['Choose a Tracker', 'Task', 'Bug']);
  await dialog.getByLabel('Title', { exact: true }).fill('Manual tracker');
  await expect(save(page)).toBeDisabled();
  await tracker.selectOption('3');
  await expect(save(page)).toBeEnabled();
  await project.selectOption('1');
  await expect(tracker).toHaveValue('2');
});

test('cross-project creation sends only selected Sprint, closes and refreshes the new New Card', async ({ page }) => {
  const state = await setup(page);
  await draft(page, { project: '2', title: 'Cross-project child' });
  await editor(page).getByLabel('Tracker', { exact: true }).selectOption('3');
  const listsBefore = state.issueLists;
  await save(page).click();
  await expect(editor(page)).not.toBeVisible();
  expect(state.posts).toEqual([{
    project_id: 2, tracker_id: 3, parent_issue_id: 10, status_id: 1,
    subject: 'Cross-project child', description: '', assigned_to_id: null,
    custom_fields: [{ id: 7, value: ['100'] }],
  }]);
  await expect(page.locator('[data-id="status-1"] [data-lane="10"] [data-eid="201"]')).toContainText('Cross-project child');
  expect(state.issueLists).toBeGreaterThan(listsBefore);
  await expect(page.locator('#notice')).toContainText('Subtask #201 created in Redmine');
});

test('retains active Card filters and links a successfully created but hidden Card', async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel('Search Sprint Cards').fill('Issue 20');
  await expect(add(page)).toBeVisible();
  await draft(page);
  await save(page).click();
  await expect(editor(page)).not.toBeVisible();
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('Issue 20');
  await expect(page.locator('[data-eid="201"]')).toHaveCount(0);
  await expect(page.locator('#notice')).toContainText('hidden by the current filters');
  await expect(page.locator('#notice').getByRole('link', { name: 'Open #201 in Redmine' })).toHaveAttribute('href', 'https://redmine.example.test/issues/201');
  await page.getByLabel('Search Sprint Cards').fill('');
  await expect(page.locator('[data-eid="201"]')).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test('cancel blank draft, decline discard, then discard via Escape without POST', async ({ page }) => {
  const state = await setup(page);
  await add(page).click();
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await expect(editor(page)).not.toBeVisible();
  await draft(page);
  page.once('dialog', async dialog => { expect(dialog.message()).toBe('Discard unsaved changes?'); await dialog.dismiss(); });
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('New child');
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(editor(page)).not.toBeVisible();
  await add(page).click();
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('');
  await expect(editor(page).getByLabel('Project', { exact: true })).toHaveValue('');
  expect(state.posts).toEqual([]);
});

test('422 preserves the complete draft and permits an explicit corrected retry', async ({ page }) => {
  const state = await setup(page);
  state.failure = '422';
  await draft(page, { project: '2', title: 'Rejected title' });
  await editor(page).getByLabel('Tracker', { exact: true }).selectOption('3');
  await editor(page).getByLabel('Assignee', { exact: true }).selectOption('8');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('#edit-description').fill('Keep this **draft**');
  await save(page).click();
  await expect(page.locator('#editor-notice')).toContainText('Title rejected by workflow');
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('Rejected title');
  await expect(editor(page).getByLabel('Project', { exact: true })).toHaveValue('2');
  await expect(editor(page).getByLabel('Tracker', { exact: true })).toHaveValue('3');
  await expect(editor(page).getByLabel('Assignee', { exact: true })).toHaveValue('8');
  await expect(page.locator('#edit-description')).toHaveValue('Keep this **draft**');
  await expect(save(page)).toBeEnabled();
  expect(state.posts).toHaveLength(1);
  state.failure = null;
  await page.locator('#edit-title').click();
  await editor(page).getByLabel('Title', { exact: true }).fill('Corrected title');
  await save(page).click();
  await expect(editor(page)).not.toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual({ ...state.posts[0], subject: 'Corrected title' });
  expect(state.posts[1].description).toContain('<strong>draft</strong>');
  await expect(page.locator('[data-eid="202"]')).toContainText('Corrected title');
});

for (const stale of ['closed parent', 'unplanned parent', 'moved parent', 'changed tracker', 'closed Sprint']) {
  test(`fresh preflight blocks POST after ${stale}`, async ({ page }) => {
    const state = await setup(page);
    await draft(page);
    const parent = state.rows.find(row => row.id === 10);
    const messages = {
      'closed parent': 'parent is now closed', 'unplanned parent': 'parent no longer belongs',
      'moved parent': 'parent moved outside', 'changed tracker': 'parent is no longer a Swimlane-capable',
      'closed Sprint': 'Sprint is no longer open',
    };
    if (stale === 'closed parent') parent.status = { id: 5, name: 'Done' };
    if (stale === 'unplanned parent') parent.custom_fields[0].value = ['99'];
    if (stale === 'moved parent') parent.project = { id: 9 };
    if (stale === 'changed tracker') parent.tracker = { id: 2, name: 'Task' };
    if (stale === 'closed Sprint') state.versions[0].status = 'closed';
    await save(page).click();
    await expect(page.locator('#editor-notice')).toContainText(messages[stale]);
    await expect(editor(page)).toBeVisible();
    await expect(editor(page).getByLabel('Title', { exact: true })).toHaveValue('New child');
    expect(state.posts).toEqual([]);
  });
}

test('an uncertain network write keeps the draft but disables retry to avoid duplicates', async ({ page }) => {
  const state = await setup(page);
  state.failure = 'network';
  await draft(page);
  await save(page).click();
  await expect(page.locator('#editor-notice')).toContainText('Creation is unconfirmed');
  await expect(page.locator('#editor-notice')).toContainText('Save is disabled to avoid duplicates');
  await expect(editor(page)).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await page.locator('#edit-title').click();
  await editor(page).getByLabel('Title', { exact: true }).fill('Editing cannot enable another POST');
  await expect(save(page)).toBeDisabled();
  await editor(page).getByLabel('Title', { exact: true }).press('Enter');
  await expect(save(page)).toBeDisabled();
  expect(state.posts).toHaveLength(1);
});


test('shared editor switches between creation and ordinary updates without leaking required fields or context', async ({ page }) => {
  const state = await setup(page);
  // Populate creation-only state, then discard it before editing an existing Card.
  await draft(page, { project: '2', title: 'Discard this child' });
  await editor(page).getByLabel('Tracker', { exact: true }).selectOption('3');
  page.once('dialog', dialog => dialog.accept());
  await editor(page).getByRole('button', { name: 'Close editor' }).click();
  await page.locator('[data-edit="20"]').click();
  const dialog = page.locator('#editor');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#editor-creation-context')).toBeHidden();
  await expect(page.locator('#editor-creation-fields')).toBeHidden();
  await expect(page.locator('#creation-project')).toBeDisabled();
  await expect(page.locator('#creation-tracker')).toBeDisabled();
  await expect(page.locator('#editor-issue-id')).toHaveText('#20');
  await expect(page.locator('#issue-link')).toHaveAttribute('href', 'https://redmine.example.test/issues/20');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('#edit-description').fill('Existing Card updated');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.posts).toEqual([]);
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0].id).toBe(20);
  expect(state.updates[0].patch.description).toContain('Existing Card updated');
  expect(state.updates[0].patch).not.toHaveProperty('project_id');
  expect(state.updates[0].patch).not.toHaveProperty('tracker_id');
  expect(state.updates[0].patch).not.toHaveProperty('parent_issue_id');

  // Reverse direction: no prior issue content, link, or chosen Project survives.
  await add(page, 11).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#creation-parent')).toHaveText('#11 Issue 11');
  await expect(page.locator('#creation-sprint')).toHaveText('Sprint 100');
  await expect(page.locator('#editor-subject')).toHaveValue('');
  await expect(page.locator('#edit-description')).toHaveValue('');
  await expect(page.locator('#edit-assignee')).toHaveValue('');
  await expect(page.locator('#creation-project')).toHaveValue('');
  await expect(page.locator('#creation-tracker')).toHaveValue('');
  await expect(page.locator('#issue-link')).toBeHidden();
  await expect(page.locator('#editor-issue-id')).not.toHaveAttribute('href');
  await expect(save(page)).toBeDisabled();
});

test('Escape in a fresh creation title cannot restore the previously edited issue title', async ({ page }) => {
  const state = await setup(page);
  await page.locator('[data-edit="20"]').click();
  await page.locator('#edit-title').click();
  await page.locator('#editor-subject').fill('Discarded existing title edit');
  // Blur commits the input to the existing draft, but closing discards the draft.
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Close editor' }).click();
  await add(page).click();
  await expect(page.locator('#editor-subject')).toHaveValue('');
  await page.locator('#editor-subject').press('Escape');
  await expect(page.locator('#editor-subject')).toHaveValue('');
  await expect(save(page)).toBeDisabled();
  expect(state.posts).toEqual([]);
  expect(state.updates).toEqual([]);
});
