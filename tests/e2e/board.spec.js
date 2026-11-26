import { test, expect } from '@playwright/test';

// Unplanned Features are Backlog Cards; planned Tasks exercise individual Sprint Cards.
test.beforeEach(async ({ page }) => {
  await page.route('**/config.json', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), openedStatusId: 2, sprintFieldId: 7, swimlaneTrackers: ['Feature'] } });
  });
});

async function setup(page, { deny = false, ignored = false, denyVersions = false, user = { id: 7, firstname: 'Team', lastname: 'Member' } } = {}) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 3, name: 'Review' }, { id: 5, name: 'Done', is_closed: true }];
  const versions = [{ id: 10, name: 'Sprint 10', status: 'open', project: { id: 1 } }, { id: 11, name: 'Sprint 9', status: 'closed', project: { id: 1 } }];
  const base = { custom_fields: [{ id: 7, value: '' }], tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, allowed_statuses: statuses };
  const issues = [
    { ...base, id: 1, subject: 'Build backlog feature', status: statuses[0], estimated_hours: null },
    { ...base, tracker: { id: 2, name: 'Bug' }, custom_fields: [{ id: 7, value: '10' }], id: 2, subject: 'Already underway', status: statuses[1], fixed_version: { id: 300 }, assigned_to: { id: 7, name: 'Team Member' }, estimated_hours: 3 },
    { ...base, id: 3, subject: '<img src=x onerror="window.injected=true">', status: statuses[0], estimated_hours: 0 },
    { ...base, tracker: { id: 2, name: 'Bug' }, custom_fields: [{ id: 7, value: '10' }], id: 4, subject: 'Unmapped status still visible', status: { id: 8, name: 'Waiting' }, estimated_hours: null },
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
      const version = url.searchParams.get('cf_7'), project = Number(url.searchParams.get('project_id'));
      const status = url.searchParams.get('status_id');
      const value = issue => issue.custom_fields?.find(field => field.id === 7)?.value;
      const unplanned = issue => value(issue) === '' && (status === '*' || (status === 'open' ? !issue.status.is_closed : issue.status.id === Number(status)));
      let selected = issues.filter(issue => issue.project.id === project && (version === '!*' ? unplanned(issue) : Number(value(issue)) === Number(version)));
      const tracker = url.searchParams.get('tracker_id'), assignee = url.searchParams.get('assigned_to_id'), subject = url.searchParams.get('subject'), issueId = url.searchParams.get('issue_id');
      if (tracker) selected = selected.filter(issue => issue.tracker.id === Number(tracker));
      if (assignee) selected = selected.filter(issue => assignee === '!*' ? !issue.assigned_to : issue.assigned_to?.id === Number(assignee));
      if (subject) selected = selected.filter(issue => issue.subject.toLowerCase().includes(subject.replace(/^~/, '').toLowerCase()));
      if (issueId) selected = selected.filter(issue => issue.id === Number(issueId));
      selected.sort((a, b) => a.id - b.id);
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 25);
      return send({ issues: selected.slice(offset, offset + limit), total_count: selected.length, offset });
    }
    if (path.endsWith('/relations.json')) return send({ relations: [] });
    if (path.startsWith('/issues/')) {
      const issue = issues.find(item => item.id === Number(path.match(/\d+/)[0]));
      if (request.method() === 'GET') return send({ issue });
      const patch = request.postDataJSON().issue; writes.push(patch);
      if (deny) return route.fulfill({ status: 403, json: {} });
      if (!ignored) {
        if ('custom_fields' in patch) issue.custom_fields = patch.custom_fields;
        if ('status_id' in patch) issue.status = statuses.find(s => s.id === patch.status_id);
        if ('subject' in patch) issue.subject = patch.subject;
        if ('description' in patch) issue.description = patch.description;
        if ('estimated_hours' in patch) issue.estimated_hours = patch.estimated_hours;
        if ('assigned_to_id' in patch) issue.assigned_to = patch.assigned_to_id ? { id: patch.assigned_to_id, name: patch.assigned_to_id === 7 ? 'Team Member' : 'Other Member' } : undefined;
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
  await expect(page.locator('#filter-controls')).toBeHidden();
  await expect(page.getByLabel('Search backlog')).toBeVisible();
  await expect(page.locator('[data-id="backlog"] header #query')).toBeVisible();
  await expect(page.locator('#tracker')).toBeHidden();
  await page.getByRole('button', { name: 'Backlog filters', exact: true }).click();
}
async function signOut(page) {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}

test('projects without a valid color have transparent swatches', async ({ page }) => {
  await setup(page);
  await page.route('**/redmine/projects.json?**', route => route.fulfill({ json: { projects: [
    { id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Bug' }], custom_fields: [{ name: 'Colore', value: 'invalid' }] },
  ] } }));
  await login(page);
  await expect(page.locator('#project-summary .project-swatch')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.locator('[data-filter="project"] summary').click();
  await expect(page.locator('[data-filter="project"] .project-swatch')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('project overview stays unfiltered, refreshes versions and fits narrow screens', async ({ page }) => {
  const { issues } = await setup(page);
  issues[1].fixed_version = { id: 300, name: '2.10' };
  issues[3].fixed_version = { id: 299, name: '2.9' };
  await page.route('**/redmine/projects.json?**', route => route.fulfill({ json: { projects: [
    { id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Bug' }], custom_fields: [{ name: 'Colore', value: '#123456' }] },
  ] } }));
  await login(page);
  const summary = page.getByRole('region', { name: 'Projects and Target versions' });
  await expect(summary).toHaveText('Team (2.9, 2.10)');
  await page.getByLabel('Search Sprint Cards').fill('no matching cards');
  await expect(page.locator('[data-sprint-empty]')).toBeVisible();
  await expect(summary).toHaveText('Team (2.9, 2.10)');
  await page.locator('[data-filter="project"] summary').click();
  await expect(page.locator('[data-filter="project"] .project-swatch')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.locator('[data-filter="project"] summary').click();
  issues[1].fixed_version = undefined;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(summary).toHaveText('Team (2.9, none)');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(summary).toBeVisible();
    const bounds = await summary.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width <= 1000) {
      const toolbar = await page.locator('.toolbar').boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    }
  }
  await page.getByLabel('Include closed sprints').check();
  await page.getByLabel('Sprint', { exact: true }).selectOption('11');
  await expect(summary).toHaveText('No projects in this Sprint');
});

for (const theme of ['light', 'dark']) {
  test(`project Colore tints only Cards in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await setup(page);
    await page.route('**/redmine/projects.json?**', route => route.fulfill({ json: { projects: [
      { id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }, { id: 2, name: 'Bug' }], custom_fields: [{ id: 9, name: 'Colore', value: '#ffccff' }] },
    ] } }));
    await login(page);
    for (const id of [1, 2]) {
      const card = page.locator(`[data-eid="${id}"]`);
      const colors = await card.evaluate(node => {
        const style = getComputedStyle(node);
        const sample = document.createElement('div');
        sample.style.backgroundColor = `color-mix(in srgb, #ffccff 30%, ${style.getPropertyValue('--content')})`;
        document.body.append(sample);
        const expected = getComputedStyle(sample).backgroundColor;
        sample.remove();
        return { actual: style.backgroundColor, expected, project: style.getPropertyValue('--project-color'), neutral: style.getPropertyValue('--content').trim() };
      });
      expect(colors.project).toBe('#ffccff');
      expect(colors.actual).toBe(colors.expected);
      await expect(card).not.toHaveCSS('background-color', colors.neutral);
    }
    for (const heading of await page.locator('.swimlane-heading').all()) {
      expect(await heading.evaluate(node => getComputedStyle(node).getPropertyValue('--project-color'))).toBe('');
    }
  });
}

test('Sprint filters restore per project and remain independent of Backlog controls', async ({ page }) => {
  const fixture = await setup(page);
  fixture.versions.push({ id: 20, name: 'Other Sprint', status: 'open', project: { id: 2 } });
  fixture.issues.push({ ...fixture.issues[1], id: 20, project: { id: 2, name: 'Other project' }, custom_fields: [{ id: 7, value: '20' }] });
  await login(page);
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  await page.getByLabel('Search Sprint Cards').fill('#2');
  const project = bar.locator('[data-filter="project"]');
  await project.locator('summary').click();
  await project.getByLabel('Team', { exact: true }).check();
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await expect(project.getByRole('checkbox')).toHaveCount(1);
  await page.getByLabel('Search backlog').fill('absent');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match');
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  await bar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByLabel('Search backlog')).toHaveValue('absent');
  await page.getByLabel('Search Sprint Cards').fill('#2');
  await page.locator('#project').selectOption('2');
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('');
  await expect(bar).toContainText('Showing 1 of 1 Cards');
  await page.getByLabel('Search Sprint Cards').fill('#20');
  await page.locator('#project').selectOption('1');
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('#2');
  await expect(bar).toContainText('Showing 1 of 2 Cards');
});

test('flat Sprint search preserves surviving nodes and focus without network searches', async ({ page }) => {
  const fixture = await setup(page);
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, sprintFieldId: 7,
    backlogStatusId: 1, columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: [], refreshSeconds: 60,
  } }));
  await login(page);
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await page.locator('[data-eid="2"]').evaluate(node => { window.survivingCard = node; });
  const before = fixture.requests.length;
  const query = page.getByLabel('Search Sprint Cards');
  await query.fill('ALREADY');
  await expect(query).toBeFocused();
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  expect(await page.locator('[data-eid="2"]').evaluate(node => node === window.survivingCard)).toBe(true);
  await expect(page.locator('.swimlane-headers')).toHaveCount(0);
  await expect(page.locator('[data-sprint-count]')).toHaveText('Showing 1 of 2 Cards');
  expect(fixture.requests.length).toBe(before);
  await query.fill('missing');
  await expect(page.locator('[data-eid="2"]')).toHaveCount(0);
  await expect(page.locator('[data-sprint-empty]')).toBeVisible();
});

test('Sprint dropdowns show selections and clear one filter without resetting the others', async ({ page }) => {
  const fixture = await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Backlog filters', exact: true }).click();
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  await page.getByLabel('Search Sprint Cards').fill('#2');
  const projects = bar.locator('[data-filter="project"]');
  await projects.locator('summary').click();
  await projects.getByLabel('Team', { exact: true }).check();
  await expect(projects.locator('summary')).toHaveText('Project: Team');
  const assignees = bar.locator('[data-filter="assignee"]');
  await assignees.locator('summary').click();
  await assignees.getByLabel('Team Member', { exact: true }).check();
  await expect(assignees.locator('summary')).toHaveText('Assignee: Team Member');
  if (process.env.UI_SCREENSHOTS) await page.screenshot({ path: '.taste-skill/shots/active-filters.png' });
  await assignees.getByRole('button', { name: 'Clear Assignee filter', exact: true }).click();
  await expect(assignees.locator('summary')).toHaveText('Assignee: All');
  await expect(assignees.locator('summary')).toBeFocused();
  await expect(projects.locator('summary')).toHaveText('Project: Team');
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('#2');
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  expect(fixture.writes).toEqual([]);
});

