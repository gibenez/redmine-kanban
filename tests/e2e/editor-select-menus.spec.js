import { test, expect } from '@playwright/test';

// An independent, stateful Redmine boundary. Writes are recorded separately from
// reads so choosing an option cannot accidentally masquerade as saving a draft.
async function setup(page, { closedSprint = false, workflow = true } = {}) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }];
  const priorities = [{ id: 2, name: 'Normal' }, { id: 4, name: 'High' }];
  const feature = { id: 1, name: 'Feature' }, task = { id: 2, name: 'Task' }, bug = { id: 3, name: 'Bug' };
  const color = value => [{ name: 'Colore', value }];
  // Deliberately unsorted, with hues that disagree with name order. The two
  // Module 2 names compare equal case-insensitively and must use numeric IDs.
  const projects = [
    { id: 1, name: 'Product', trackers: [feature, task] },
    { id: 12, name: 'module 2', parent: { id: 1 }, trackers: [task], custom_fields: color('#0000ff') },
    { id: 3, name: 'Module 10', parent: { id: 1 }, trackers: [task], custom_fields: color('#00ff00') },
    { id: 5, name: 'alpha 2', parent: { id: 1 }, trackers: [task] },
    { id: 4, name: 'Alpha', parent: { id: 1 }, trackers: [task], custom_fields: color('not-a-color') },
    { id: 2, name: 'Module 2', parent: { id: 1 }, trackers: [feature, task, bug], custom_fields: color(' #FF0000 ') },
    { id: 9, name: 'Outside product', trackers: [task], custom_fields: color('#ff00ff') },
    { id: 6, name: 'Trackerless', parent: { id: 1 }, trackers: [], custom_fields: color('#ffff00') },
    { id: 7, name: 'Headings only', parent: { id: 1 }, trackers: [feature], custom_fields: color('#00ffff') },
  ];
  const versions = [{ id: 100, name: 'Sprint 100', status: closedSprint ? 'closed' : 'open', project: { id: 1 }, sharing: 'descendants' }];
  const make = (id, project, tracker = task) => ({
    id, subject: `Issue ${id}`, description: 'Original description', project, tracker,
    status: statuses[0], priority: priorities[0], assigned_to: { id: 8, name: 'Developer' },
    custom_fields: [{ id: 7, multiple: true, value: ['100'] }],
    ...(workflow ? { allowed_statuses: statuses } : {}),
  });
  const eligible = projects.filter(project => [1, 2, 3, 4, 5, 12].includes(project.id));
  const rows = [make(10, projects[0], feature), ...eligible.map(project => make(1000 + project.id, project))];
  const state = { rows, writes: [], posts: [] };
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
    if (path === '/enumerations/issue_priorities.json') return send({ issue_priorities: priorities });
    if (path === '/projects.json') return send({ projects });
    if (path.endsWith('/memberships.json')) return send({ memberships: [
      { user: { id: 8, name: 'Developer' } }, { user: { id: 9, name: 'Reviewer' } },
    ] });
    if (path.endsWith('/versions.json')) return send({ versions });
    if (/^\/versions\/\d+\.json$/.test(path)) return send({ version: versions[0] });
    if (path === '/issues.json' && request.method() === 'POST') {
      const patch = request.postDataJSON().issue;
      state.posts.push(patch);
      const issue = make(200 + state.posts.length, projects.find(project => project.id === patch.project_id), [task, bug].find(tracker => tracker.id === patch.tracker_id));
      Object.assign(issue, { subject: patch.subject, description: patch.description,
        parent: { id: patch.parent_issue_id }, custom_fields: patch.custom_fields,
        assigned_to: patch.assigned_to_id ? { id: patch.assigned_to_id, name: patch.assigned_to_id === 9 ? 'Reviewer' : 'Developer' } : undefined });
      rows.push(issue);
      return route.fulfill({ status: 201, json: { issue } });
    }
    if (path === '/issues.json') {
      let selected = rows;
      const tracker = params.get('tracker_id'), value = params.get('cf_7'), status = params.get('status_id');
      if (tracker) selected = selected.filter(row => tracker.startsWith('!') ? !tracker.slice(1).split('|').map(Number).includes(row.tracker.id) : tracker.split('|').map(Number).includes(row.tracker.id));
      if (value) selected = selected.filter(row => value === '!*' ? !row.custom_fields[0].value.length : row.custom_fields[0].value.includes(value));
      if (status && status !== '*') selected = selected.filter(row => status === 'open' ? !row.status.is_closed : row.status.id === Number(status));
      const offset = Number(params.get('offset') || 0), limit = Number(params.get('limit') || 100);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (/^\/issues\/\d+\/relations\.json$/.test(path)) return send({ relations: [] });
    if (/^\/issues\/\d+\.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]), issue = rows.find(row => row.id === id);
      if (request.method() === 'GET') return send({ issue: { ...issue, children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) } });
      if (request.method() === 'PUT') {
        const patch = request.postDataJSON().issue;
        state.writes.push({ id, patch });
        for (const key of ['subject', 'description', 'custom_fields', 'due_date']) if (key in patch) issue[key] = patch[key];
        if ('status_id' in patch) issue.status = statuses.find(status => status.id === patch.status_id);
        if ('priority_id' in patch) issue.priority = priorities.find(priority => priority.id === patch.priority_id);
        if ('assigned_to_id' in patch) issue.assigned_to = patch.assigned_to_id ? { id: patch.assigned_to_id, name: patch.assigned_to_id === 9 ? 'Reviewer' : 'Developer' } : undefined;
        return route.fulfill({ status: 204, body: '' });
      }
    }
    throw new Error(`Unexpected ${request.method()} ${path}`);
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  if (closedSprint) {
    await page.getByLabel('Include closed sprints', { exact: true }).check();
    await page.locator('#sprint').selectOption('100');
  }
  return state;
}

