const jKanban = window.jKanban;
import './style.css';
import { RedmineClient, RedmineError } from './api.js';
import { validateConfig, isBacklog, effort, movePatch, parseEstimate, assertTransition, matchesPatch, escapeHtml as e } from './domain.js';
import { PlanningFeed } from './planning-feed.js';

const $ = id => document.getElementById(id);
const storageKey = 'redmine-sprint-board.api-key';
let api, config, statuses = [], projects = [], versions = [], memberships = [], issues = [], board;
let sprint = null, projectId = '', blockedProjectId = '', busy = false, dragging = false, loading = false, epoch = 0, timer, editing;
let feed, queryLoading = false, queryTimer, queryRevision = 0, backlogFailed = false;
const filters = { query: '', tracker: '', assignee: '' };

function notify(message, error = false) {
  const compactMessage = document.body.classList.contains('board-active') && message.length > 180;
  const text = document.createElement('span'); text.textContent = message;
  $('notice').replaceChildren(text);
  $('notice-message').textContent = message;
  if (compactMessage) {
    const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Full message';
    more.addEventListener('click', () => $('notice-dialog').showModal()); $('notice').append(more);
  }
  $('notice').className = error ? 'error' : 'success';
  $('notice').hidden = !message;
  $('editor-notice').textContent = message;
  $('editor-notice').className = error ? 'error' : 'success';
  $('editor-notice').hidden = !message || !$('editor').open;
}
function options(select, rows, selected = '') {
  select.replaceChildren(...rows.map(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
  }));
  select.value = String(selected);
}
function lock() {
  document.querySelectorAll('#workspace select, #workspace input, #workspace button, #edit-form input, #edit-form select, #edit-form button[type="submit"]').forEach(el => { el.disabled = busy || loading; });
  document.querySelectorAll('.plan').forEach(el => { el.disabled = busy || loading || queryLoading || feed?.loadingMore; });
  if ($('backlog-more')) $('backlog-more').disabled = busy || loading || queryLoading || feed?.loadingMore;
  $('workspace').setAttribute('aria-busy', String(busy || loading || queryLoading));
}
function destroyBoard() {
  board?.drake?.destroy(); board?.drakeBoard?.destroy(); board = null; $('board').replaceChildren();
}
function cancelQuery() {
  clearTimeout(queryTimer); queryRevision++; feed?.cancel(); queryLoading = false;
}
function feedScope() { return { projectId, sprintId: sprint?.id, backlogStatusId: config.backlogStatusId }; }
function syncFeed(snapshot) {
  issues = [...new Map([...snapshot.backlog, ...snapshot.sprintVisible].map(issue => [issue.id, issue])).values()];
}
function forget() {
  cancelQuery(); feed = null;
  epoch++; clearInterval(timer); api?.dispose(); api = null; busy = loading = dragging = false;
  try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
  $('api-key').value = ''; $('remember').checked = false;
  $('login-form').querySelector('button').disabled = false;
  $('forget-saved').hidden = true;
  $('editor').close(); editing = null; destroyBoard();
  issues = []; versions = []; memberships = []; projects = []; sprint = null; projectId = ''; blockedProjectId = '';
  document.body.classList.remove('board-active');
  $('notice-dialog').close();
  $('workspace').hidden = true; $('login').hidden = false; $('identity').replaceChildren(); notify('API key forgotten on this browser.');
}
function linkToIssue(id) { return `${config.redminePublicUrl}/issues/${Number(id)}`; }
function members() {
  const map = new Map();
  for (const membership of memberships) {
    const member = membership.user || membership.group;
    if (member) map.set(member.id, member.name + (membership.group ? ' (group)' : ''));
  }
  for (const issue of [...(feed?.snapshot.sprintAll || []), ...issues]) if (issue.assigned_to) map.set(issue.assigned_to.id, issue.assigned_to.name);
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}
function renderFilters() {
  const project = projects.find(item => String(item.id) === projectId);
  const trackerMap = new Map([...(project?.trackers || []), ...(feed?.snapshot.sprintAll || []).map(issue => issue.tracker), ...issues.map(issue => issue.tracker)].map(tracker => [tracker.id, tracker.name]));
  if (filters.tracker && !trackerMap.has(Number(filters.tracker))) trackerMap.set(Number(filters.tracker), `Tracker #${filters.tracker}`);
  options($('tracker'), [['', 'All trackers'], ...trackerMap], filters.tracker);
  const people = members();
  if (filters.assignee && filters.assignee !== 'none' && !people.some(([id]) => String(id) === filters.assignee)) people.push([filters.assignee, $('assignee').selectedOptions[0]?.textContent || `Assignee #${filters.assignee}`]);
  options($('assignee'), [['', 'Everyone'], ['none', 'Unassigned'], ...people], filters.assignee);
}
// Redmine never returns a colour for a priority, and priorities are admin-configurable, so
// the stripe is matched by name with a neutral fallback. See docs/adr/0001.
const priorityNames = new Set(['low', 'normal', 'high', 'urgent', 'immediate']);
function priorityClass(name) {
  const key = String(name || '').trim().toLowerCase();
  return `prio-${priorityNames.has(key) ? key : 'none'}`;
}
function card(issue) {
  const id = Number(issue.id);
  const open = sprint?.status === 'open';
  // Resolved issues strike through the ID, as on a YouTrack card.
  const resolved = statuses.find(status => status.id === issue.status.id)?.is_closed;
  const subject = e(issue.subject);
  const action = `${open ? 'Plan' : 'View'} #${id}`;
  const fields = [
    `<span class="card-field">${e(issue.priority.name)}</span>`,
    `<span class="card-field plain">${e(issue.tracker.name)}</span>`,
    `<span class="card-field plain">${e(issue.status.name)}</span>`,
    `<span class="card-field plain">${e(issue.assigned_to?.name || 'Unassigned')}</span>`,
  ].join('');
  const hours = issue.estimated_hours == null
    ? '<strong class="unestimated" title="Unestimated">?</strong>'
    : `<strong>${e(issue.estimated_hours)} h</strong>`;
  return {
    id: String(id), class: [...(open ? [] : ['not-draggable']), priorityClass(issue.priority.name)],
    // The summary is clamped to three lines in CSS; title and aria-label keep the full text
    // reachable for pointer and assistive technology alike.
    title: `<div class="card-head"><a class="${resolved ? 'resolved' : ''}" href="${e(linkToIssue(issue.id))}" target="_blank" rel="noopener noreferrer"${resolved ? ' title="Resolved"' : ''}>#${id}</a><h3 title="${subject}" aria-label="${subject}">${subject}</h3></div><div class="card-bottom">${fields}${hours}</div><button type="button" class="plan" data-edit="${id}" aria-label="${action}" title="${action}">\u270E</button>`,
  };
}
function renderBoard() {
  if (dragging) return;
  destroyBoard();
  const visible = issues;
  const total = effort(feed?.snapshot.sprintAll || []), filtered = effort(feed?.snapshot.sprintVisible || []);
  $('sprint-name').textContent = sprint?.name || 'No sprint selected';
  $('sprint-state').textContent = sprint ? `${sprint.status === 'open' ? 'Open sprint' : 'Closed sprint · read only'}${sprint.due_date ? ` · Due ${sprint.due_date}` : ''}` : 'Create an open target version in Redmine to start planning.';
  $('totals').innerHTML = `<div><strong>${e(Number(total.hours.toFixed(2)))}</strong><span>estimated hours</span></div><div><strong>${total.count}</strong><span>issues</span></div><div><strong>${total.unestimated}</strong><span>unestimated</span></div>`;
  $('filtered').textContent = `Visible sprint: ${filtered.count} issues · ${Number(filtered.hours.toFixed(2))} h · ${filtered.unestimated} unestimated`;
  const backlog = visible.filter(issue => isBacklog(issue, config.backlogStatusId));
  const boards = [{ id: 'backlog', title: `Backlog <span class="count">${backlog.length} / ${feed?.snapshot.total ?? '?'}</span>`, class: 'backlog-board', item: backlog.map(card) }];
  for (const statusId of config.columnStatusIds) {
    const items = visible.filter(issue => issue.fixed_version?.id === sprint?.id && issue.status.id === statusId);
    boards.push({ id: `status-${statusId}`, title: `${e(statuses.find(status => status.id === statusId).name)} <span class="count">${items.length}</span>`, item: items.map(card) });
  }
  const other = visible.filter(issue => issue.fixed_version?.id === sprint?.id && !config.columnStatusIds.includes(issue.status.id));
  if (other.length) boards.push({ id: 'other', title: 'Other statuses (unmapped)', item: other.map(card) });
  board = new jKanban({
    element: '#board', gutter: '16px', widthBoard: '290px', responsive: 0, dragBoards: false, boards,
    dragEl: () => { if (busy || loading || queryLoading || feed?.loadingMore || sprint?.status !== 'open') board.drake.cancel(true); else dragging = true; },
    dragendEl: () => { dragging = false; },
    dropEl: (element, target) => {
      const issue = issues.find(item => item.id === Number(element.dataset.eid));
      // Revert the DOM move immediately; only render a confirmed server state.
      queueMicrotask(() => {
        dragging = false;
        try { const patch = movePatch(issue, target.parentElement.dataset.id, sprint); void mutate(issue.id, patch); }
        catch (error) { notify(error.message, true); renderBoard(); }
      });
      return false;
    },
  });
  for (const column of $('board').querySelectorAll('.kanban-board')) {
    const list = column.querySelector('.kanban-drag');
    list.tabIndex = 0;
    list.setAttribute('aria-label', `${column.querySelector('header').textContent.trim()} issues`);
  }
  const container = board.findBoard('backlog').querySelector('.kanban-drag');
  container.setAttribute('aria-label', 'Backlog issues'); container.tabIndex = 0;
  container.addEventListener('scroll', () => {
    if (container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 64) void loadMoreBacklog();
  }, { passive: true });
  renderBacklogFooter(); lock();
  $('empty').hidden = visible.length > 0;
}