test('Backlog filter state remains visible with its panel closed and after clearing', async ({ page }) => {
  await setup(page);
  await login(page);
  await page.locator('#assignee').selectOption('none');
  const toggle = page.getByRole('button', { name: 'Backlog filters', exact: true });
  await expect(toggle).toHaveText('');
  await expect(toggle).toHaveClass(/has-selection/);
  await expect(toggle).toHaveAttribute('title', /Assignee: Unassigned/);
  await toggle.click();
  await expect(page.locator('#filter-controls')).toBeHidden();
  await expect(toggle).toHaveClass(/has-selection/);
  await page.getByLabel('Search backlog').fill('feature');
  await expect(toggle).toHaveAttribute('title', /Assignee: Unassigned/);
  await toggle.click();
  await page.getByLabel('Show closed issues', { exact: true }).check();
  await expect(toggle).toHaveAttribute('title', /Assignee: Unassigned\nClosed issues included/);
  await page.locator('#clear-filters').click();
  await expect(page.getByLabel('Search backlog')).toHaveValue('');
  await expect(toggle).toHaveAttribute('title', 'Backlog filters\nClosed issues included');
  await page.getByLabel('Show closed issues', { exact: true }).uncheck();
  await expect(toggle).toHaveAttribute('title', 'Backlog filters');
  await expect(toggle).not.toHaveClass(/has-selection/);
});

test('Sprint filters stay on one compact row and dropdowns track their scrolled anchors', async ({ page }) => {
  await setup(page);
  await login(page);
  const bar = page.locator('#sprint-filters');
  for (const width of [1440, 1024, 820, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await bar.evaluate(node => ({ height: node.getBoundingClientRect().height, pageOverflow: document.documentElement.scrollWidth > innerWidth }));
    expect(geometry.height).toBeLessThanOrEqual(width <= 600 ? 60 : 46);
    expect(geometry.pageOverflow).toBe(false);
  }
  await page.setViewportSize({ width: 640, height: 900 });
  const controls = bar.locator('[data-sprint-controls]');
  const dropdown = bar.locator('[data-filter="tag"]');
  await dropdown.locator('summary').click();
  const panel = dropdown.locator('.sprint-filter-options');
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  await controls.evaluate(node => { node.scrollLeft = 0; });
  await expect.poll(() => dropdown.evaluate(node => node.open)).toBe(false);
  await dropdown.locator('summary').click();
  await expect.poll(async () => {
    const bounds = await panel.boundingBox();
    return bounds && bounds.x >= 8 && bounds.x + bounds.width <= 632 && bounds.y + bounds.height <= 892;
  }).toBe(true);
  expect(before).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect(dropdown.locator('summary')).toBeFocused();
});

test('Sprint filters occupy a full-width panel with right-aligned results', async ({ page }) => {
  await setup(page);
  await login(page);
  const geometry = await page.locator('#sprint-filters').evaluate(panel => {
    const bounds = panel.getBoundingClientRect(), workspace = panel.parentElement.getBoundingClientRect();
    const count = panel.querySelector('[data-sprint-count]').getBoundingClientRect();
    const style = getComputedStyle(panel);
    return { left: bounds.left, right: bounds.right, workspaceLeft: workspace.left, workspaceRight: workspace.right,
      countRight: count.right, padding: parseFloat(style.paddingRight), border: parseFloat(style.borderRightWidth) };
  });
  expect(geometry.left).toBe(geometry.workspaceLeft);
  expect(geometry.right).toBe(geometry.workspaceRight);
  expect(geometry.border).toBe(1);
  expect(geometry.countRight).toBeCloseTo(geometry.right - geometry.padding - geometry.border, 0);
});

test('keeps planning controls and commitment in one compact line', async ({ page }) => {
  await setup(page);
  await login(page);
  await expect(page.locator('.planning-prototype-switcher')).toHaveCount(0);
  await expect(page.locator('.masthead #planning-controls')).toBeVisible();
  for (const id of ['refresh', 'refresh-now']) {
    const button = page.locator(`#${id}`);
    await expect(button).toHaveText('');
    await expect(button.locator('svg')).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', /refresh/i);
    await expect(button).toHaveAttribute('title', /refresh/i);
  }
  const sprintLabelGap = await page.locator('.sprint-control').evaluate(control => {
    const label = control.querySelector('label').getBoundingClientRect();
    const select = control.querySelector('select').getBoundingClientRect();
    return select.left - label.right;
  });
  expect(sprintLabelGap).toBe(8);
  const sprintLabelWidth = await page.locator('.sprint-control > label').evaluate(label => label.getBoundingClientRect().width);
  expect(sprintLabelWidth).toBeLessThan(50);
  for (const width of [1527, 1024, 600]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.locator('.masthead .toolbar').evaluate(row => ({
      height: row.getBoundingClientRect().height,
      width: row.clientWidth,
      contentWidth: row.scrollWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      centers: [...row.querySelectorAll('#project, #sprint, #closed, #sprint-state, #totals')]
        .map(element => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; }),
    }));
    expect(geometry.height).toBeLessThanOrEqual(width <= 600 ? 54 : 44);
    expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThanOrEqual(2);
    expect(geometry.pageOverflow).toBe(false);
    if (width === 1527) expect(geometry.contentWidth).toBe(geometry.width);
    if (width === 600) expect(geometry.contentWidth).toBeGreaterThan(geometry.width);
  }
  await page.setViewportSize({ width: 1920, height: 1000 });
  const centered = await page.locator('#planning-controls').evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    const state = panel.querySelector('#sprint-state').getBoundingClientRect();
    const totals = panel.querySelector('#totals').getBoundingClientRect();
    return { center: bounds.left + bounds.width / 2, width: bounds.width, totalsGap: totals.left - state.right };
  });
  expect(centered.center).toBeCloseTo(960, 0);
  expect(centered.width).toBeLessThan(1200);
  expect(centered.totalsGap).toBe(16);
  await page.getByLabel('Include closed sprints').check();
  await expect(page.locator('#sprint option', { hasText: 'Sprint 9' })).toHaveCount(1);
});

test('remembers the project and an explicit Sprint per project across visits', async ({ page }) => {
  const { versions } = await setup(page);
  versions.push(
    { id: 12, name: 'Sprint 12', status: 'open', project: { id: 1 } },
    { id: 20, name: 'Other Sprint', status: 'open', project: { id: 2 } },
    { id: 21, name: 'Other Sprint 2', status: 'open', project: { id: 2 } },
  );
  await login(page);
  await page.locator('#sprint').selectOption('12');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#project').selectOption('2');
  await page.locator('#sprint').selectOption('21');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await login(page);
  await expect(page.locator('#project')).toHaveValue('2');
  await expect(page.locator('#sprint')).toHaveValue('21');
  await page.locator('#project').selectOption('1');
  await expect(page.locator('#sprint')).toHaveValue('12');
});

test('closed and inaccessible saved Sprints fall back without erasing the preference', async ({ page }) => {
  const { versions } = await setup(page);
  await login(page);
  await page.locator('#closed').check();
  await page.locator('#sprint').selectOption('11');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await login(page);
  await expect(page.locator('#closed')).not.toBeChecked();
  await expect(page.locator('#sprint')).toHaveValue('10');
  versions.find(version => version.id === 11).status = 'open';
  await login(page);
  await expect(page.locator('#sprint')).toHaveValue('11');
  versions.splice(versions.findIndex(version => version.id === 11), 1);
  await login(page);
  await expect(page.locator('#sprint')).toHaveValue('10');
  versions.push({ id: 11, name: 'Sprint 9', status: 'open', project: { id: 1 } });
  await login(page);
  await expect(page.locator('#sprint')).toHaveValue('11');
});

test('selection preferences remain separate when the authenticated user changes', async ({ page }) => {
  const user = { id: 7, firstname: 'Team', lastname: 'Member' };
  await setup(page, { user });
  await login(page);
  await page.locator('#project').selectOption('2');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await signOut(page);
  user.id = 8;
  await login(page);
  await expect(page.locator('#project')).toHaveValue('1');
  await signOut(page);
  user.id = 7;
  await login(page);
  await expect(page.locator('#project')).toHaveValue('2');
});

test('unavailable saved project falls back without replacing the preference', async ({ page }) => {
  await setup(page);
  await login(page);
  await page.locator('#project').selectOption('2');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  const hideProject = async route => route.fulfill({ json: { projects: [{ id: 1, name: 'Team', trackers: [{ id: 1, name: 'Feature' }] }] } });
  await page.route('**/redmine/projects.json?*', hideProject);
  await login(page);
  await expect(page.locator('#project')).toHaveValue('1');
  await page.unroute('**/redmine/projects.json?*', hideProject);
  await login(page);
  await expect(page.locator('#project')).toHaveValue('2');
});

test('blocked selection storage does not break connection or selectors', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (key.startsWith('redmine-sprint-board.selection:')) throw new Error('Storage blocked');
        return original.call(this, key, ...args);
      };
    }
  });
  await login(page);
  await page.locator('#closed').check();
  await page.locator('#sprint').selectOption('11');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#project').selectOption('2');
  await expect(page.locator('#sprint')).toHaveValue('');
  await page.locator('#project').selectOption('1');
  await expect(page.locator('#sprint')).toHaveValue('11');
  await expect(page.locator('#notice')).not.toHaveClass('error');
});
async function setAppearance(page, mode) {
  const button = page.getByRole('button', { name: /^Appearance:/ });
  for (let step = 0; step < 3 && await button.getAttribute('data-theme') !== mode; step++) await button.click();
  await expect(button).toHaveAttribute('data-theme', mode);
}
async function drag(page, id, target) {
  const source = page.locator(`[data-eid="${id}"] h3`), column = page.locator(`.kanban-board[data-id="${target}"]`);
  const lanes = column.locator('.swimlane-cards');
  const destination = await lanes.count() ? lanes.first() : column.locator('.kanban-drag');
  await source.dragTo(destination);
}

for (const activation of ['click', 'keyboard']) {
  test(`issue ID opens Redmine in a new tab via ${activation}`, async ({ page }) => {
    const fixture = await setup(page);
    await page.route('**/config.json', route => route.fulfill({ json: {
      redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, backlogStatusId: 1, sprintFieldId: 7, swimlaneTrackers: ['Feature'],
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
    if (control === 'query') await page.getByLabel('Search backlog').fill('Already');
    if (control === 'tracker') await page.getByLabel('Tracker', { exact: true }).selectOption('1');
    if (control === 'assignee') await page.getByLabel('Assignee', { exact: true }).selectOption('7');
    try {
      await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('button', { name: 'Plan #2', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => window.stableBoard.isConnected && window.stableColumns.every(node => node.isConnected))).toBe(true);
      await expect(page.locator('[data-eid="2"]')).toBeVisible();
    } finally { release(); }
    await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(() => ({
      sameBoard: window.stableBoard === document.querySelector('.kanban-container'),
      sameColumns: window.stableColumns.every(node => node.isConnected),
      sameCard: window.stableCard === document.querySelector('[data-eid="2"]'),
      sameHeading: window.stableHeading === document.querySelector('[data-eid="2"] h3'),
      removals: window.boardRemovals,
    }))).toEqual({ sameBoard: true, sameColumns: true, sameCard: true, sameHeading: true, removals: 0 });
  });
}

test('Backlog search keeps Sprint interaction and collapse available', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  let held = false;
  await page.route('**/redmine/issues.json?**', async route => {
    if (!held && new URL(route.request().url()).searchParams.has('subject')) { held = true; started(); await gate; }
    await route.fallback();
  });
  await page.getByLabel('Search backlog').fill('absent');
  await requestStarted;
  try {
    await expect(page.locator('#loading-overlay')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Collapse Backlog', exact: true })).toBeEnabled();
    expect(fixture.writes).toEqual([]);
  } finally { release(); }
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await page.getByRole('button', { name: 'Plan #2', exact: true }).click();
  await expect(page.locator('#editor')).toBeVisible();
});

test('filters survive refresh and Sprint switches, but reset on project change and sign-out', async ({ page }) => {
  await setup(page); await login(page);
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Assignee', { exact: true }).selectOption('none');
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Search backlog').fill('Build');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('Search backlog')).toHaveValue('Build');
  await page.getByLabel('Include closed sprints').check();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Sprint', { exact: true }).selectOption('11');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('Search backlog')).toHaveValue('Build');
  await expect(page.locator('#tracker')).toHaveValue('1');
  await expect(page.locator('#assignee')).toHaveValue('none');
  await page.getByLabel('Project', { exact: true }).selectOption('2');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByLabel('Search backlog')).toHaveValue('');
  await expect(page.locator('#tracker')).toHaveValue('');
  await expect(page.locator('#assignee')).toHaveValue('');
  await page.getByLabel('Search backlog').fill('retained?');
  await signOut(page);
  await page.getByLabel('Personal API key').fill('test-personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.getByLabel('Search backlog')).toHaveValue('');
});

test('Tracker choices include eligible Module metadata but exclude unrelated projects and ordinary trackers', async ({ page }) => {
  await setup(page);
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, sprintFieldId: 7, backlogStatusId: 1,
    columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: ['Feature', 'Improvement', 'Bug'], refreshSeconds: 60,
  } }));
  await page.route('**/redmine/projects.json?**', route => route.fulfill({ json: { projects: [
    { id: 1, name: 'Product', trackers: [{ id: 1, name: 'Feature' }, { id: 8, name: 'Task' }] },
    { id: 3, name: 'Module', parent: { id: 1 }, trackers: [{ id: 4, name: 'Improvement' }] },
    { id: 2, name: 'Unrelated', trackers: [{ id: 2, name: 'Bug' }] },
  ] } }));
  await login(page);
  await expect(page.locator('#tracker option')).toHaveText(['All eligible trackers', 'Feature', 'Improvement']);
  await page.getByLabel('Tracker', { exact: true }).selectOption('4');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match these filters');
  await page.getByLabel('Project', { exact: true }).selectOption('3');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#tracker option')).toHaveText(['All eligible trackers', 'Improvement']);
});