const editor = page => page.locator('#editor');
// Popovers may be in the top layer; never require the panel to be a sibling of
// its select or inside the editor's scrollable content.
const menus = page => page.locator('.editor-select-options.sprint-filter-options:visible');
const save = page => editor(page).getByRole('button', { name: 'Save', exact: true });
const projectNames = ['Module 2', 'module 2', 'Module 10', 'Alpha', 'alpha 2', 'Product'];

async function creation(page) {
  await page.getByRole('button', { name: 'Add Subtask to #10', exact: true }).click();
  await expect(editor(page)).toBeVisible();
}
async function openHeading(page) {
  await page.locator('[data-edit="10"]').click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#edit-priority')).toBeVisible();
}
async function openMenu(page, id) {
  const select = page.locator(`#${id}`);
  await expect(select).toBeVisible();
  await expect(select).toBeEnabled();
  await select.click();
  await expect(menus(page)).toHaveCount(1);
  await expect(menus(page)).toHaveAttribute('role', 'listbox');
  await expect(menus(page).locator('.sprint-filter-heading')).toHaveCount(0);
  await expect(menus(page).locator(':scope > :first-child')).toHaveAttribute('role', 'option');
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  return menus(page);
}
async function choose(page, id, name) {
  const menu = await openMenu(page, id);
  await menu.getByRole('option', { name, exact: true }).click();
  await expect(menus(page)).toHaveCount(0);
}
async function activeOption(page, id) {
  const activeId = await page.locator(`#${id}`).getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  const option = page.locator(`[id="${activeId}"]`);
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('role', 'option');
  return option;
}