function renderBacklogFooter() {
  if (!board || !feed) return;
  const node = board.findBoard('backlog');
  node.querySelector('.count').textContent = `${feed.snapshot.backlog.length} / ${feed.snapshot.total ?? '?'}`;
  node.querySelector('.kanban-drag').setAttribute('aria-busy', String(feed.loadingMore));
  const footer = node.querySelector('footer'); footer.replaceChildren();
  const text = document.createElement('span'); text.className = 'muted';
  text.textContent = !feed.snapshot.hasMore ? 'All matching backlog issues loaded'
    : feed.loadingMore ? 'Loading…' : 'Scroll to load more';
  footer.append(text);
  // A page that failed cannot rely on scrolling to retry: the column may already be at its
  // bottom, so no further scroll event would fire. Keep an explicit control for that case.
  if (feed.snapshot.hasMore && backlogFailed && !feed.loadingMore) {
    const more = document.createElement('button'); more.type = 'button'; more.id = 'backlog-more';
    more.textContent = 'Retry loading issues';
    more.disabled = busy || loading || queryLoading;
    more.addEventListener('click', () => void loadMoreBacklog()); footer.append(more);
  }
}
// Request a page that fills the visible column rather than a fixed five, measuring a
// rendered card where one exists and falling back to the compact card height.
const compactCardHeight = 90;
function backlogPageSize() {
  const container = board?.findBoard('backlog')?.querySelector('.kanban-drag');
  const height = container?.clientHeight || $('board')?.clientHeight || window.innerHeight;
  const card = container?.querySelector('.kanban-item');
  const unit = card ? card.getBoundingClientRect().height + 8 : compactCardHeight;
  // Two spare rows so a short column still offers something to scroll to; Redmine caps at 100.
  return Math.min(100, Math.max(5, Math.ceil(height / unit) + 2));
}
// Compact cards mean the first page can fit without overflowing a tall column, which would
// leave scroll-triggered paging unreachable. Fetch further pages until the column scrolls,
// bounded so a tall screen cannot walk the whole backlog.
// Called once a load has settled: loadMoreBacklog refuses to run while one is in flight.
const autoFillPages = 4;
async function fillBacklogColumn() {
  const container = board?.findBoard('backlog')?.querySelector('.kanban-drag');
  if (!container) return;
  for (let page = 0; page < autoFillPages; page++) {
    if (!feed?.snapshot.hasMore || container.scrollHeight > container.clientHeight) return;
    const before = feed.snapshot.backlog.length;
    await loadMoreBacklog({ silent: true });
    if (!container.isConnected) return;
    if (feed.snapshot.backlog.length === before) return;
  }
}
async function loadMoreBacklog({ silent = false } = {}) {
  if (!api || !board || busy || loading || queryLoading || dragging || $('editor').open || feed?.loadingMore || !feed?.snapshot.hasMore) return;
  // Automatic fetches must not clear a notice the user has not read yet.
  if (!silent) notify('');
  feed.pageSize = backlogPageSize();
  const revision = queryRevision, activeBoard = board, restoreFocus = document.activeElement?.id === 'backlog-more';
  const pending = feed.next(); renderBacklogFooter(); lock();
  try {
    const snapshot = await pending;
    if (!snapshot || revision !== queryRevision) return;
    backlogFailed = false;
    syncFeed(snapshot); renderFilters();
    if (board !== activeBoard) { renderBoard(); return; }
    for (const issue of snapshot.backlog) if (!board.findElement(String(issue.id))) board.addElement('backlog', card(issue));
    $('empty').hidden = issues.length > 0;
  } catch (error) {
    if (revision === queryRevision) { backlogFailed = true; notify(`Could not load more backlog issues: ${error.message} Use Retry loading issues, or scroll again.`, true); }
  } finally {
    if (revision === queryRevision) {
      renderBacklogFooter(); lock();
      if (restoreFocus) ($('backlog-more') || board?.findBoard('backlog').querySelector('.kanban-drag'))?.focus({ preventScroll: true });
    }
  }
}
async function searchIssues(revision) {
  try {
    feed.pageSize = backlogPageSize();
    const snapshot = await feed.load(feedScope(), filters, { refreshSprint: false });
    if (!snapshot || revision !== queryRevision) return;
    syncFeed(snapshot); renderFilters(); renderBoard();
  } catch (error) {
    if (revision === queryRevision) {
      if (error.status === 403) blockedProjectId = projectId;
      $('filtered').textContent = 'Search unavailable';
      notify(`Search failed: ${error.message} Change the search or use Refresh to retry.`, true);
    }
  } finally {
    if (revision === queryRevision) { queryLoading = false; lock(); renderBacklogFooter(); void fillBacklogColumn(); }
  }
}
function scheduleSearch(delay) {
  cancelQuery(); queryLoading = true; notify('');
  board?.drake?.cancel(true); dragging = false;
  issues = []; destroyBoard(); $('empty').hidden = true; $('filtered').textContent = 'Searching Redmine…'; lock();
  const revision = queryRevision;
  queryTimer = setTimeout(() => void searchIssues(revision), delay);
}
function chooseSprint(previousId) {
  const available = versions.filter(version => version.status === 'open' || ($('closed').checked && version.status === 'closed'));
  available.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.name.localeCompare(b.name));
  sprint = available.find(version => version.id === Number(previousId)) || available.find(version => version.status === 'open') || available[0] || null;
  options($('sprint'), available.length ? available.map(version => [version.id, version.name + (version.status === 'closed' ? ' (closed)' : '')]) : [['', 'No open sprints']], sprint?.id || '');
}
async function refresh(projectChanged = false, retryDenied = false) {
  if (!api || busy || loading || dragging || $('editor').open || (blockedProjectId === projectId && !projectChanged && !retryDenied)) return;
  if (!projectChanged && !retryDenied && (queryLoading || feed?.loadingMore || board?.findBoard('backlog').querySelector('.kanban-drag').scrollTop > 0)) return;
  cancelQuery();
  if (projectChanged || retryDenied) notify('');
  loading = true; lock();
  const stamp = epoch;
  try {
    const project = projects.find(item => String(item.id) === projectId);
    const [newVersions, newMemberships] = await Promise.all([
      api.list(`/projects/${projectId}/versions.json`, 'versions').catch(error => {
        if (error.status === 403) throw new RedmineError(`Cannot load sprints for project "${project?.name || projectId}" (#${projectId}): Redmine returned 403 Forbidden. Check that Issue tracking is enabled and your project role has View issues permission. If both are correct, check plugin or gateway restrictions. Select another project, or click Refresh after access is corrected.`, 403);
        throw error;
      }),
      api.list(`/projects/${projectId}/memberships.json`, 'memberships').catch(error => { if (error.status === 403) return []; throw error; }),
    ]);
    if (stamp !== epoch) return;
    versions = newVersions; memberships = newMemberships;
    chooseSprint(projectChanged ? null : sprint?.id);
    feed.pageSize = backlogPageSize(); backlogFailed = false;
    const next = await feed.load(feedScope(), filters);
    if (!next || stamp !== epoch) return;
    syncFeed(next); blockedProjectId = '';
    renderFilters(); renderBoard();
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (stamp === epoch) {
      if (error.status === 403) blockedProjectId = projectId;
      notify(`Refresh failed: ${error.message}${error.status === 403 ? ' Automatic refresh is paused for this project.' : ''}`, true);
      if (projectChanged || error.status === 403) {
        issues = []; versions = []; memberships = []; sprint = null;
        renderFilters(); destroyBoard();
        options($('sprint'), [['', 'Sprints unavailable']]);
        $('sprint-name').textContent = 'Sprint data unavailable';
        $('sprint-state').textContent = 'See the error above. Choose another project or retry with Refresh.';
        $('totals').replaceChildren(); $('filtered').textContent = ''; $('updated').textContent = ''; $('empty').hidden = true;
      }
    }
  } finally { if (stamp === epoch) { loading = false; lock(); renderBacklogFooter(); void fillBacklogColumn(); } }
}

