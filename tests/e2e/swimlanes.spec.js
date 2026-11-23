import { test, expect } from '@playwright/test';

async function setup(page) {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Doing' }, { id: 5, name: 'Done', is_closed: true }];
  const versions = [{ id: 100, name: 'Product 100', status: 'open', project: { id: 1 }, sharing: 'descendants' }, { id: 99, name: 'Product 99', status: 'open', project: { id: 1 }, sharing: 'descendants' }];
  const make = (id, parent, tracker = 'Task', values = []) => ({ id, subject: `Issue ${id}`, tracker: { id: tracker === 'Feature' ? 1 : 2, name: tracker }, project: { id: 1 }, status: statuses[0], priority: { id: 2, name: 'Normal' }, allowed_statuses: statuses, fixed_version: { id: 300 }, custom_fields: [{ id: 7, multiple: true, value: values }], ...(parent ? { parent: { id: parent } } : {}) });
  const rows = [make(1, null, 'Feature'), make(2, 1, 'Task', ['100']), make(3, 1), make(4, null, 'Feature', ['100']), make(5, null, 'Feature', ['99']), make(6, null, 'Task', ['99', '100'])];
  const writes = [], relations = new Map(), relationRequests = [];
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
    if (/^\/issues\/\d+\/relations\.json$/.test(path)) {
      const id = Number(path.match(/\d+/)[0]); relationRequests.push(id);
      return send({ relations: relations.get(id) || [] });
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
  return { rows, writes, relations, relationRequests };
}
const heading = (page, id) => page.locator(`.swimlane-headers > [data-lane="${id}"]`);
const backlog = (page, id) => page.locator(`[data-id="backlog"] [data-eid="${id}"]`);
const laneCard = (page, lane, id) => page.locator(`[data-id="status-1"] [data-lane="${lane}"] [data-eid="${id}"]`);
for (const mode of ['light', 'dark']) {
  test(`due dates appear only on Backlog Cards and Swimlane headings in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    await expect(page.locator('.issue-due-date')).toHaveCount(0);
    fixture.rows[0].due_date = '2026-12-15';
    fixture.rows[1].due_date = '2026-12-16'; // Ordinary Sprint Card: do not display.
    fixture.rows[3].due_date = '2026-12-20';
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    const backlogDate = backlog(page, 1).locator('.issue-due-date');
    const laneDate = heading(page, 4).locator('.issue-due-date');
    await expect(backlogDate).toBeVisible();
    await expect(backlogDate).toHaveText('Due 2026-12-15');
    await expect(backlogDate).toHaveAttribute('datetime', '2026-12-15');
    await expect(backlogDate).toHaveAttribute('title', 'Due date: 2026-12-15');
    await expect(laneDate).toBeVisible();
    await expect(laneDate).toHaveText('Due 2026-12-20');
    await expect(laneDate).toHaveAttribute('datetime', '2026-12-20');
    await expect(heading(page, 4).locator('.swimlane-actions > .issue-due-date + .lane-tracker')).toHaveCount(1);
    const positions = await heading(page, 4).evaluate(node => {
      const date = node.querySelector('.issue-due-date').getBoundingClientRect();
      const tracker = node.querySelector('.lane-tracker').getBoundingClientRect();
      return { dateRight: date.right, trackerLeft: tracker.left,
        dateCenter: date.top + date.height / 2, trackerCenter: tracker.top + tracker.height / 2 };
    });
    expect(positions.trackerLeft - positions.dateRight).toBe(8);
    expect(Math.abs(positions.dateCenter - positions.trackerCenter)).toBeLessThanOrEqual(1);
    await expect(page.locator('.issue-due-date')).toHaveCount(2);
    await expect(page.locator('[data-eid="2"] .issue-due-date')).toHaveCount(0);
    await expect(heading(page, 'ungrouped').locator('.issue-due-date')).toHaveCount(0);
    fixture.rows[0].due_date = '2027-01-05';
    fixture.rows[3].due_date = null;
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    await expect(backlogDate).toHaveText('Due 2027-01-05');
    await expect(laneDate).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
  });
}

test('closed Swimlanes strike through only the issue title and clear it when reopened', async ({ page }) => {
  const fixture = await setup(page);
  const lane = heading(page, 4);
  const title = lane.locator('.swimlane-title-row strong');
  await expect(title).toHaveCSS('text-decoration-line', 'none');
  // Issue responses may omit is_closed; the status catalogue is authoritative.
  fixture.rows[3].status = { id: 5, name: 'Done' };
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(title).toHaveCSS('text-decoration-line', 'line-through');
  const link = title.getByRole('link', { name: '#4', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveCSS('margin-right', '0px');
  // Text spacing participates in the strikethrough; a margin leaves a gap.
  expect(await link.evaluate(node => node.nextSibling.textContent)).toBe('\u2002Issue 4');
  await expect(lane.locator('.lane-tracker')).toHaveCSS('text-decoration-line', 'none');
  await expect(lane.locator('.swimlane-actions')).toHaveCSS('text-decoration-line', 'none');
  await expect(heading(page, 'ungrouped').locator('strong')).toHaveCSS('text-decoration-line', 'none');
  fixture.rows[3].status = { id: 1, name: 'New' };
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(title).toHaveCSS('text-decoration-line', 'none');
  expect(fixture.writes).toEqual([]);
});

test('Swimlane issue text matches Card size without increasing header height', async ({ page }) => {
  await setup(page);
  const title = heading(page, 4).locator('.swimlane-title-row strong');
  const cardSize = await page.locator('.kanban-item h3').first().evaluate(node => getComputedStyle(node).fontSize);
  await expect(title).toHaveCSS('font-size', cardSize);
  await expect(title).toHaveCSS('font-size', '14px');
  await expect(title).toHaveCSS('line-height', '18px');
  const heights = await title.evaluate(node => {
    const header = node.closest('.swimlane-heading');
    const current = header.getBoundingClientRect().height;
    node.style.fontSize = '12px';
    const previous = header.getBoundingClientRect().height;
    node.style.removeProperty('font-size');
    return { current, previous };
  });
  expect(heights.current).toBe(heights.previous);
});

for (const activation of ['click', 'keyboard']) {
  test(`Swimlane links only its issue ID without underlining via ${activation}`, async ({ page }) => {
    const fixture = await setup(page);
    const title = heading(page, 4).locator('.swimlane-title-row strong');
    const link = title.getByRole('link', { name: '#4', exact: true });
    await expect(title).toHaveText('#4 Issue 4');
    await expect(title.locator('a')).toHaveCount(1);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    await expect(title).toHaveCSS('text-decoration-line', 'none');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await page.context().route('https://redmine.example.test/issues/4', route =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Issue 4</h1>' }));
    const boardUrl = page.url();
    const [issuePage] = await Promise.all([
      page.waitForEvent('popup'),
      activation === 'click' ? link.click() : link.focus().then(() => page.keyboard.press('Enter')),
    ]);
    await issuePage.waitForLoadState();
    expect(issuePage.url()).toBe('https://redmine.example.test/issues/4');
    expect(await issuePage.evaluate(() => window.opener)).toBeNull();
    expect(page.url()).toBe(boardUrl);
    expect(fixture.writes).toEqual([]);
    await issuePage.close();
  });
}

for (const mode of ['light', 'dark']) {
  test(`Swimlane tags follow the title instead of aligning right in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    fixture.rows[3].subject = 'Billing improvements';
    fixture.rows[3].tags = ['Billing', 'UI'];
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    const lane = heading(page, 4);
    await expect(lane.locator('.issue-tag')).toHaveText(['Billing', 'UI']);
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await lane.evaluate(node => {
        const title = node.querySelector('.swimlane-title-row > strong').getBoundingClientRect();
        const tags = node.querySelector('.lane-tags').getBoundingClientRect();
        const actions = node.querySelector('.swimlane-actions').getBoundingClientRect();
        const row = node.querySelector('.swimlane-title-row').getBoundingClientRect();
        return { gap: tags.left - title.right, titleCenter: title.top + title.height / 2,
          tagsCenter: tags.top + tags.height / 2, tagsRight: tags.right,
          actionsLeft: actions.left, actionsRight: actions.right, rowRight: row.right };
      });
      expect(geometry.gap).toBe(8);
      expect(Math.abs(geometry.tagsCenter - geometry.titleCenter)).toBeLessThanOrEqual(1);
      expect(geometry.actionsLeft).toBeGreaterThan(geometry.tagsRight);
      expect(geometry.actionsRight).toBe(geometry.rowRight);
    }
    expect(fixture.writes).toEqual([]);
  });

  test(`Swimlane tracker is a right-aligned badge before the add button in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    fixture.rows[3].subject = 'A long Swimlane title that should leave room for the tracker badge and action button '.repeat(4);
    fixture.rows[3].tags = ['Module tag'];
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    const lane = heading(page, 4);
    const badge = lane.locator('.swimlane-actions > .lane-tracker');
    await expect(badge).toHaveText('Feature');
    await expect(badge).toHaveAttribute('title', 'Tracker: Feature');
    await expect(lane.locator('.lane-tags')).toHaveText('Module tag');
    await expect(lane.locator('.lane-tracker + .add-subtasks')).toHaveCount(1);
    await expect(badge).toHaveCSS('border-radius', '3px');
    await expect(badge).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(heading(page, 'ungrouped').locator('.lane-tracker')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(badge).toBeVisible();
      const geometry = await lane.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const row = node.querySelector('.swimlane-title-row').getBoundingClientRect();
        const badge = node.querySelector('.lane-tracker').getBoundingClientRect();
        const button = node.querySelector('.add-subtasks').getBoundingClientRect();
        const tags = node.querySelector('.lane-tags').getBoundingClientRect();
        return { right: bounds.right, rowRight: row.right, badgeRight: badge.right, badgeLeft: badge.left,
          buttonLeft: button.left, buttonRight: button.right, tagsRight: tags.right,
          badgeCenter: badge.top + badge.height / 2, buttonCenter: button.top + button.height / 2 };
      });
      expect(geometry.buttonLeft - geometry.badgeRight).toBe(8);
      expect(geometry.buttonRight).toBe(geometry.rowRight);
      expect(geometry.buttonRight).toBeLessThan(geometry.right);
      expect(geometry.tagsRight).toBeLessThanOrEqual(geometry.badgeLeft);
      expect(Math.abs(geometry.badgeCenter - geometry.buttonCenter)).toBeLessThanOrEqual(1);
    }
    expect(fixture.writes).toEqual([]);
  });

  test(`Swimlane priority uses one full-height bar, including empty rows, in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    fixture.rows[0].custom_fields[0].value = ['100'];
    fixture.rows[0].priority = { id: 3, name: 'High' };
    // A different child priority must not change the Swimlane's color.
    fixture.rows[1].priority = { id: 1, name: 'Low' };
    for (let index = 0; index < 16; index++) fixture.rows.push({ ...fixture.rows[1],
      id: 100 + index, subject: `Child ${100 + index}`, status: { id: 2, name: 'Doing' } });
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    const bar = heading(page, 1).locator('.lane-priority-bar');
    await expect(bar).toHaveAttribute('title', 'Priority: High');
    await expect(bar).toHaveAttribute('aria-label', 'Priority: High');
    await expect(bar).toHaveCSS('background-color', mode === 'light' ? 'rgb(220, 71, 71)' : 'rgb(239, 116, 116)');
    await expect(page.locator('.lane-priority, .card-field')).toHaveCount(0);
    await expect(heading(page, 'ungrouped').locator('.lane-priority-bar')).toHaveCount(0);
    const assertFullHeight = async id => {
      const geometry = await heading(page, id).locator('.lane-priority-bar').evaluate(node => {
        const bar = node.getBoundingClientRect();
        const header = node.parentElement.getBoundingClientRect();
        const sections = [...document.querySelectorAll('.swimlane-section')]
          .filter(section => section.dataset.lane === node.parentElement.dataset.lane)
          .map(section => section.getBoundingClientRect());
        return { width: bar.width, left: bar.left, top: bar.top, bottom: bar.bottom,
          headerTop: header.top, headerHeight: header.height,
          sections: sections.map(rect => ({ left: rect.left, top: rect.top, bottom: rect.bottom })) };
      });
      expect(geometry.width).toBe(3);
      expect(geometry.left).toBe(geometry.sections[0].left);
      expect(geometry.top).toBe(geometry.headerTop);
      for (const section of geometry.sections) {
        expect(Math.abs(geometry.top - section.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.bottom - section.bottom)).toBeLessThanOrEqual(1);
      }
      expect(geometry.bottom - geometry.top).toBeGreaterThan(geometry.headerHeight);
    };
    await assertFullHeight(1);
    await assertFullHeight(4); // Planned Swimlane with no children still has a bar.
    await page.locator('[data-id="status-2"] .has-swimlanes').evaluate(node => { node.scrollTop = 80; });
    await expect.poll(() => page.locator('[data-id="status-1"] .has-swimlanes').evaluate(node => node.scrollTop)).toBe(80);
    await assertFullHeight(1);
    await page.locator('#sprint-query').fill('Issue 2');
    await expect(page.locator('[data-eid="100"]')).toHaveCount(0);
    await assertFullHeight(1); // Filtering shrinks the bar with its row.
    await page.locator('#sprint-query').fill('');
    await expect(page.locator('[data-eid="100"]')).toBeVisible();
    await assertFullHeight(1);
    expect(fixture.writes).toEqual([]);
  });

  test(`Swimlane priority bars retain stock colors and a neutral fallback in ${mode} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: mode });
    const fixture = await setup(page);
    const names = ['Low', 'Normal', 'High', 'Urgent', 'Immediate', 'Bassa', 'Media', 'Alta', 'Custom priority'];
    const tokens = ['low', 'normal', 'high', 'urgent', 'immediate', 'low', 'normal', 'high', 'none'];
    names.forEach((name, index) => fixture.rows.push({ ...fixture.rows[3], id: 100 + index,
      priority: { id: 100 + index, name } }));
    await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
    for (let index = 0; index < names.length; index++) {
      const bar = heading(page, 100 + index).locator('.lane-priority-bar');
      await expect(bar).toHaveAttribute('title', `Priority: ${names[index]}`);
      const expected = await page.locator('html').evaluate((node, token) => {
        const sample = document.createElement('span');
        sample.style.color = getComputedStyle(node).getPropertyValue(`--priority-${token}`);
        document.body.append(sample);
        const color = getComputedStyle(sample).color; sample.remove(); return color;
      }, tokens[index]);
      await expect(bar).toHaveCSS('background-color', expected);
    }
  });
}

test('Sprint search matches Cards only, hides empty lanes, preserves totals and Backlog, and restores headings', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100'];
  fixture.rows.push({ ...fixture.rows[0], id: 8, subject: 'Backlog parent', custom_fields: [{ id: 7, multiple: true, value: [] }] });
  await refresh(page);
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  const totals = await page.locator('#totals').textContent();
  await expect(bar).toContainText('Showing 2 of 2 Cards');
  await expect(backlog(page, 8)).toBeVisible();
  await page.getByLabel('Search Sprint Cards').fill('#2');
  await expect(heading(page, 1)).toBeVisible();
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(heading(page, 4)).toHaveCount(0);
  await expect(heading(page, 'ungrouped')).toHaveCount(0);
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await expect(page.locator('#totals')).toHaveText(totals);
  await expect(backlog(page, 8)).toBeVisible();
  await page.getByLabel('Search Sprint Cards').fill('#1');
  await expect(page.locator('.swimlane-headers')).toHaveCount(0);
  await expect(bar).toContainText('No Cards match these filters');
  await bar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(heading(page, 4)).toBeVisible();
  await expect(heading(page, 'ungrouped')).toBeVisible();
  await expect(page.getByLabel('Search Sprint Cards')).toBeFocused();
});

test('Sprint dropdowns combine selections, retain stable options, persist and expose absent saved values', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[1].assigned_to = { id: 7, name: 'Alice' };
  fixture.rows[1].priority = { id: 3, name: 'High' };
  await refresh(page);
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  const assignees = bar.locator('[data-filter="assignee"]');
  await assignees.locator('summary').click();
  await assignees.getByLabel('Alice', { exact: true }).check();
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await expect(assignees.getByLabel('Unassigned', { exact: true })).toBeVisible();
  await assignees.getByLabel('Unassigned', { exact: true }).check();
  await expect(bar).toContainText('Showing 2 of 2 Cards');
  const priorities = bar.locator('[data-filter="priority"]');
  await priorities.locator('summary').click();
  await priorities.getByLabel('High', { exact: true }).check();
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await page.getByLabel('Search Sprint Cards').fill('issue');
  await page.reload();
  await page.getByLabel('Personal API key').fill('test-key');
  await page.getByRole('button', { name: 'Connect to Redmine' }).click();
  await expect(page.locator('#updated')).toContainText('Updated');
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('issue');
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await page.locator('#sprint').selectOption('99');
  await expect(bar).toContainText('Showing 0 of 1 Cards');
  await priorities.locator('summary').click();
  const absent = priorities.getByLabel('priority #3 (not in this Sprint)', { exact: true });
  await expect(absent).toBeChecked();
  await absent.uncheck();
  await expect(bar).toContainText('Showing 1 of 1 Cards');
  await bar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByLabel('Search Sprint Cards')).toHaveValue('');
});

test('matching outside-status children keep their heading, and updates reapply Sprint search', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100'];
  fixture.rows[1].status = { id: 99, name: 'Other' };
  await refresh(page);
  await page.getByLabel('Search Sprint Cards').fill('#2');
  await expect(heading(page, 1)).toBeVisible();
  await heading(page, 1).getByText('1 issues outside displayed statuses', { exact: true }).click();
  await expect(heading(page, 1).getByRole('link', { name: '#2 — Issue 2' })).toBeVisible();
  await expect(page.locator('[data-sprint-count]')).toHaveText('Showing 1 of 2 Cards');
  fixture.rows[1].custom_fields[0].value = [];
  await refresh(page);
  await expect(heading(page, 1)).toHaveCount(0);
  await expect(page.locator('[data-sprint-empty]')).toBeVisible();
});

test('missing-subtask planning includes descendants hidden by Sprint search', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100'];
  await refresh(page);
  await page.getByLabel('Search Sprint Cards').fill('#2');
  await heading(page, 1).getByRole('button', { name: 'Add missing subtasks for #1' }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('aria-busy', 'false');
  expect(fixture.rows.find(row => row.id === 3).custom_fields[0].value).toEqual(['100']);
  await expect(laneCard(page, 1, 3)).toHaveCount(0);
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(page.locator('[data-sprint-count]')).toHaveText('Showing 1 of 3 Cards');
});

test('Sprint Tag filters use Swimlane tags, combine with search, and clear independently', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows[0].custom_fields[0].value = ['100'];
  fixture.rows[0].tags = ['release', 'UI'];
  fixture.rows[3].tags = ['empty'];
  fixture.rows[5].tags = ['release'];
  await refresh(page);
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  const tags = bar.locator('[data-filter="tag"]');
  await tags.locator('summary').click();
  await tags.getByLabel('release', { exact: true }).check();
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(heading(page, 'ungrouped')).toHaveCount(0);
  await expect(heading(page, 4)).toHaveCount(0);
  await expect(bar).toContainText('Showing 1 of 2 Cards');
  await expect(tags.getByLabel('empty', { exact: true })).toBeVisible();
  await page.getByLabel('Search Sprint Cards').fill('#6');
  await expect(bar).toContainText('No Cards match these filters');
  await page.getByLabel('Search Sprint Cards').fill('');
  await page.locator('#sprint').selectOption('99');
  await expect(bar).toContainText('Showing 0 of 1 Cards');
  await tags.locator('summary').click();
  await expect(tags.getByLabel('release (not in this Sprint)', { exact: true })).toBeChecked();
  await bar.getByRole('button', { name: 'Clear filters' }).click();
  await expect(bar).toContainText('Showing 1 of 1 Cards');
  await expect(tags.locator('summary')).toHaveText('Tag: All');
});

test('Sprint dropdowns fit narrow viewports and support keyboard dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await setup(page);
  const bar = page.getByRole('region', { name: 'Sprint Card filters' });
  const details = bar.locator('[data-filter="priority"]');
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  const bounds = await details.locator('.sprint-filter-options').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await details.getByLabel('Normal', { exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(details.getByLabel('Normal', { exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(details).not.toHaveAttribute('open');
  await expect(details.locator('summary')).toBeFocused();
});

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
test('Ungrouped hides and reappears as the last issue is grouped or removed', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows.find(row => row.id === 6).custom_fields[0].value = ['99'];
  fixture.rows[0].custom_fields[0].value = ['100'];
  await refresh(page);
  await expect(heading(page, 'ungrouped')).toHaveCount(0);
  await expect(page.locator('.swimlane-section[data-lane="ungrouped"]')).toHaveCount(0);
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(heading(page, 4)).toBeVisible();
  fixture.rows[0].custom_fields[0].value = [];
  await refresh(page);
  await expect(laneCard(page, 'ungrouped', 2)).toBeVisible();
  await expect(page.locator('.swimlane-headers > .swimlane-heading').last()).toHaveAttribute('data-lane', 'ungrouped');
  fixture.rows[1].custom_fields[0].value = [];
  await refresh(page);
  await expect(heading(page, 'ungrouped')).toHaveCount(0);
  await expect(page.locator('.swimlane-section[data-lane="ungrouped"]')).toHaveCount(0);
  await expect(heading(page, 4)).toBeVisible();
});
test('an Ungrouped issue outside displayed statuses keeps its heading notice accessible', async ({ page }) => {
  const fixture = await setup(page);
  fixture.rows.find(row => row.id === 6).custom_fields[0].value = ['99'];
  fixture.rows[1].status = { id: 99, name: 'Other' };
  await refresh(page);
  const ungrouped = heading(page, 'ungrouped');
  await expect(ungrouped).toBeVisible();
  await ungrouped.locator('summary').click();
  await expect(ungrouped.getByRole('link', { name: '#2 — Issue 2' })).toBeVisible();
  await expect(page.locator('.swimlane-section[data-lane="ungrouped"] .kanban-item')).toHaveCount(0);
});
test('an empty Sprint hides Ungrouped and still accepts Backlog drops', async ({ page }) => {
  const fixture = await setup(page);
  for (const row of fixture.rows) row.custom_fields[0].value = row.custom_fields[0].value.filter(value => value !== '100');
  await refresh(page);
  await expect(page.locator('.swimlane-headers')).toHaveCount(0);
  await expect(page.locator('.swimlane-section')).toHaveCount(0);
  await backlog(page, 1).locator('h3').dragTo(page.locator('[data-id="status-1"] .kanban-drag'));
  await expect(heading(page, 1)).toBeVisible();
  await expect(laneCard(page, 1, 2)).toBeVisible();
  await expect(heading(page, 'ungrouped')).toHaveCount(0);
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


test('related disclosures load lazily, stay open across updates, and refresh independently of membership', async ({ page }) => {
  const fixture = await setup(page);
  await expect(heading(page, 4).locator('[data-related]')).toHaveCount(0);
  fixture.relations.set(4, [
    { issue_id: 4, issue_to_id: 5, relation_type: 'relates' },
    { issue_id: 6, issue_to_id: 4, relation_type: 'blocks' },
  ]);
  fixture.relationRequests.length = 0;
  await refresh(page);
  const requests = () => fixture.relationRequests.filter(id => id === 4).length;
  const lane = heading(page, 4), details = lane.locator('[data-related="4"]');
  await expect(details).not.toHaveAttribute('open');
  expect(requests()).toBe(1);
  await expect(heading(page, 'ungrouped').locator('[data-related]')).toHaveCount(0);
  await details.locator('summary').click();
  await expect(details.locator('summary')).toHaveText('2 related issues');
  await expect(details.getByRole('link', { name: '#5 — Issue 5' })).toBeVisible();
  await expect(details.getByRole('link', { name: '#6 — Issue 6' })).toBeVisible();
  await expect(details.locator('li').first()).toContainText('blocked by');
  await expect(details.getByRole('link').first()).toHaveAttribute('target', '_blank');
  await expect(details.getByRole('link').first()).toHaveAttribute('href', 'https://redmine.example.test/issues/6');
  await details.locator('summary').click();
  await details.locator('summary').click();
  expect(requests()).toBe(1);
  await refresh(page);
  await expect(details).toHaveAttribute('open');
  await expect.poll(requests).toBe(2);
  await expect(details.locator('summary')).toHaveText('2 related issues');
  await page.locator('#sprint').selectOption('99');
  await expect(heading(page, 5)).toBeVisible();
  await page.locator('#sprint').selectOption('100');
  await expect(heading(page, 4)).toBeVisible();
  await expect(details).not.toHaveAttribute('open');
  expect(requests()).toBe(3);
  fixture.relations.set(4, []);
  await refresh(page);
  await expect(details).toHaveCount(0);
});