test('Project starts explicit, matches Sprint filter ordering and swatches, and remains single-choice', async ({ page }) => {
  const state = await setup(page);
  const filter = page.locator('[data-filter="project"]');
  await filter.locator('summary').click();
  const filterRows = filter.locator('[data-filter-choices] label');
  await expect(filterRows).toHaveText(projectNames);
  const filterColors = await filterRows.locator('.project-swatch').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  await filter.locator('summary').click();
  await creation(page);
  const select = page.locator('#creation-project');
  await expect(select).toHaveValue('');
  await expect(select.locator('option:checked')).toHaveText('Choose a Project');
  const menu = await openMenu(page, 'creation-project');
  const options = menu.getByRole('option');
  // The explicit placeholder is an option, not an implicit first Project.
  await expect(options).toHaveText(['Choose a Project', ...projectNames]);
  // The placeholder may have a decorative empty swatch too; compare only real
  // Project rows, whose order is independently asserted above.
  expect(await options.evaluateAll(nodes => nodes.slice(1).every(node => node.querySelectorAll('.project-swatch').length === 1))).toBe(true);
  const colors = await options.evaluateAll(nodes => nodes.slice(1).map(node => getComputedStyle(node.querySelector('.project-swatch')).backgroundColor));
  expect(colors).toEqual(filterColors);
  expect(colors).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'rgb(0, 255, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  await select.evaluate(node => {
    node.menuEvents = [];
    for (const type of ['input', 'change']) node.addEventListener(type, event => node.menuEvents.push({ type: event.type, value: event.target.value, bubbles: event.bubbles }));
  });
  await options.nth(1).click();
  await expect(select).toHaveValue('2');
  expect(await select.evaluate(node => node.menuEvents)).toEqual([
    { type: 'input', value: '2', bubbles: true }, { type: 'change', value: '2', bubbles: true },
  ]);
  await expect(menus(page)).toHaveCount(0);
  await openMenu(page, 'creation-project');
  await expect(menus(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
  await expect(menus(page).locator('[aria-selected="true"]')).toHaveText('Module 2');
  await page.keyboard.press('Escape');
  expect(state.posts).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('Project changes reset or autoselect dependent Tracker; all native selects and Save still work', async ({ page }) => {
  const state = await setup(page);
  await creation(page);
  for (const id of ['creation-project', 'creation-tracker', 'edit-assignee']) {
    await expect(page.locator(`#editor select#${id}`)).toBeVisible();
  }
  for (const id of ['creation-status', 'creation-priority']) {
    const input = page.locator(`#editor input#${id}`);
    await expect(input).toHaveAttribute('readonly', '');
    await input.click();
    await expect(menus(page)).toHaveCount(0);
  }
  await expect(page.locator('#creation-tracker')).toBeDisabled();
  await choose(page, 'creation-project', 'Module 10');
  await expect(page.locator('#creation-tracker')).toHaveValue('2');
  await choose(page, 'creation-project', 'Module 2');
  await expect(page.locator('#creation-tracker')).toHaveValue('');
  const tracker = await openMenu(page, 'creation-tracker');
  await expect(tracker.getByRole('option')).toHaveText(['Choose a Tracker', 'Task', 'Bug']);
  await tracker.getByRole('option', { name: 'Bug', exact: true }).click();
  await expect(page.locator('#creation-tracker')).toHaveValue('3');
  await choose(page, 'edit-assignee', 'Reviewer');
  await expect(page.locator('#edit-assignee')).toHaveValue('9');
  // Existing automation and programmatic input/change users retain the original
  // IDs and native options. Opening later must reflect those changes too.
  await page.locator('#creation-project').selectOption('1');
  await expect(page.locator('#creation-tracker')).toHaveValue('2');
  await expect(page.locator('#edit-assignee')).toHaveValue('');
  await page.locator('#creation-project').selectOption('2');
  await page.locator('#creation-tracker').selectOption('3');
  await expect(page.locator('#edit-assignee')).toBeEnabled();
  await page.locator('#edit-assignee').selectOption('9');
  await openMenu(page, 'creation-tracker');
  await expect(menus(page).locator('[aria-selected="true"]')).toHaveText('Bug');
  await page.keyboard.press('Escape');
  await page.locator('#editor-subject').fill('Chosen only on Save');
  expect(state.posts).toEqual([]);
  expect(state.writes).toEqual([]);
  await save(page).click();
  await expect(editor(page)).toBeHidden();
  expect(state.posts).toEqual([{
    project_id: 2, tracker_id: 3, parent_issue_id: 10, status_id: 1,
    subject: 'Chosen only on Save', description: '', assigned_to_id: 9,
    custom_fields: [{ id: 7, value: ['100'] }],
  }]);
});

test('heading Status, Priority and Assignee use custom single-select menus without eager writes', async ({ page }) => {
  const state = await setup(page);
  const before = structuredClone(state.rows);
  await openHeading(page);
  await choose(page, 'edit-status', 'Doing');
  await choose(page, 'edit-priority', 'High');
  await choose(page, 'edit-assignee', 'Reviewer');
  for (const [id, value] of [['edit-status', '2'], ['edit-priority', '4'], ['edit-assignee', '9']]) {
    await expect(page.locator(`#editor select#${id}`)).toHaveValue(value);
  }
  expect(state.writes).toEqual([]);
  expect(state.rows).toEqual(before);
  await save(page).click();
  await expect(editor(page)).toBeHidden();
  expect(state.writes).toEqual([{ id: 10, patch: { status_id: 2, priority_id: 4, assigned_to_id: 9 } }]);
  expect(state.posts).toEqual([]);
});

test('keyboard navigation has an active descendant, commits once, and never submits or dismisses the editor', async ({ page }) => {
  const state = await setup(page);
  await creation(page);
  await page.locator('#editor-subject').fill('Keyboard draft');
  const select = page.locator('#creation-project');
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menus(page)).toHaveCount(1);
  await activeOption(page, 'creation-project');
  await page.keyboard.press('End');
  await expect(await activeOption(page, 'creation-project')).toHaveText('Product');
  await expect(select).toHaveValue('');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(await activeOption(page, 'creation-project')).toHaveText('Module 2');
  await page.keyboard.press('ArrowDown');
  await expect(await activeOption(page, 'creation-project')).toHaveText('module 2');
  await page.keyboard.press('ArrowUp');
  await expect(await activeOption(page, 'creation-project')).toHaveText('Module 2');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('2');
  await expect(menus(page)).toHaveCount(0);
  await expect(select).toBeFocused();
  await expect(editor(page)).toBeVisible();
  // Multi-character, case-insensitive typeahead moves focus, not selection.
  await select.press('Space');
  await expect(menus(page)).toHaveCount(1);
  await page.keyboard.type('aLp');
  await expect(await activeOption(page, 'creation-project')).toHaveText('Alpha');
  await expect(select).toHaveValue('2');
  await page.keyboard.press('Escape');
  await expect(menus(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();
  await expect(select).toBeFocused();
  await expect(select).toHaveValue('2');
  await select.press('Space');
  await page.keyboard.press('End');
  await page.keyboard.press('Space');
  await expect(select).toHaveValue('1');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#creation-tracker')).toHaveValue('2');
  // The draft is now valid: Enter on an open dropdown must still not submit.
  await expect(save(page)).toBeEnabled();
  await openMenu(page, 'edit-assignee');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('#edit-assignee')).toHaveValue('9');
  await expect(editor(page)).toBeVisible();
  await openMenu(page, 'creation-project');
  await page.keyboard.press('Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(select).not.toBeFocused();
  await expect(editor(page)).toBeVisible();
  expect(state.posts).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('only one popup is visible, outside clicks close it, and editor close leaves no orphan popup', async ({ page }) => {
  const state = await setup(page);
  await openHeading(page);
  await openMenu(page, 'edit-status');
  // Switch to the field above the open popup, not a control covered by it.
  await openMenu(page, 'edit-assignee');
  await expect(menus(page).getByRole('option')).toHaveText(['Unassigned', 'Developer', 'Reviewer']);
  await expect(page.locator('#edit-status')).toHaveAttribute('aria-expanded', 'false');
  await editor(page).getByRole('heading', { name: 'Description', exact: true }).click();
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#edit-priority')).toHaveValue('2');
  await openMenu(page, 'edit-assignee');
  await editor(page).getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(editor(page)).toBeHidden();
  await expect(menus(page)).toHaveCount(0);
  await openHeading(page);
  await expect(menus(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

for (const closedSprint of [false, true]) {
  test(`${closedSprint ? 'closed Sprint' : 'missing workflow'} disabled selects cannot open custom menus`, async ({ page }) => {
    const state = await setup(page, { closedSprint, workflow: false });
    await openHeading(page);
    for (const id of closedSprint ? ['edit-status', 'edit-priority', 'edit-assignee'] : ['edit-status']) {
      const select = page.locator(`#${id}`);
      await expect(select).toBeDisabled();
      // Disabled controls cannot pass click actionability checks, but actual
      // pointer interaction at their position must not open a custom popup.
      const bounds = await select.boundingBox();
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(menus(page)).toHaveCount(0);
    }
    if (!closedSprint) await openMenu(page, 'edit-priority');
    expect(state.writes).toEqual([]);
    expect(state.posts).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    test(`${theme} popup stays readable and usable above editor clipping at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 650 });
      await setup(page);
      await creation(page);
      await expect(page.locator('#editor-related')).toBeHidden();
      // Empty Related Issues stays hidden in the existing footer, rather than
      // creating a blank message row or displacing the right-aligned Save.
      const footer = await editor(page).locator('.dialog-actions').boundingBox();
      const feedback = await page.locator('#editor-feedback').boundingBox();
      const button = await save(page).boundingBox();
      expect(feedback.height).toBe(0);
      expect(button.x + button.width).toBeCloseTo(footer.x + footer.width, 0);
      const menu = await openMenu(page, 'creation-project');
      await expect(menu).toHaveAttribute('popover', /^(auto|manual)$/);
      expect(await menu.evaluate(node => node.matches(':popover-open'))).toBe(true);
      const assertViewport = async () => {
        const bounds = await menu.boundingBox();
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(650);
      };
      await assertViewport();
      const appearance = await menu.evaluate(node => {
        const style = getComputedStyle(node);
        return { foreground: style.color, background: style.backgroundColor };
      });
      expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(appearance.foreground).not.toBe(appearance.background);
      // Constrain the editor and move its anchor near the bottom of the
      // viewport. This isolates popup flip/clipping from editor layout changes.
      await page.keyboard.press('Escape');
      await editor(page).evaluate(node => {
        node.style.position = 'fixed';
        node.style.inset = 'auto 0 8px';
        node.style.margin = '0 auto';
        node.style.height = '260px';
        node.style.maxHeight = '260px';
        node.style.overflow = 'auto';
      });
      await page.locator('#creation-project').scrollIntoViewIfNeeded();
      await openMenu(page, 'creation-project');
      await assertViewport();
      const anchor = await page.locator('#creation-project').boundingBox();
      const bounds = await menu.boundingBox();
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y + 1);
      const first = menu.getByRole('option', { name: 'Module 10', exact: true });
      await first.scrollIntoViewIfNeeded();
      // A real click proves the popup is not underneath the modal or clipped
      // by the editor, unlike a z-index-only or screenshot-only assertion.
      await first.click();
      await expect(page.locator('#creation-project')).toHaveValue('3');
      await expect(menus(page)).toHaveCount(0);
      await expect(page.locator('#editor-related')).toBeHidden();
      await expect(editor(page).locator('.dialog-actions')).toContainText('Save');
    });
  }
}

test('scrolling the editor closes its popup or repositions it against the select', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await setup(page);
  await creation(page);
  await openMenu(page, 'creation-project');
  await editor(page).evaluate(node => {
    const scroller = [...node.querySelectorAll('*'), node].find(element => element.scrollHeight > element.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY));
    if (!scroller) throw new Error('Expected a scrollable editor at the narrow viewport');
    scroller.scrollTop += 80;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(async () => {
    if (await menus(page).count() === 0) return;
    const anchor = await page.locator('#creation-project').boundingBox(), panel = await menus(page).boundingBox();
    expect(anchor.y + anchor.height).toBeGreaterThan(0);
    expect(anchor.y).toBeLessThan(650);
    const belowGap = Math.abs(panel.y - anchor.y - anchor.height);
    const aboveGap = Math.abs(anchor.y - panel.y - panel.height);
    expect(Math.min(belowGap, aboveGap)).toBeLessThanOrEqual(8);
  }).toPass();
  await editor(page).locator('#editor-subject').click();
  await expect(menus(page)).toHaveCount(0);
});