async function mutate(id, patch) {
  if (busy || loading || queryLoading || feed?.loadingMore || !api) return;
  if (!Object.keys(patch).length) { renderBoard(); return; }
  cancelQuery(); busy = true; lock();
  const stamp = epoch;
  let writeConfirmed = false;
  try {
    if (sprint?.status !== 'open') throw new Error('Closed sprints are read only.');
    const currentApi = api;
    const fresh = await currentApi.issue(id);
    const version = await currentApi.request(`/versions/${sprint.id}.json`);
    if (version.version.status !== 'open') throw new Error('This sprint is no longer open. Refresh before planning.');
    if (stamp !== epoch) return;
    assertTransition(fresh, patch);
    // Do not send unchanged attributes, which may be workflow-read-only.
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !matchesPatch(fresh, { [key]: value })));
    if (Object.keys(changed).length) await currentApi.update(id, changed);
    if (stamp !== epoch) return;
    const confirmed = await currentApi.issue(id);
    if (stamp !== epoch) return;
    writeConfirmed = matchesPatch(confirmed, patch);
    // Membership, filtering, ordering and page cursors may all change after a write.
    feed.pageSize = backlogPageSize(); backlogFailed = false;
    const snapshot = await feed.load(feedScope(), filters);
    if (!snapshot || stamp !== epoch) return;
    syncFeed(snapshot);
    if (!writeConfirmed) throw new Error('Redmine did not retain all requested changes. Showing its confirmed values; check field permissions and workflow rules.');
    $('editor').close(); editing = null;
    notify(patch.fixed_version_id === null && !isBacklog(confirmed, config.backlogStatusId)
      ? `Issue #${id} removed from sprint. Its status is not the backlog status, so it is no longer shown here.`
      : `Issue #${id} saved in Redmine.`);
  } catch (error) {
    if (stamp === epoch) notify(writeConfirmed ? `Issue #${id} was saved, but reloading the board failed: ${error.message} Use Refresh; do not repeat the write.` : `Save not confirmed: ${error.message} Refresh before retrying if the connection failed.`, true);
  }
  finally { if (stamp === epoch) { busy = false; lock(); renderFilters(); renderBoard(); void fillBacklogColumn(); } }
}