test('Tracker is disabled when no configured Swimlane-capable trackers are available', async ({ page }) => {
  await setup(page);
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, sprintFieldId: 7, backlogStatusId: 1,
    columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: [], refreshSeconds: 60,
  } }));
  await login(page);
  await expect(page.locator('#tracker')).toBeDisabled();
  await expect(page.locator('#tracker option')).toHaveText(['All eligible trackers']);
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
});

test('Clear filters resets all four Backlog controls without changing Show closed or Sprint', async ({ page }) => {
  const fixture = await setup(page); fixture.issues[0].tags = ['release'];
  await login(page);
  await page.getByRole('checkbox', { name: 'Show closed issues', exact: true }).check();
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await page.getByLabel('Assignee', { exact: true }).selectOption('none');
  await page.getByLabel('Search backlog').fill('Build');
  await page.getByLabel('Backlog tag', { exact: true }).fill('release');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  for (const id of ['query', 'tracker', 'assignee', 'backlog-tag']) await expect(page.locator(`#${id}`)).toHaveValue('');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Show closed issues', exact: true })).toBeChecked();
  await expect(page.getByLabel('Sprint', { exact: true })).toHaveValue('10');
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
});

async function setupScrollableSprint(page, grouped = false) {
  await page.setViewportSize({ width: 800, height: 650 });
  const fixture = await setup(page);
  await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, sprintFieldId: 7,
    backlogStatusId: 1, columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: [], refreshSeconds: 60,
  } }));
  if (grouped) await page.route('**/config.json', route => route.fulfill({ json: {
    redminePublicUrl: 'https://redmine.example.test', openedStatusId: 2, sprintFieldId: 7,
    backlogStatusId: 1, columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: ['Feature'], refreshSeconds: 60,
  } }));
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[1], id, subject: `Already underway ${id}` });
  await login(page, true);
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await page.evaluate(() => {
    document.getElementById('board').scrollLeft = 300;
    document.querySelector('[data-id="status-2"] .kanban-drag').scrollTop = 350;
  });
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 300, y: 350 });
  return fixture;
}
const visibleSprintAnchor = page => page.locator('[data-id="status-2"] .kanban-drag').evaluate(list => {
  const top = list.getBoundingClientRect().top;
  const card = [...list.querySelectorAll('.kanban-item')].find(card => card.getBoundingClientRect().bottom > top);
  return { id: card.dataset.eid, offset: card.getBoundingClientRect().top - top };
});
const sprintPosition = page => page.evaluate(() => ({
  x: document.getElementById('board').scrollLeft,
  y: document.querySelector('[data-id="status-2"] .kanban-drag').scrollTop,
}));

test('current Sprint scroll survives a page reload', async ({ page }) => {
  await setupScrollableSprint(page);
  const anchor = await visibleSprintAnchor(page);
  await page.reload();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  // Column widths can change on reload (Backlog filters start closed), so the
  // Card's position, rather than an exact pixel offset, is the invariant.
  await expect.poll(() => visibleSprintAnchor(page)).toEqual(anchor);
  expect((await sprintPosition(page)).x).toBe(300);
});

test('returning to the tab refreshes quietly and keeps the visible Card anchored', async ({ page }) => {
  const fixture = await setupScrollableSprint(page);
  const anchor = await visibleSprintAnchor(page);
  // Remove content above the viewport: a pixel-only restore would show a different Card.
  fixture.issues.splice(fixture.issues.findIndex(issue => issue.id === 2), 1);
  await page.evaluate(() => {
    window.overlayOpened = false;
    const dialog = document.getElementById('loading-overlay');
    new MutationObserver(() => { if (dialog.open) window.overlayOpened = true; }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('[data-eid="2"]')).toHaveCount(0);
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.overlayOpened)).toBe(false);
  await expect.poll(() => page.locator(`[data-eid="${anchor.id}"]`).evaluate(card =>
    card.getBoundingClientRect().top - card.closest('.kanban-drag').getBoundingClientRect().top)).toBeCloseTo(anchor.offset, 0);
  expect((await sprintPosition(page)).x).toBe(300);
});

test('Sprint filters and scope changes discard the current scroll position', async ({ page }) => {
  await setupScrollableSprint(page);
  await page.getByLabel('Search Sprint Cards').fill('Already');
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 0, y: 0 });
  await page.evaluate(() => {
    document.getElementById('board').scrollLeft = 300;
    document.querySelector('[data-id="status-2"] .kanban-drag').scrollTop = 350;
  });
  await page.getByLabel('Include closed sprints').check();
  await page.locator('#sprint').selectOption('11');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#sprint').selectOption('10');
  await expect(page.locator('[data-id="status-2"] .kanban-item')).toHaveCount(31);
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 0, y: 0 });
});

test('current-board scroll is discarded on project changes and sign-out', async ({ page }) => {
  await setupScrollableSprint(page);
  await page.locator('#project').selectOption('2');
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#project').selectOption('1');
  await expect(page.locator('[data-id="status-2"] .kanban-item')).toHaveCount(31);
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 0, y: 0 });
  await page.evaluate(() => { document.getElementById('board').scrollLeft = 300; });
  await signOut(page);
  expect(await page.evaluate(() => sessionStorage.getItem('redmine-sprint-board.scroll'))).toBeNull();
});

test('a missing anchor falls back to a bounded offset after refresh', async ({ page }) => {
  const fixture = await setupScrollableSprint(page);
  const anchor = await visibleSprintAnchor(page);
  fixture.issues.splice(fixture.issues.findIndex(issue => String(issue.id) === anchor.id), 1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator(`[data-eid="${anchor.id}"]`)).toHaveCount(0);
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 300, y: 350 });
  fixture.issues.splice(4);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('[data-id="status-2"] .kanban-item')).toHaveCount(1);
  await expect.poll(() => sprintPosition(page)).toEqual({ x: 300, y: 0 });
});

test('Swimlane Columns restore a synchronized position after reload', async ({ page }) => {
  await setupScrollableSprint(page, true);
  const anchor = await visibleSprintAnchor(page);
  await page.reload();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await expect.poll(() => visibleSprintAnchor(page)).toEqual(anchor);
  const offsets = await page.locator('.has-swimlanes').evaluateAll(lists => lists.map(list => list.scrollTop));
  expect(offsets.length).toBe(4);
  expect(offsets.every(y => y === offsets[0] && y > 0)).toBe(true);
});

test('unchanged filters preserve column scroll, horizontal scroll, focus and card nodes', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  const fixture = await setup(page);
  for (let id = 100; id < 120; id++) fixture.issues.push({ ...fixture.issues[1], id, subject: `Already underway ${id}` });
  await login(page);
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
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
  await page.getByLabel('Search backlog').fill('failed');
  await expect(page.locator('#filtered')).toContainText('showing previous results');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(before);
  expect(await page.evaluate(() => window.confirmedCard.isConnected)).toBe(true);
  const requestsAfterFailure = failedRequests;
  await page.getByLabel('Backlog issues', { exact: true }).evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(failedRequests).toBe(requestsAfterFailure);
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('Previous results');
  await page.unroute('**/redmine/issues.json?**');
  await page.getByLabel('Search backlog').fill('Build');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#filtered')).not.toContainText('unavailable');
});

test('Backlog filters leave Sprint totals and board geometry unchanged', async ({ page }) => {
  await setup(page); await login(page);
  const summary = page.locator('#filtered');
  await expect(summary).toBeEmpty();
  const before = await page.locator('#board').boundingBox();
  const searchBefore = await page.locator('#query').boundingBox();
  const filterRow = await page.locator('.filters').boundingBox();
  const lastFilter = await page.locator('#backlog-tag').boundingBox();
  expect(Math.abs(lastFilter.x + lastFilter.width - filterRow.x - filterRow.width)).toBeLessThanOrEqual(1);
  await page.getByLabel('Search backlog').fill('#2');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match these filters');
  await expect(summary).toBeEmpty();
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  await expect(page.locator('#totals')).toContainText('2issues');
  expect(await page.locator('#board').boundingBox()).toEqual(before);
  expect(await page.locator('#query').boundingBox()).toEqual(searchBefore);
  await page.getByLabel('Search backlog').fill('');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toBeEmpty();
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toBeEmpty();
  await page.getByLabel('Tracker', { exact: true }).selectOption('');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toBeEmpty();
  expect(await page.locator('#board').boundingBox()).toEqual(before);
});

test('empty search results do not change the board or column geometry', async ({ page }) => {
  await setup(page); await login(page);
  const before = await page.locator('.kanban-container').boundingBox();
  const columns = await page.locator('.kanban-board').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  await page.getByLabel('Search backlog').fill('No issue can match this');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match these filters');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(2);
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
    if (params.get('subject') === '~Build' && params.get('cf_7') === '!*') {
      started(); await gate;
    }
    await route.fallback();
  });
  await page.getByLabel('Search backlog').fill('Build');
  await firstRequest;
  // Simulate a superseding application event; real user input is blocked by
  // the overlay, but stale-response protection must still hold.
  await page.locator('#query').evaluate(input => { input.value = 'Already'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  try {
    await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
    await expect(page.locator('[data-eid="2"]')).toBeVisible();
  } finally { release(); }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
  await expect(page.getByLabel('Search backlog')).toHaveValue('Already');
});