async function openEditor(id) {
  if (busy || loading || queryLoading || feed?.loadingMore) return;
  loading = true; lock();
  const stamp = epoch;
  try {
    const issue = await api.issue(id);
    if (stamp !== epoch) return;
    editing = issue;
    $('editor-notice').hidden = true;
    $('editor-title').textContent = `Plan #${issue.id}`; $('editor-subject').textContent = issue.subject;
    const people = new Map(members()); if (issue.assigned_to) people.set(issue.assigned_to.id, issue.assigned_to.name);
    options($('edit-assignee'), [['', 'Unassigned'], ...people], issue.assigned_to?.id || '');
    $('edit-estimate').value = issue.estimated_hours ?? '';
    const allowed = new Map([issue.status, ...(issue.allowed_statuses || [])].map(status => [status.id, status.name]));
    options($('edit-status'), [...allowed], issue.status.id);
    $('edit-destination').value = issue.fixed_version?.id === sprint?.id ? 'sprint' : 'backlog';
    $('issue-link').href = linkToIssue(issue.id);
    $('editor-warning').textContent = sprint?.status === 'open' ? 'Redmine enforces workflow and field permissions. Removing from a sprint does not reset status.' : 'Read only. Select an open sprint to plan issues.';
    $('editor').showModal();
  } catch (error) { if (stamp === epoch) notify(error.message, true); }
  finally {
    if (stamp === epoch) {
      loading = false; lock();
      $('edit-form').querySelectorAll('input, select, button[type="submit"]').forEach(el => { el.disabled = sprint?.status !== 'open'; });
    }
  }
}