for (const width of [1280, 390]) {
  test(`board messages fit the existing thin bottom status bar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await login(page);
    const statusbar = page.locator('#statusbar');
    const before = await statusbar.boundingBox();
    const boardBefore = await page.locator('#board').boundingBox();
    const message = 'A long Redmine error. '.repeat(40);
    await page.route('**/redmine/projects/1/versions.json**', route => route.fulfill({ status: 503, json: { errors: [message] } }));
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    const notice = statusbar.locator('#notice');
    await expect(notice).toContainText(message.trim());
    await expect(page.locator('main > #notice')).toHaveCount(0);
    expect(await statusbar.boundingBox()).toEqual(before);
    expect(before.height).toBe(24);
    expect(await page.locator('#board').boundingBox()).toEqual(boardBefore);
    const geometry = await notice.evaluate(node => {
      const text = node.querySelector('span'), bounds = node.getBoundingClientRect();
      return { clipped: text.scrollWidth > text.clientWidth, right: bounds.right, height: bounds.height };
    });
    expect(geometry.clipped).toBe(true);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.height).toBeLessThanOrEqual(24);
    await expect(notice.locator('button, a')).toHaveCount(0);
    await expect(notice).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(notice).toHaveAttribute('title', `Refresh failed: ${message}`);
    const indicator = await notice.evaluate(node => {
      const dot = getComputedStyle(node, '::before');
      return { text: node.textContent, color: getComputedStyle(node).color, dotColor: dot.backgroundColor, dotSize: dot.width };
    });
    expect(indicator.text).toBe(`Refresh failed: ${message}`);
    expect(indicator.dotColor).toBe(indicator.color);
    expect(indicator.dotSize).toBe('7px');
    await signOut(page);
    await expect(page.locator('main > #notice')).toContainText('API key forgotten');
    await expect(statusbar).toBeHidden();
  });
}

test('Sprint Cards show project and Target Version while Backlog retains its tracker', async ({ page }) => {
  const { issues } = await setup(page);
  const release = '<release> 2.10 ' + 'long version name '.repeat(8);
  issues[1].fixed_version = { id: 300, name: release };
  issues[1].assigned_to = { id: 7, name: 'Alexandra Example With A Very Long Name' };
  await login(page);
  const metadata = page.locator('[data-eid="2"] .card-project');
  await expect(metadata).toHaveText(`Team (${release})`);
  await expect(metadata).toHaveAttribute('title', `Team (${release})`);
  await expect(page.locator('[data-eid="2"] .card-tracker')).toHaveCount(0);
  await expect(page.locator('[data-eid="2"] release')).toHaveCount(0);
  await expect(page.locator('[data-eid="1"] .card-tracker')).toHaveText('Feature');
  await expect(page.locator('[data-eid="1"] .card-project')).toHaveCount(0);
  const geometry = await metadata.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const assignee = node.parentElement.querySelector('.card-assignee').getBoundingClientRect();
    return { left: bounds.left, assigneeRight: assignee.right, clipped: node.scrollWidth > node.clientWidth };
  });
  expect(geometry.assigneeRight).toBeLessThanOrEqual(geometry.left);
  expect(geometry.clipped).toBe(true);
  issues[1].fixed_version = undefined;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(metadata).toHaveText('Team (none)');
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
  fixture.issues[1].assigned_to = { id: 9, name: 'Updated Assignee' };
  fixture.issues[1].tracker = { id: 1, name: 'Updated Tracker' };
  fixture.issues[1].fixed_version = { id: 300, name: 'Updated Release' };
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('[data-eid="2"] h3')).toHaveText('Updated on Redmine');
  await expect(page.locator('[data-eid="2"] .card-assignee')).toHaveText('UAUpdated Assignee');
  await expect(page.locator('[data-eid="2"] .card-project')).toHaveText('Team (Updated Release)');
  await expect(page.locator('[data-eid="2"] .card-tracker')).toHaveCount(0);
  await expect(page.locator('[data-eid="2"]')).not.toHaveClass(/prio-/);
  await expect(page.locator('[data-eid="2"] .card-footer strong')).toHaveCount(0);
  expect(await page.evaluate(() => window.updatedCard === document.querySelector('[data-eid="2"]') && window.updatedTitle === window.updatedCard.querySelector('h3') && window.updatedButton === window.updatedCard.querySelector('.plan'))).toBe(true);
});

for (const name of ['High', 'Alta']) {
  test(`priority ${name} label, status and estimate are hidden on cards`, async ({ page }) => {
    const fixture = await setup(page);
    fixture.issues[0].priority = { id: 42, name };
    await login(page);
    const card = page.locator('[data-eid="1"]');
    await expect(card).toHaveClass(/prio-high/);
    await expect(card.locator('.card-bottom, .card-field, .card-footer strong')).toHaveCount(0);
    await expect(card.locator('[title^="Priority:"], [title^="Status:"], [title="Unestimated"], .resolved')).toHaveCount(0);
    await expect(card.locator('.card-tracker')).toHaveText(fixture.issues[0].tracker.name);
    await expect(card.locator('.plan')).toBeVisible();
  });
}

test('Column title rows align, with Backlog search controls inline', async ({ page }) => {
  await setup(page); await login(page);
  const headers = await page.locator('.kanban-board header').evaluateAll(nodes => nodes.map(header => {
    const title = header.querySelector('.kanban-title-board');
    const range = document.createRange(); range.selectNodeContents(title.firstChild);
    const text = range.getBoundingClientRect(), bounds = title.getBoundingClientRect();
    const count = header.querySelector('.count')?.getBoundingClientRect();
    const toggle = header.querySelector('.backlog-toggle')?.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height, center: bounds.top + bounds.height / 2,
      textCenter: text.top + text.height / 2,
      countCenter: count ? count.top + count.height / 2 : null,
      toggleCenter: toggle ? toggle.top + toggle.height / 2 : null };
  }));
  for (const header of headers) {
    expect(Math.abs(header.top - headers[0].top)).toBeLessThanOrEqual(1);
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
    await expect(guide).toContainText('Drag a Backlog parent');
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
  await expect(page.locator('#project')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await expect(page.locator('.kanban-item').first()).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await expect(page.locator('#project')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#editor')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
  await page.getByRole('button', { name: 'Close editor' }).click();
  await page.route('**/redmine/issues.json?**', route => route.fulfill({ status: 422, json: { errors: ['A theme test error'] } }));
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#notice.error')).toContainText('A theme test error');
  await expect(page.locator('#notice')).toHaveCSS('color', 'rgb(255, 188, 170)');
  await expect(page.locator('#notice')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.locator('#project')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#notice')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('#project')).toHaveCSS('background-color', 'rgb(30, 31, 34)');
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
    await page.locator('.brand-mark').click();
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

test('autorefresh is opt-in, waits an interval, survives scope switches and resets on reload/sign-out', async ({ page }) => {
  await page.clock.install();
  const fixture = await setup(page); await login(page);
  const toggle = page.getByRole('button', { name: 'Autorefresh', exact: true });
  const count = () => fixture.requests.filter(request => new URL(request.url()).pathname.endsWith('/versions.json')).length;
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const initial = count();
  await page.clock.runFor(125000);
  expect(count()).toBe(initial);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute('title', 'Autorefresh on — disable');
  await page.clock.runFor(59000);
  expect(count()).toBe(initial);
  await page.clock.runFor(1000);
  await expect.poll(count).toBe(initial + 1);
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await toggle.click();
  const stopped = count();
  await page.clock.runFor(125000);
  expect(count()).toBe(stopped);
  // Visibility-return remains independent from timed polling.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(count).toBe(stopped + 1);
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await toggle.click();
  await page.getByLabel('Project', { exact: true }).selectOption('2');
  await expect(page.locator('#loading-overlay')).not.toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await signOut(page);
  await login(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await page.reload();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#refresh')).toHaveAttribute('aria-pressed', 'false');
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`Redmine icon indicates tab-return loading and clears on success and failure (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await setup(page);
    await login(page);
    await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
    const mark = page.locator('.brand-mark'), icon = mark.locator('img');
    await expect(mark).toHaveAttribute('aria-busy', 'false');
    for (const failed of [false, true]) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/redmine/projects/1/versions.json*', async route => {
        await gate;
        if (failed) await route.fulfill({ status: 500, json: {} });
        else await route.fallback();
      });
      const requested = page.waitForRequest('**/redmine/projects/1/versions.json*');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await requested;
      try {
        await expect(mark).toHaveAttribute('aria-busy', 'true');
        await expect(icon).toHaveCSS('animation-name', reducedMotion === 'reduce' ? 'none' : 'brand-pulse');
        await expect(mark).toHaveCSS('outline-style', 'none');
        await expect(icon).toHaveCSS('transform', 'none');
        if (reducedMotion === 'reduce') {
          await expect(icon).toHaveCSS('opacity', '1');
        } else {
          // Verify the actual fade, not merely the animation's presence.
          const opacities = await icon.evaluate(node => {
            const animation = node.getAnimations()[0];
            animation.pause();
            const samples = [0, 500, 1000].map(time => {
              animation.currentTime = time;
              return Number(getComputedStyle(node).opacity);
            });
            animation.play();
            return samples;
          });
          expect(opacities).toEqual([1, 0.2, 1]);
        }
        await expect(page.locator('#loading-overlay')).not.toBeVisible();
      } finally { release(); }
      await expect(mark).toHaveAttribute('aria-busy', 'false');
      await expect(icon).toHaveCSS('animation-name', 'none');
      await page.unroute('**/redmine/projects/1/versions.json*');
    }
  });
}

test('Redmine icon stays active through Backlog search and stops on completion', async ({ page }) => {
  await setup(page);
  await login(page);
  const mark = page.locator('.brand-mark');
  await expect(mark).toHaveAttribute('aria-busy', 'false');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/redmine/issues.json?**', async route => { await gate; await route.fallback(); });
  await page.getByLabel('Search backlog').fill('Build');
  try {
    await expect(mark).toHaveAttribute('aria-busy', 'true');
    await expect(mark.locator('img')).toHaveCSS('animation-name', 'brand-pulse');
    await expect(page.locator('#loading-overlay')).not.toBeVisible();
  } finally { release(); }
  await expect(mark).toHaveAttribute('aria-busy', 'false');
});

test('loading overlay blocks login and keyboard interaction, cannot be escaped, and clears on failure', async ({ page }) => {
  await setup(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/redmine/users/current.json', async route => {
    await gate; await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/');
  await page.getByLabel('Personal API key').fill('invalid');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  const overlay = page.locator('#loading-overlay');
  try {
    await expect(overlay).toBeVisible();
    await expect(page.locator('.brand-mark')).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Escape');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('#loading-overlay') !== null || document.activeElement === document.body)).toBe(true);
    const bounds = await overlay.boundingBox();
    expect(bounds.width).toBe(1440); expect(bounds.height).toBe(1000);
  } finally { release(); }
  await expect(overlay).not.toBeVisible();
  await expect(page.locator('#notice')).toContainText('Invalid or revoked API key');
  await expect(page.locator('.brand-mark')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Connect to Redmine' })).toBeEnabled();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 650 }]) {
  test(`refresh lives in the topbar and last update in a thin bottom bar at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    await page.goto('/');
    await expect(page.locator('#refresh')).not.toBeVisible();
    await expect(page.locator('#statusbar')).not.toBeVisible();
    await login(page);
    const refresh = page.locator('#refresh-now');
    const statusbar = page.getByRole('contentinfo', { name: 'Board status' });
    await expect(refresh).toBeInViewport();
    await expect(refresh).toHaveText('');
    await expect(refresh).toHaveAttribute('aria-label', 'Refresh now');
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
      await expect(page.locator('#loading-overlay')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#loading-overlay')).toBeVisible();
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#updated')).toHaveText(previousUpdate);
      expect(await statusbar.boundingBox()).toEqual(status);
    } finally { release(); }
    await expect(page.locator('#loading-overlay')).not.toBeVisible();
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
    for (const id of ['project', 'sprint', 'tracker', 'assignee', 'edit-assignee']) {
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
    await page.locator('#edit-assignee').selectOption('7');
    await expect(page.locator('#edit-assignee')).toHaveValue('7');
    await page.getByRole('button', { name: 'Close editor' }).click();
  });

  test(`Sprint Cards have neutral borders regardless of priority in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    ['Alta', 'Media', 'Bassa', 'Normale'].forEach((name, index) => { fixture.issues[index].priority = { id: index + 40, name }; });
    fixture.issues[3].status = fixture.issues[0].status; // Keep every priority sample in a configured Column.
    await login(page);
    const borders = await page.locator('[data-id^="status-"] .kanban-item').evaluateAll(nodes => nodes.map(node => {
      const css = getComputedStyle(node);
      return { left: css.borderLeftColor, right: css.borderRightColor, width: css.borderLeftWidth };
    }));
    for (const border of borders) {
      expect(border.left).toBe(border.right);
      expect(border.width).toBe('1px');
    }
    expect(new Set(borders.map(border => border.left)).size).toBe(1);
  });

  test(`only Backlog Cards show priority stripes in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    const priorities = [
      ['Bassa', 'low'], ['Media', 'normal'], ['Alta', 'high'],
      ['Urgente', 'urgent'], ['Immediata', 'immediate'], ['Custom priority', 'none'],
    ];
    priorities.forEach(([name], index) => fixture.issues.push({ ...fixture.issues[0], id: 100 + index,
      priority: { id: 100 + index, name } }));
    await login(page);
    for (const [index, [, tier]] of priorities.entries()) {
      const card = page.locator(`[data-id="backlog"] [data-eid="${100 + index}"]`);
      await expect(card).toHaveClass(new RegExp(`prio-${tier}`));
      const color = await card.evaluate((node, tier) => {
        const probe = document.createElement('span');
        probe.style.color = `var(--priority-${tier})`;
        node.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }, tier);
      await expect(card.locator('.card-priority')).toHaveCount(0);
      await expect(card).toHaveCSS('border-left-width', '5px');
      await expect(card).toHaveCSS('border-left-color', color);
      await card.hover();
      await expect(card).toHaveCSS('border-left-color', color);
      await card.locator('.plan').focus();
      await expect(card).toHaveCSS('border-left-color', color);
      await expect(card.locator('.card-field, .card-bottom')).toHaveCount(0);
    }
    await expect(page.locator('[data-id="status-2"] [data-eid="2"]')).toHaveCSS('border-left-width', '1px');
  });

  test(`cards keep assignee and tracker on one compact row in ${mode} mode`, async ({ page }) => {
    const fixture = await setup(page);
    const names = ['Low', 'Normal', 'High', 'Urgent', 'Immediate', 'Custom priority'];
    names.forEach((name, index) => fixture.issues.push({ ...fixture.issues[0], id: 100 + index,
      subject: `Issue with ${name.toLowerCase()} priority`, priority: { id: 100 + index, name },
      assigned_to: { id: 9, name: 'Alexandra Example With A Very Long Name' } }));
    await login(page);
    await setAppearance(page, mode);
    for (let index = 0; index < names.length; index++) {
      const card = page.locator(`[data-eid="${100 + index}"]`);
      await expect(card).toBeVisible();
      const geometry = await card.evaluate(node => {
        const assignee = node.querySelector('.card-assignee').getBoundingClientRect();
        const name = node.querySelector('.card-assignee > span:last-child');
        const tracker = node.querySelector('.card-tracker').getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return { assigneeRight: assignee.right, assigneeCenter: assignee.top + assignee.height / 2,
          trackerLeft: tracker.left, trackerRight: tracker.right, trackerCenter: tracker.top + tracker.height / 2,
          cardRight: bounds.right, truncated: name.scrollWidth > name.clientWidth,
          nameOverflow: getComputedStyle(name).textOverflow };
      });
      expect(geometry.assigneeRight).toBeLessThanOrEqual(geometry.trackerLeft);
      expect(geometry.trackerRight).toBeLessThan(geometry.cardRight);
      expect(Math.abs(geometry.assigneeCenter - geometry.trackerCenter)).toBeLessThanOrEqual(1);
      expect(geometry.truncated).toBe(true);
      expect(geometry.nameOverflow).toBe('ellipsis');
    }
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
    const toolbar = await page.locator('.masthead .toolbar').boundingBox();
    const commitment = page.getByRole('region', { name: 'Sprint commitment' });
    const summary = await commitment.boundingBox();
    expect(summary.y).toBeGreaterThanOrEqual(toolbar.y);
    expect(summary.x).toBeGreaterThan(toolbar.x);
    expect(summary.x + summary.width).toBeLessThanOrEqual(toolbar.x + toolbar.width);
    await expect(page.locator('.toolbar .summary')).toHaveCount(1);
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

test('long Backlog search errors stay local and keep the board usable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup(page); await login(page);
  const message = 'Detailed upstream explanation. '.repeat(60);
  await page.route('**/redmine/issues.json?**', route => route.fulfill({ status: 422, json: { errors: [message] } }));
  await page.getByLabel('Search backlog').fill('failed search');
  await expect(page.locator('#filtered')).toContainText('Search unavailable');
  await expect(page.locator('#filtered')).toHaveAttribute('title', new RegExp('Detailed upstream explanation'));
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Plan #2', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight)).toBe(720);
  await expect(page.getByRole('button', { name: 'Refresh now', exact: true })).toBeInViewport();
});

test('compact board exposes filters and allows board-only horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await setup(page); await login(page);
  await expect(page.getByLabel('Search backlog')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.scrollingElement.scrollWidth, height: document.scrollingElement.scrollHeight,
    boardWidth: document.getElementById('board').clientWidth, boardScrollWidth: document.getElementById('board').scrollWidth,
  }));
  expect(dimensions.width).toBe(800); expect(dimensions.height).toBe(650);
  expect(dimensions.boardScrollWidth).toBeGreaterThan(dimensions.boardWidth);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByLabel('Search backlog')).toBeVisible();
  await expect(page.locator('[data-id="backlog"] #filter-controls')).toBeVisible();
});

test('phone layout keeps the board in the viewport and planning controls reachable by scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await login(page);
  await expect(page.getByRole('button', { name: /^Appearance:/ })).toBeInViewport();
  await expect(page.getByLabel('Project', { exact: true })).toBeInViewport();
  await page.getByLabel('Sprint', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Sprint', { exact: true })).toBeInViewport();
  await page.getByLabel('Include closed sprints').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Include closed sprints')).toBeInViewport();
  const geometry = await page.evaluate(() => ({
    pageWidth: document.scrollingElement.scrollWidth, pageHeight: document.scrollingElement.scrollHeight,
    boardHeight: document.getElementById('board').clientHeight,
  }));
  expect(geometry.pageWidth).toBe(390);
  expect(geometry.pageHeight).toBe(844);
  expect(geometry.boardHeight).toBeGreaterThan(200);
});

for (const width of [1280, 390]) {
  test(`Backlog collapses to a keyboard-accessible rail at ${width}px and reloads on expansion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const fixture = await setup(page); await login(page);
    const column = page.locator('[data-id="backlog"]');
    const card = await column.locator('[data-eid="1"]').elementHandle();
    const beforeWidth = (await page.locator('.kanban-board[data-id="status-2"]').boundingBox()).width;
    const requests = fixture.requests.length;
    const collapse = page.getByRole('button', { name: 'Collapse Backlog', exact: true });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.focus(); await page.keyboard.press('Enter');
    const expand = page.getByRole('button', { name: 'Expand Backlog', exact: true });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toHaveAttribute('title', 'Expand Backlog');
    await expect(page.getByLabel('Backlog issues', { exact: true })).toBeHidden();
    await expect(column.locator('footer')).toBeHidden();
    await expect(column.locator('[data-backlog-scope]')).toHaveCount(0);
    expect((await column.boundingBox()).width).toBe(40);
    const centers = await column.evaluate(node => {
      const center = element => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
      return { rail: center(node), label: center(node.querySelector('.backlog-label')), toggle: center(node.querySelector('.backlog-toggle')) };
    });
    expect(Math.abs(centers.label - centers.rail)).toBeLessThanOrEqual(1);
    expect(Math.abs(centers.toggle - centers.rail)).toBeLessThanOrEqual(1);
    if (width === 1280) expect((await page.locator('.kanban-board[data-id="status-2"]').boundingBox()).width).toBeGreaterThan(beforeWidth);
    expect(await card.evaluate(node => node.isConnected)).toBe(false);
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBe(width);
    expect(fixture.requests.length).toBe(requests);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Collapse Backlog', exact: true })).toBeFocused();
    await expect(page.getByLabel('Backlog issues', { exact: true })).toBeVisible();
    await expect(column.locator('[data-eid="1"]')).toBeVisible();
    expect(fixture.requests.length).toBe(requests + 1);
    expect(fixture.writes).toEqual([]);
  });
}

test('collapsed Backlog survives refresh, filters and reconnecting without draining hidden pages', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 150; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  await page.getByRole('button', { name: 'Collapse Backlog', exact: true }).click();
  const backlogRequests = () => fixture.requests.filter(request => new URL(request.url()).searchParams.get('cf_7') === '!*').length;
  const before = backlogRequests();
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(backlogRequests()).toBe(before);
  await expect(page.getByRole('button', { name: 'Expand Backlog', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Backlog', exact: true }).click();
  await page.getByLabel('Search backlog').fill('Build backlog');
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Collapse Backlog', exact: true }).click();
  await expect(page.locator('[data-id="backlog"] .backlog-filtered')).toHaveText('Filtered');
  await expect(page.getByLabel('Search backlog')).toBeHidden();
  await expect(page.getByLabel('Backlog issues', { exact: true })).toBeHidden();
  const beforeReload = backlogRequests();
  await page.reload();
  await page.getByLabel('Personal API key').fill('test-personal-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.getByRole('button', { name: 'Expand Backlog', exact: true })).toBeVisible();
  await expect(page.getByLabel('Backlog issues', { exact: true })).toBeHidden();
  expect(backlogRequests()).toBe(beforeReload);
  await page.getByRole('button', { name: 'Expand Backlog', exact: true }).click();
  await expect(page.getByLabel('Backlog issues', { exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('expansion loading is local, cancellable, fresh and explicitly retryable', async ({ page }) => {
  const fixture = await setup(page); await login(page);
  await page.getByRole('button', { name: 'Collapse Backlog', exact: true }).click();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  let fail = false, hold = true;
  await page.route('**/redmine/issues.json?**', async route => {
    if (new URL(route.request().url()).searchParams.get('cf_7') !== '!*') return route.fallback();
    if (hold) { hold = false; started(); await gate; }
    if (fail) return route.fulfill({ status: 500, json: {} });
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Expand Backlog', exact: true }).click();
  await requestStarted;
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Plan #2', exact: true })).toBeEnabled();
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse Backlog', exact: true }).click();
  release();
  fail = true;
  await page.getByRole('button', { name: 'Expand Backlog', exact: true }).click();
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('Could not load Backlog');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(0);
  fail = false; fixture.issues[0].subject = 'Freshly changed feature';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-id="backlog"]')).toContainText('Freshly changed feature');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeHidden();
});

test('collapsed Backlog skips polling, tab-return, scope changes and post-save loading', async ({ page }) => {
  await page.clock.install();
  const fixture = await setup(page); await login(page);
  fixture.versions.push({ id: 12, name: 'Sprint 12', status: 'open', project: { id: 1 } });
  const backlogRequests = () => fixture.requests.filter(request => new URL(request.url()).searchParams.get('cf_7') === '!*').length;
  await page.getByRole('button', { name: 'Collapse Backlog', exact: true }).click();
  const before = backlogRequests();
  await page.getByRole('button', { name: 'Plan #2', exact: true }).click();
  await page.getByLabel('Estimated hours').fill('4');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#editor')).toBeHidden();
  await page.getByRole('button', { name: 'Autorefresh', exact: true }).click();
  await page.clock.fastForward(60000);
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#sprint').selectOption('12');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#project').selectOption('2');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(backlogRequests()).toBe(before);
});

test('backlog requests one column-sized page, not every page', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const requests = fixture.requests.filter(request => new URL(request.url()).searchParams.get('cf_7') === '!*');
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
  await page.getByLabel('Search backlog').fill('needle');
  await expect.poll(() => fixture.requests.some(request => new URL(request.url()).searchParams.get('subject') === '~needle')).toBe(true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await expect(page.locator('[data-id="backlog"]')).toContainText('Unseen needle');
});

test('scrolling appends another page without duplicates or reloading metadata', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 130; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Backlog ${id}` });
  await login(page);
  const column = page.getByLabel('Backlog issues', { exact: true });
  const count = page.locator('[data-id="backlog"] .kanban-item');
  const metadataCount = fixture.requests.filter(request => new URL(request.url()).pathname.endsWith('/versions.json')).length;
  const firstPage = Number(new URL(fixture.requests.filter(request => new URL(request.url()).searchParams.get('cf_7') === '!*')[0].url()).searchParams.get('limit'));
  await expect(count).toHaveCount(firstPage);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await page.route('**/redmine/issues.json?**', async route => {
    if (Number(new URL(route.request().url()).searchParams.get('offset')) > 0) { started(); await gate; }
    await route.fallback();
  });
  await column.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await requestStarted;
  try {
    await expect(page.locator('#loading-overlay')).not.toBeVisible();
    await page.getByRole('button', { name: 'Autorefresh', exact: true }).click();
    await expect(page.locator('#refresh')).toHaveAttribute('aria-pressed', 'true');
  } finally { release(); }
  expect(await column.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => count.count()).toBeGreaterThan(firstPage);
  await expect(page.locator('[data-id="backlog"] .kanban-drag')).toHaveAttribute('aria-busy', 'false');
  const ids = await count.evaluateAll(elements => elements.map(element => element.dataset.eid));
  expect(new Set(ids).size).toBe(ids.length);
  const requests = fixture.requests.filter(request => new URL(request.url()).searchParams.get('cf_7') === '!*');
  // The second page continues from where the first stopped rather than refetching it.
  expect(requests.map(request => new URL(request.url()).searchParams.get('offset'))).toEqual(['0', String(firstPage)]);
  expect(fixture.requests.filter(request => new URL(request.url()).pathname.endsWith('/versions.json'))).toHaveLength(metadataCount);
});

test('tracker and assignee filters query unseen issues on the server and preserve sprint totals', async ({ page }) => {
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: id === 109 ? 'Unseen needle' : `Backlog ${id}`, ...(id === 109 ? { assigned_to: { id: 9, name: 'Other Member' } } : {}) });
  await login(page);
  await page.getByLabel('Tracker', { exact: true }).selectOption('1');
  await page.getByLabel('Assignee', { exact: true }).selectOption('9');
  await expect(page.locator('[data-id="backlog"]')).toContainText('Unseen needle');
  await page.getByLabel('Search backlog').fill('needle');
  await expect.poll(() => fixture.requests.some(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('subject') === '~needle' && params.get('tracker_id') === '1' && params.get('assigned_to_id') === '9' && params.get('cf_7') === '!*';
  })).toBe(true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(1);
  await expect(page.locator('#totals')).toContainText('2issues');
  await expect(page.locator('#filtered')).toBeEmpty();
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  const filteredSprintRequests = fixture.requests.filter(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('cf_7') === '10' && params.get('subject') === '~needle' && params.get('tracker_id') === '1' && params.get('assigned_to_id') === '9';
  });
  expect(filteredSprintRequests).toHaveLength(0);
  const fullSprintRequests = fixture.requests.filter(request => {
    const params = new URL(request.url()).searchParams;
    return params.get('cf_7') === '10' && !params.has('tracker_id') && !params.has('assigned_to_id') && !params.has('subject');
  });
  expect(fullSprintRequests).toHaveLength(1);
});

test('search is debounced and resets the backlog cursor', async ({ page }) => {
  await page.clock.install();
  const fixture = await setup(page);
  for (let id = 100; id < 110; id++) fixture.issues.push({ ...fixture.issues[0], id, subject: `Needle ${id}` });
  await login(page);
  await expect(page.locator('[data-id="backlog"] .kanban-item').first()).toBeVisible();
  await page.getByLabel('Search backlog').fill('n');
  await page.getByLabel('Search backlog').fill('nee');
  await page.getByLabel('Search backlog').fill('needle');
  await page.clock.runFor(350);
  // One search for three keystrokes, restarted at offset 0. The stable board lets
  // pagination measure real Cards rather than falling back to an empty-board estimate.
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  const searches = fixture.requests.filter(request => new URL(request.url()).searchParams.has('subject') && new URL(request.url()).searchParams.get('cf_7') === '!*');
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
    if (params.get('cf_7') === '!*' && params.get('offset') !== '0' && !failed) { failed = true; return route.fulfill({ status: 503, json: {} }); }
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
  await expect(page.locator('#notice')).toContainText('Added/confirmed: #1');
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
  await expect(page.locator('#sprint-state')).toContainText('Sprint data unavailable');
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
  await expect(page.getByRole('button', { name: 'Refresh now', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Autorefresh', exact: true }).click();
  await page.clock.runFor(125000);
  expect(count()).toBe(1);
  fixture.allowVersions();
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#notice')).toBeHidden();
  expect(count()).toBe(2);
});

test('loads backlog, all sprint statuses and totals without executing issue HTML', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = await setup(page); await login(page);
  await expect(page.locator('#sprint-name')).toHaveCount(0);
  await expect(page.locator('.toolbar .summary')).toHaveCount(1);
  await expect(page.locator('.closed-sprints-toggle')).toHaveText('');
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(2);
  await expect(page.locator('.kanban-board[data-id="status-2"]')).toContainText('Already underway');
  await expect(page.locator('.unmapped-notice summary')).toContainText('1 issues outside displayed statuses');
  await page.locator('.unmapped-notice summary').click();
  await expect(page.locator('.unmapped-notice')).toContainText('Unmapped status still visible');
  await expect(page.locator('.kanban-board[data-id="other"]')).toHaveCount(0);
  await expect(page.locator('#totals')).toContainText('3estimated hours');
  await page.getByLabel('Search backlog').fill('#2');
  await expect(page.locator('[data-id="backlog"] footer')).toContainText('No backlog issues match these filters');
  await expect(page.locator('[data-eid="2"]')).toBeVisible();
  await expect(page.locator('#totals')).toContainText('2issues');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(errors).toEqual([]);
  expect(fixture.requests.every(request => request.headers()['x-redmine-api-key'] === 'test-personal-key')).toBe(true);
  expect(fixture.requests.every(request => !request.url().includes('test-personal-key'))).toBe(true);
});

for (const width of [1440, 390]) {
  test(`planning dialog shows the full issue description safely at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    const fixture = await setup(page);
    const description = `<h2>Issue details</h2><p>First <strong>important</strong> line<br>Next line</p>
      <ul><li>First item</li></ul><a href="https://example.test/details">Details</a>
      <img src=x onerror="window.injected=true" style="position:fixed" id="unsafe-image">
      <script>window.injected=true</script><iframe srcdoc="<script>window.injected=true</script>"></iframe>
      <a href="javascript:window.injected=true">Unsafe link</a><form><input autofocus><button>Unsafe button</button></form>
      ${'<p>Long description line</p>'.repeat(100)}<pre>${'x'.repeat(300)}</pre><p>Last line</p>`;
    fixture.issues[0].description = description;
    await login(page);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    const body = page.locator('#editor-description');
    await expect(page.locator('#editor-subject')).toHaveValue('Build backlog feature');
    await expect(page.locator('#edit-description')).toBeHidden();
    await expect(page.locator('#description-preview')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#description-write')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#description-hint')).toBeHidden();
    expect(await page.getByRole('group', { name: 'Description mode' }).getByRole('button').evaluateAll(buttons => buttons.map(button => button.id))).toEqual(['description-preview', 'description-write']);
    const heading = page.getByRole('heading', { name: 'Description', exact: true });
    const headingBounds = await heading.boundingBox();
    for (const name of ['Read description', 'Edit description']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('title', name);
      await expect(button).toHaveText('');
      await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
      await expect(heading.locator('..').getByRole('button', { name, exact: true })).toHaveCount(1);
      const bounds = await button.boundingBox();
      expect(bounds.y).toBeLessThan(headingBounds.y + headingBounds.height);
      expect(bounds.y + bounds.height).toBeGreaterThan(headingBounds.y);
    }
    await expect(body.getByRole('heading', { name: 'Issue details' })).toBeVisible();
    await expect(body.locator('strong')).toHaveText('important');
    await expect(body.locator('br')).toHaveCount(1);
    await expect(body.getByRole('listitem')).toHaveText('First item');
    await expect(body.getByRole('link', { name: 'Details', exact: true })).toHaveAttribute('href', 'https://example.test/details');
    await expect(body.locator('p').last()).toHaveText('Last line');
    await expect(body.locator('img')).toHaveCount(1);
    await expect(body.locator('img')).not.toHaveAttribute('onerror');
    await expect(body.locator('img')).not.toHaveAttribute('style');
    await expect(body.locator('img')).not.toHaveAttribute('id');
    await expect(body.locator('script, iframe, form, input, button')).toHaveCount(0);
    await expect(body.getByText('Unsafe link', { exact: true })).not.toHaveAttribute('href');
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    const editorBounds = await page.locator('#editor').boundingBox();
    const expectedWidth = Math.min(800, width - 32);
    // Native dialog max-width can trim an extra 2px on narrow viewports.
    expect(editorBounds.width).toBeGreaterThanOrEqual(expectedWidth - 2);
    expect(editorBounds.width).toBeLessThanOrEqual(expectedWidth);
    expect(editorBounds.x).toBeGreaterThanOrEqual(16);
    expect(editorBounds.x + editorBounds.width).toBeLessThanOrEqual(width - 16);
    expect(await page.locator('#editor').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Save changes' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeInViewport();
    await page.getByRole('button', { name: 'Close editor' }).click();
    await page.getByRole('button', { name: 'Plan #2', exact: true }).click();
    await expect(page.locator('#editor-description-section')).toBeVisible();
    await expect(page.locator('#edit-description')).toBeHidden();
    await expect(page.locator('#description-preview')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#edit-description')).toHaveValue('');
    await expect(body).toBeEmpty();
  });
}

for (const id of [1, 2]) {
  test(`keyboard-accessible planner preserves untouched text while changing assignee and estimate for issue #${id}`, async ({ page }) => {
    const { writes } = await setup(page); await login(page);
    await page.getByRole('button', { name: `Plan #${id}`, exact: true }).click();
    const editor = page.locator('#editor');
    await expect(editor.locator('input:visible, select:visible')).toHaveCount(id === 1 ? 5 : 3);
    if (id === 1) await expect(editor.getByLabel('Status', { exact: true })).toBeVisible();
    else await expect(editor.locator('#edit-status')).toBeHidden();
    await expect(editor.getByLabel('Planning destination')).toHaveCount(0);
    await expect(editor.locator('#editor-tags, #editor-warning')).toHaveCount(0);
    await expect(editor).not.toContainText('Redmine enforces workflow');
    await expect(editor.getByRole('link', { name: 'Open in Redmine' })).toBeVisible();
    await page.getByLabel('Assignment', { exact: true }).selectOption('7');
    await page.getByLabel('Estimated hours', { exact: true }).fill('5.5');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.locator(`[data-id="${id === 1 ? 'backlog' : 'status-2'}"] [data-eid="${id}"]`)).toBeVisible();
    expect(writes).toEqual([{ ...(id === 1 ? { assigned_to_id: 7 } : {}), estimated_hours: 5.5 }]);
  });
}

for (const statusId of [1, 2]) {
  test(`drag from backlog into status ${statusId} commits work and only changes necessary fields`, async ({ page }) => {
    const { writes } = await setup(page); await login(page);
    await drag(page, 1, `status-${statusId}`);
    await expect(page.locator('#notice')).toContainText('Added/confirmed: #1');
    await expect(page.locator('.swimlane-headers > [data-lane="1"]')).toBeVisible();
    expect(writes).toEqual([{ custom_fields: [{ id: 7, value: '10' }], status_id: 2 }]);
  });
}

test('removing in-progress work does not reset its status', async ({ page }) => {
  const { writes } = await setup(page); await login(page);
  await drag(page, 2, 'backlog');
  await expect(page.locator('#notice')).toContainText('It is not Swimlane-capable');
  await expect(page.locator('[data-eid="2"]')).toHaveCount(0);
  expect(writes).toEqual([{ custom_fields: [{ id: 7, value: '' }] }]);
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
    await expect(page.locator('#notice')).toContainText('did not retain the requested changes');
    await expect(page.locator('[data-id="backlog"] [data-eid="1"]')).toBeVisible();
    expect(writes).toEqual([{ custom_fields: [{ id: 7, value: '10' }], status_id: 2 }]);
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

test('Show closed opts in to closed unplanned Swimlane-capable issues, and is remembered', async ({ page }) => {
  const fixture = await setup(page);
  const unplanned = { custom_fields: [{ id: 7, value: '' }], tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, estimated_hours: null };
  fixture.issues.push(
    { ...unplanned, id: 5, subject: 'Unplanned, in progress', status: { id: 2, name: 'Open' } },
    { ...unplanned, id: 6, subject: 'Unplanned and done', status: { id: 5, name: 'Done', is_closed: true } },
  );
  await login(page, true);
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(3);
  // The checkbox lives in the expandable Backlog filter panel.
  const toggle = page.locator('[data-id="backlog"] #filter-controls #backlog-closed');
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
  await expect(page.locator('[data-eid="6"]')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('[data-id="backlog"] [data-eid="6"]')).toBeVisible();
  await expect(page.locator('[data-id="backlog"] .kanban-item')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.locator('#backlog-closed')).toBeChecked();
  await expect(page.locator('#filter-controls')).toBeHidden();
  await expect(page.locator('[data-id="backlog"] [data-eid="6"]')).toBeVisible();
});

test('all open statuses remain eligible after clearing a search', async ({ page }) => {
  const fixture = await setup(page);
  fixture.issues.push({ custom_fields: [{ id: 7, value: '' }], id: 5, subject: 'Unplanned, in progress', status: { id: 2, name: 'Open' }, tracker: { id: 1, name: 'Feature' }, priority: { id: 2, name: 'Normal' }, project: { id: 1, name: 'Team' }, estimated_hours: null });
  await login(page);
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toBeVisible();
  await page.getByLabel('Search backlog').fill('underway');
  await expect(page.locator('[data-id="backlog"] [data-eid="5"]')).toHaveCount(0);
  await page.getByLabel('Search backlog').fill('');
  await expect(page.getByLabel('Show all unplanned')).toHaveCount(0);
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
  await expect(page.locator('#editor')).not.toBeVisible();
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

// Rescheduling includes every descendant, including nested headings and closed
// issues, unlike the open non-heading candidates for Add missing subtasks.
async function setupReschedule(page) {
  const fixture = await setup(page);
  fixture.versions[0].created_on = '2026-01-02T00:00:00Z';
  fixture.versions[0].due_date = '2020-01-01';
  fixture.versions[1].created_on = '2026-01-04T00:00:00Z';
  fixture.versions.push(
    { id: 13, name: 'Later tie', status: 'open', project: { id: 1 }, sharing: 'descendants', created_on: '2026-01-03T00:00:00Z', due_date: '2025-01-01' },
    { id: 14, name: 'Earlier sprint', status: 'open', project: { id: 1 }, sharing: 'descendants', created_on: '2026-01-01T00:00:00Z', due_date: '2099-01-01' },
    { id: 12, name: 'Next sprint', status: 'open', project: { id: 1 }, sharing: 'descendants', created_on: '2026-01-03T00:00:00Z', due_date: '2098-01-01' },
    { id: 20, name: 'Module release', status: 'open', project: { id: 2 }, sharing: 'tree', created_on: '2026-01-03T00:00:00Z' },
    { id: 21, name: 'Not shared', status: 'open', project: { id: 1 }, sharing: 'none', created_on: '2026-01-03T00:00:00Z' },
  );
  const root = fixture.issues[0];
  root.custom_fields = [{ id: 7, value: '10' }];
  root.children = [{ id: 2 }, { id: 30 }];
  fixture.issues[1].parent = { id: 1 };
  fixture.issues.push(
    { ...fixture.issues[1], id: 30, subject: 'Closed branch', parent: { id: 1 }, children: [{ id: 31 }], status: { id: 5, name: 'Done', is_closed: true } },
    { ...root, id: 31, subject: 'Nested open heading in another sprint', parent: { id: 30 }, children: [{ id: 32 }], custom_fields: [{ id: 7, value: '14' }] },
    { ...fixture.issues[1], id: 32, subject: 'Open grandchild without a sprint', parent: { id: 31 }, custom_fields: [{ id: 7, value: '' }] },
  );
  return fixture;
}

async function openReschedule(page) {
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  // Initial hierarchy scans can outlive the foreground refresh. Wait for their
  // visible completion before installing gates or opening a second hierarchy read.
  await expect(page.locator('[data-add-descendants="1"]')).toHaveAttribute('title', /missing\)/);
  const button = page.getByRole('button', { name: 'Reschedule swimlane #1', exact: true });
  await expect(button).toHaveAttribute('data-reschedule-swimlane', '1');
  await expect(button).toHaveAttribute('title', 'Reschedule this swimlane issue and all descendants, including closed issues, to another Sprint.');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('dialog', { name: 'Reschedule swimlane', exact: true })).toBeVisible();
  await expect(page.locator('#reschedule-dialog')).toBeVisible();
  await expect(page.locator('#reschedule-count')).toHaveText('5 issues will move, including the swimlane issue and all descendants, closed and non-closed.');
  await expect(page.locator('#reschedule-target')).toBeEnabled();
}

function rescheduleWrites(fixture) {
  return fixture.requests.filter(request => request.method() === 'PUT').map(request => ({
    id: Number(new URL(request.url()).pathname.match(/issues\/(\d+)/)[1]),
    patch: request.postDataJSON().issue,
  }));
}

test('reschedule moves the parent and all descendants, including closed children and nested headings', async ({ page }) => {
  const fixture = await setupReschedule(page);
  const original = structuredClone(fixture.issues);
  await login(page);
  await openReschedule(page);
  await expect(page.getByLabel('Target sprint', { exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
  await expect(page.locator('#notice')).toContainText('Moved/confirmed: #1, #2, #30, #31, #32. Failed/unconfirmed: none. Not attempted: none.');
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(rescheduleWrites(fixture)).toEqual([1, 2, 30, 31, 32].map(id => ({ id, patch: { custom_fields: [{ id: 7, value: '12' }] } })));
  for (const issue of fixture.issues) {
    const before = original.find(item => item.id === issue.id);
    expect(issue).toEqual([1, 2, 30, 31, 32].includes(issue.id) ? { ...before, custom_fields: [{ id: 7, value: '12' }] } : before);
  }
  expect(fixture.issues.find(issue => issue.id === 30).status).toEqual({ id: 5, name: 'Done', is_closed: true });
  await expect(page.locator('#sprint')).toHaveValue('10');
  await expect(page.locator('[data-reschedule-swimlane="1"]')).toHaveCount(0);
  await page.locator('#sprint').selectOption('12');
  await expect(page.locator('[data-reschedule-swimlane="1"]')).toBeVisible();
  await expect(page.locator('[data-reschedule-swimlane="31"]')).toBeVisible();
  await expect(page.locator('[data-eid="32"]')).toBeVisible();
});

test('reschedule targets are newest first with descending ID ties, retain the next sprint default, and cancel makes no writes', async ({ page }) => {
  const fixture = await setupReschedule(page);
  const original = structuredClone(fixture.issues);
  await login(page);
  await openReschedule(page);
  const target = page.getByLabel('Target sprint', { exact: true });
  expect(await target.locator('option').evaluateAll(options => options.filter(option => option.value).map(option => option.value))).toEqual(['13', '12', '14']);
  await expect(target).toHaveValue('12');
  await target.selectOption('13');
  await expect(page.locator('#reschedule-cancel')).toHaveText('Cancel');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.issues).toEqual(original);
  await expect(page.locator('#sprint')).toHaveValue('10');
});

test('reschedule requires a manual target when there is no next sprint by creation', async ({ page }) => {
  const fixture = await setupReschedule(page);
  fixture.versions[0].created_on = '2026-02-01T00:00:00Z';
  await login(page);
  await openReschedule(page);
  await expect(page.getByLabel('Target sprint', { exact: true })).toHaveValue('');
  await expect(page.locator('#reschedule-submit')).toHaveText('Reschedule');
  await expect(page.locator('#reschedule-submit')).toBeDisabled();
  expect(fixture.writes).toEqual([]);
  await page.getByLabel('Target sprint', { exact: true }).selectOption('14');
  await expect(page.locator('#reschedule-submit')).toBeEnabled();
  await page.locator('#reschedule-submit').click();
  await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
  await expect(page.locator('#notice')).toContainText('Moved/confirmed: #1, #2, #30, #31, #32. Failed/unconfirmed: none. Not attempted: none.');
  // The nested heading already belongs to 14 and must not be rewritten.
  expect(rescheduleWrites(fixture)).toEqual([1, 2, 30, 32].map(id => ({ id, patch: { custom_fields: [{ id: 7, value: '14' }] } })));
  await expect(page.locator('#sprint')).toHaveValue('10');
});

for (const closed of ['parent', 'source sprint']) {
  test(`reschedule is disabled for a closed ${closed}`, async ({ page }) => {
    const fixture = await setupReschedule(page);
    if (closed === 'parent') fixture.issues[0].status = { id: 5, name: 'Done', is_closed: true };
    else fixture.versions[0].status = 'closed';
    await login(page);
    if (closed === 'source sprint') {
      await page.getByLabel('Include closed sprints').check();
      await page.locator('#sprint').selectOption('10');
    }
    await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('button', { name: 'Reschedule swimlane #1', exact: true })).toBeDisabled();
    await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
    expect(fixture.writes).toEqual([]);
  });
}

for (const versionId of [10, 12]) {
  test(`reschedule rechecks ${versionId === 10 ? 'source' : 'target'} sprint openness before any writes`, async ({ page }) => {
    const fixture = await setupReschedule(page);
    await login(page);
    await openReschedule(page);
    fixture.versions.find(version => version.id === versionId).status = 'closed';
    await page.locator('#reschedule-submit').click();
    await expect(page.locator('#notice')).toContainText(/no longer open|not open|closed|must still be open/i);
    expect(fixture.writes).toEqual([]);
  });
}

test('reschedule stops after a rejected descendant write and reports moved, failed and unattempted issues without rollback', async ({ page }) => {
  const fixture = await setupReschedule(page);
  const original = structuredClone(fixture.issues);
  await login(page);
  await openReschedule(page);
  await page.route('**/redmine/issues/2.json', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    return route.fulfill({ status: 403, json: {} });
  });
  await page.locator('#reschedule-submit').click();
  await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
  const notice = page.locator('#notice');
  await expect(notice).toContainText(/moved[^;\n]*#1/i);
  await expect(notice).toContainText(/failed[^;\n]*#2/i);
  await expect(notice).toContainText(/(?:unattempted|not attempted)[^;\n]*#30[^;\n]*#31[^;\n]*#32/i);
  expect(rescheduleWrites(fixture)).toEqual([{ id: 1, patch: { custom_fields: [{ id: 7, value: '12' }] } }]);
  for (const issue of fixture.issues) {
    const before = original.find(item => item.id === issue.id);
    expect(issue).toEqual(issue.id === 1 ? { ...before, custom_fields: [{ id: 7, value: '12' }] } : before);
  }
  await expect(page.locator('#sprint')).toHaveValue('10');
});


test('reschedule controls are disabled during target loading and while a confirmed move is busy', async ({ page }) => {
  const fixture = await setupReschedule(page);
  await login(page);
  await openReschedule(page);
  await page.locator('#reschedule-cancel').click();
  let releaseLoading;
  const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
  await page.route('**/redmine/projects/1/versions.json?**', async route => {
    await loadingGate;
    await route.fallback();
  });
  const button = page.getByRole('button', { name: 'Reschedule swimlane #1', exact: true });
  await button.click();
  try {
    await expect(button).toBeDisabled();
    await expect(page.locator('#reschedule-submit')).toBeDisabled();
    expect(fixture.writes).toEqual([]);
  } finally { releaseLoading(); }
  await expect(page.locator('#reschedule-dialog')).toBeVisible();
  await expect(page.locator('#reschedule-count')).toHaveText('5 issues will move, including the swimlane issue and all descendants, closed and non-closed.');
  await expect(page.locator('#reschedule-submit')).toBeEnabled();
  let releaseWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  await page.route('**/redmine/issues/1.json', async route => {
    if (route.request().method() === 'PUT') await writeGate;
    await route.fallback();
  });
  await page.locator('#reschedule-submit').click();
  try {
    await expect(button).toBeDisabled();
    await expect(page.locator('#reschedule-submit')).toBeDisabled();
  } finally { releaseWrite(); }
  await expect(page.locator('#notice')).toContainText('Moved/confirmed: #1, #2, #30, #31, #32');
});

test('planner saves a new title and sanitized Markdown HTML, then reloads the saved text', async ({ page }) => {
  const fixture = await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText('#1 — Build backlog feature');
  await expect(page.locator('#description-preview')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#description-write').click();
  await expect(page.locator('#description-write')).toHaveAttribute('aria-pressed', 'true');
  const subject = 'Revised <strong>plain text</strong> title';
  const markdown = '# Acceptance\n\nA **bold** result with [details](https://example.test/details).\n\n- First item\n- Second item\n\n<script>window.injected=true</script>\n<img src=x onerror="window.injected=true">\n[Unsafe](javascript:alert(1))';
  await page.locator('#editor-subject').fill(subject);
  await page.locator('#edit-description').fill(markdown);
  await page.locator('#description-preview').click();
  const preview = page.locator('#editor-description');
  await expect(preview.getByRole('heading', { name: 'Acceptance' })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('bold');
  await expect(preview.getByRole('listitem')).toHaveText(['First item', 'Second item']);
  await expect(preview.getByRole('link', { name: 'details', exact: true })).toHaveAttribute('href', 'https://example.test/details');
  await expect(preview.locator('script, [onerror], [href^="javascript:"]')).toHaveCount(0);
  const html = await preview.innerHTML();
  await page.locator('#description-write').click();
  await expect(page.locator('#edit-description')).toHaveValue(markdown);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toEqual([{ subject, description: html }]);
  expect(fixture.issues[0].description).toBe(html);
  await expect(page.locator('[data-eid="1"]')).toContainText(subject);
  await expect(page.locator('[data-eid="1"] strong')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#editor-title')).toHaveText(`#1 — ${subject}`);
  await expect(page.locator('#editor-subject')).toHaveValue(subject);
  await expect(page.locator('#description-preview')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#edit-description')).toBeHidden();
  await expect(preview.getByRole('heading', { name: 'Acceptance' })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('bold');
});

test('planner never rewrites unchanged original HTML after preview or a planning-only save', async ({ page }) => {
  const fixture = await setup(page);
  const original = '<p class="legacy">Original <b>formatting</b> &amp; spacing</p>\n<table><tr><td>Legacy cell</td></tr></table>';
  fixture.issues[0].description = original;
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#edit-description')).toBeHidden();
  await expect(page.locator('#editor-description')).toBeVisible();
  await page.locator('#description-write').click();
  await expect(page.locator('#edit-description')).toBeVisible();
  await page.locator('#description-preview').click();
  await page.locator('#description-write').click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toEqual([]);
  expect(fixture.issues[0].description).toBe(original);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByLabel('Estimated hours', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toEqual([{ estimated_hours: 8 }]);
  expect(fixture.issues[0].description).toBe(original);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.locator('#editor-subject').fill('Title-only edit');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes[1]).toEqual({ subject: 'Title-only edit' });
  expect(fixture.issues[0].description).toBe(original);
});

test('rejected text saves retain the entire draft and permit a successful retry', async ({ page }) => {
  const fixture = await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.locator('#editor-subject').fill('Draft title');
  await page.locator('#description-write').click();
  await page.locator('#edit-description').fill('Draft **description**');
  await page.getByLabel('Assignment', { exact: true }).selectOption('9');
  await page.getByLabel('Estimated hours', { exact: true }).fill('6');
  await page.locator('#description-preview').click();
  let attempts = 0;
  await page.route('**/redmine/issues/1.json**', route => {
    if (route.request().method() === 'PUT' && attempts++ === 0) return route.fulfill({ status: 422, json: { errors: ['Text save rejected'] } });
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor-notice')).toContainText(/rejected|422/i);
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#editor-subject')).toHaveValue('Draft title');
  await page.locator('#description-write').click();
  await expect(page.locator('#edit-description')).toBeEnabled();
  await expect(page.locator('#edit-description')).toHaveValue('Draft **description**');
  await expect(page.getByLabel('Assignment', { exact: true })).toHaveValue('9');
  await expect(page.getByLabel('Estimated hours', { exact: true })).toHaveValue('6');
  expect(fixture.issues[0].subject).toBe('Build backlog feature');
  expect(fixture.writes).toEqual([]);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(attempts).toBe(2);
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0]).toMatchObject({ subject: 'Draft title', assigned_to_id: 9, estimated_hours: 6 });
  expect(fixture.writes[0].description).toContain('<strong>description</strong>');
});

test('planner rejects whitespace titles and can explicitly clear descriptions', async ({ page }) => {
  const fixture = await setup(page);
  fixture.issues[0].description = '<p>Remove this</p>';
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.locator('#editor-subject').fill('   ');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor-notice')).toContainText('Title cannot be blank');
  expect(fixture.writes).toEqual([]);
  await page.locator('#editor-subject').fill(fixture.issues[0].subject);
  await page.locator('#description-write').click();
  await page.locator('#edit-description').fill('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toEqual([{ description: '' }]);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await expect(page.locator('#edit-description')).toHaveValue('');
});

for (const ignored of ['subject', 'description']) {
  test(`silently ignored ${ignored} writes are not confirmed and retain the draft`, async ({ page }) => {
    const fixture = await setup(page);
    await login(page);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    if (ignored === 'description') await page.locator('#description-write').click();
    const field = page.locator(ignored === 'subject' ? '#editor-subject' : '#edit-description');
    await field.fill('My unretained draft');
    await page.route('**/redmine/issues/1.json**', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 204 }) : route.fallback());
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('#editor-notice')).toContainText('Redmine did not retain');
    await expect(page.locator('#editor')).toBeVisible();
    await expect(field).toHaveValue('My unretained draft');
    expect(fixture.writes).toEqual([]);
  });
}

test('Redmine CRLF normalization confirms a saved description instead of causing a retry conflict', async ({ page }) => {
  const fixture = await setup(page);
  fixture.issues[0].description = '<p>Original</p>\r\n';
  await page.route('**/redmine/issues/1.json**', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const patch = route.request().postDataJSON().issue;
    fixture.writes.push(patch);
    fixture.issues[0].description = patch.description.replace(/\r\n|\r|\n/g, '\r\n');
    await route.fulfill({ status: 204 });
  });
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('#edit-description').fill('Updated **description**\n\nSecond paragraph.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  await expect(page.locator('#loading-overlay')).toBeHidden();
  expect(fixture.issues[0].description).toContain('<strong>description</strong>');
  // Verification must succeed on this first save, without requiring a retry.
  await expect(page.locator('#editor-notice')).not.toContainText('description changed in Redmine');
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toHaveLength(1);
});

test('retry confirms text already saved after a lost response without writing twice', async ({ page }) => {
  const fixture = await setup(page);
  await login(page);
  await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
  await page.locator('#editor-subject').fill('Already saved title');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.locator('#edit-description').fill('Already **saved**');
  await page.route('**/redmine/issues/1.json**', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const patch = route.request().postDataJSON().issue;
    fixture.writes.push(patch);
    fixture.issues[0].subject = patch.subject;
    fixture.issues[0].description = patch.description.replace(/\r\n|\r|\n/g, '\r\n');
    // Simulate an upstream failure after Redmine has committed the write.
    await route.fulfill({ status: 502, json: { errors: ['Response lost after commit'] } });
  });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor-notice')).toContainText('Save not confirmed');
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('#edit-description')).toHaveValue('Already **saved**');
  expect(fixture.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#editor')).toBeHidden();
  expect(fixture.writes).toHaveLength(1);
  await expect(page.locator('#notice')).toContainText('Issue #1 saved in Redmine');
});

for (const changed of ['subject', 'description']) {
  test(`concurrent ${changed} changes block all writes and retain the text draft`, async ({ page }) => {
    const fixture = await setup(page);
    fixture.issues[0].description = '<p>Original description</p>';
    await login(page);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    await page.locator('#editor-subject').fill('My draft title');
    await page.locator('#description-write').click();
    await page.locator('#edit-description').fill('My draft **description**');
    await page.getByLabel('Estimated hours', { exact: true }).fill('4');
    const remote = changed === 'subject' ? 'Remote title' : '<p>Remote description</p>';
    fixture.issues[0][changed] = remote;
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('#editor-notice')).toContainText(/changed|concurrent|conflict/i);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#editor-subject')).toHaveValue('My draft title');
    await expect(page.locator('#edit-description')).toHaveValue('My draft **description**');
    await expect(page.getByLabel('Estimated hours', { exact: true })).toHaveValue('4');
    expect(fixture.writes).toEqual([]);
    expect(fixture.issues[0][changed]).toBe(remote);
  });
}

for (const field of ['title', 'description', 'assignment', 'estimate']) {
  test(`closing a planner with a changed ${field} confirms discard and respects refusal`, async ({ page }) => {
    const fixture = await setup(page);
    await login(page);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    if (field === 'description') await page.locator('#description-write').click();
    const control = field === 'title' ? page.locator('#editor-subject')
      : field === 'description' ? page.locator('#edit-description')
      : field === 'assignment' ? page.getByLabel('Assignment', { exact: true })
      : page.getByLabel('Estimated hours', { exact: true });
    await expect(control).toBeEnabled();
    const original = await control.inputValue();
    const value = field === 'assignment' ? '9' : field === 'estimate' ? '7' : 'Unsaved draft';
    if (field === 'assignment') await control.selectOption(value);
    else await control.fill(value);
    const refuse = async dialog => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toMatch(/discard|unsaved/i);
      await dialog.dismiss();
    };
    page.once('dialog', refuse);
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(page.locator('#editor')).toBeVisible();
    await expect(control).toHaveValue(value);
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('confirm');
      await dialog.accept();
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toBeHidden();
    expect(fixture.writes).toEqual([]);
    await page.getByRole('button', { name: 'Plan #1', exact: true }).click();
    await expect(control).toHaveValue(original);
  });
}