async function connect(key, remember) {
  if (loading) return;
  loading = true; const stamp = ++epoch;
  $('login-form').querySelector('button').disabled = true;
  api = new RedmineClient(key); feed = new PlanningFeed(api);
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Cannot load deployment configuration.');
    const raw = await response.json();
    const [userData, statusData, projectData] = await Promise.all([
      api.request('/users/current.json'), api.list('/issue_statuses.json', 'issue_statuses'),
      api.list('/projects.json', 'projects', { include: 'trackers' }),
    ]);
    if (stamp !== epoch) return;
    config = validateConfig(raw, statusData); statuses = statusData; projects = projectData;
    if (!projects.length) throw new Error('No projects are visible to your account.');
    try {
      if (remember) localStorage.setItem(storageKey, key); else localStorage.removeItem(storageKey);
    } catch { notify('Connected, but browser storage is unavailable. The API key will not be remembered.', true); }
    $('api-key').value = ''; $('login').hidden = true; $('workspace').hidden = false;
    document.body.classList.add('board-active');
    $('identity').textContent = `${userData.user.firstname || ''} ${userData.user.lastname || userData.user.login}`.trim();
    const button = document.createElement('button'); button.textContent = 'Forget key / Sign out'; button.onclick = forget; $('identity').append(button);
    projectId = String(projects[0].id); options($('project'), projects.map(project => [project.id, project.name]), projectId);
    notify('Connected.'); loading = false; await refresh(true);
    if (stamp !== epoch) return;
    timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, config.refreshSeconds * 1000);
  } catch (error) {
    if (stamp === epoch) { api?.dispose(); api = null; notify(error.message, true); }
  } finally { if (stamp === epoch) { loading = false; $('login-form').querySelector('button').disabled = false; lock(); } }
}

const compactViewport = window.matchMedia('(max-width: 1279px), (max-height: 719px)');
function syncCompactControls() { $('filter-controls').open = !compactViewport.matches; }
compactViewport.addEventListener('change', syncCompactControls);
syncCompactControls();

$('forget-saved').addEventListener('click', forget);
$('login-form').addEventListener('submit', event => { event.preventDefault(); void connect($('api-key').value.trim(), $('remember').checked); });
$('project').addEventListener('change', () => {
  cancelQuery(); feed = new PlanningFeed(api);
  projectId = $('project').value; issues = []; sprint = null; versions = []; memberships = [];
  Object.assign(filters, { query: '', tracker: '', assignee: '' }); $('query').value = '';
  destroyBoard(); void refresh(true);
});
$('sprint').addEventListener('change', () => {
  cancelQuery(); feed = new PlanningFeed(api);
  sprint = versions.find(version => version.id === Number($('sprint').value)); issues = []; destroyBoard(); void refresh(false, true);
});
$('closed').addEventListener('change', () => { cancelQuery(); issues = []; destroyBoard(); void refresh(false, true); });
$('refresh').addEventListener('click', () => { notify(''); void refresh(false, true); });
for (const [id, field, eventName] of [['query', 'query', 'input'], ['tracker', 'tracker', 'change'], ['assignee', 'assignee', 'change']]) {
  $(id).addEventListener(eventName, () => { filters[field] = $(id).value; scheduleSearch(field === 'query' ? 300 : 0); });
}
$('board').addEventListener('click', event => {
  const button = event.target.closest('[data-edit]'); if (button) void openEditor(Number(button.dataset.edit));
});
$('close-editor').addEventListener('click', () => { if (!busy) { $('editor').close(); editing = null; } });
$('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('edit-form').addEventListener('submit', event => {
  event.preventDefault(); if (!editing || busy) return;
  try {
    if (sprint?.status !== 'open') throw new Error('Select an open sprint before editing issues.');
    const patch = { assigned_to_id: $('edit-assignee').value ? Number($('edit-assignee').value) : null, estimated_hours: parseEstimate($('edit-estimate').value), status_id: Number($('edit-status').value), fixed_version_id: $('edit-destination').value === 'sprint' ? sprint.id : null };
    void mutate(editing.id, patch);
  } catch (error) { notify(error.message, true); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
try {
  const remembered = localStorage.getItem(storageKey);
  if (remembered) { $('forget-saved').hidden = false; $('remember').checked = true; void connect(remembered, true); }
} catch { /* Explicit login still works without local storage. */ }
