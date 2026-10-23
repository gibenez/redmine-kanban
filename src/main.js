const jKanban = window.jKanban;
import './style.css';
import { reconcileBoard } from './board-view.js';
import { RedmineClient, RedmineError } from './api.js';
import { validateConfig, isBacklog, effort, movePatch, parseEstimate, assertTransition, matchesPatch, escapeHtml as e } from './domain.js';
import { PlanningFeed } from './planning-feed.js';
import { BuildPlanningFeed } from './build-planning-feed.js';
import { buildTracker, asBuildSprint, saveBuildIssue, sprintRelations, sprintTransitions, changeBuildSprintState } from './build-sprints.js';

const $ = id => document.getElementById(id);
const storageKey = 'redmine-sprint-board.api-key';
// Backlog Scope is a personal view preference, not a Filter and not deployment config.
const scopeStorageKey = 'redmine-sprint-board.all-unplanned';
const collapsedBacklogStorageKey = 'redmine-sprint-board.backlog-collapsed';
let backlogCollapsed = false;
let api, config, statuses = [], projects = [], versions = [], memberships = [], issues = [], board;
let sprint = null, projectId = '', blockedProjectId = '', busy = false, dragging = false, loading = false, epoch = 0, timer, editing;
let feed, queryLoading = false, queryTimer, queryRevision = 0, backlogFailed = false, searchFailed = false;
const observedLists = new WeakSet();
// Backlog Scope lives on the Backlog column header, so it is rebuilt with the board
// rather than read from a persistent control.
let allUnplannedScope = false;
const filters = { query: '', tracker: '', assignee: '' };
let categories = [], categoryId = 'none', categoryOnly = true, buildTrackerId;
let sprintAction = null;
const buildMode = () => config?.sprintSource === 'build';
const newFeed = () => buildMode() ? new BuildPlanningFeed(api) : new PlanningFeed(api);
const closedStatusIds = () => statuses.filter(status => status.is_closed).map(status => status.id);
const preferenceKey = name => `redmine-sprint-board.${name}.${projectId}`;
function preference(name, fallback = null) { try { return localStorage.getItem(preferenceKey(name)) ?? fallback; } catch { return fallback; } }
function remember(name, value) { try { localStorage.setItem(preferenceKey(name), String(value)); } catch { /* Optional personal preferences. */ } }
function selectedMember(issue) { return Boolean(sprint) && (buildMode() ? issue.sprintMember : issue.fixed_version?.id === sprint.id); }
function categoryToggle() {
  return buildMode() ? `<button type="button" class="scope-toggle" data-category-scope aria-label="Filter backlog by category" aria-pressed="${categoryOnly}" title="Show backlog issues only in the selected category.">C</button>` : '';
}

function renderIdentity(user) {
  const parts = [user.firstname?.trim(), user.lastname?.trim()].filter(Boolean);
  const name = parts.join(' ') || user.login?.trim() || 'User';
  const words = parts.length > 1 ? parts : name.trim().split(/[\s._-]+/u).filter(Boolean);
  const initials = (words.length > 1 ? [words[0], words.at(-1)] : words)
    .map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  $('user-avatar').textContent = initials;
  $('user-avatar').setAttribute('aria-label', `Account: ${name}`);
  $('user-avatar').title = name;
  $('user-name').textContent = name;
  $('identity').hidden = false;
}
function positionUserPopover() {
  const bounds = $('user-avatar').getBoundingClientRect();
  $('user-popover').style.top = `${bounds.bottom + 8}px`;
  $('user-popover').style.right = `${Math.max(8, window.innerWidth - bounds.right)}px`;
}

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
  if (select.options.length === rows.length && rows.every(([value, label], index) => select.options[index].value === String(value) && select.options[index].textContent === String(label))) {
    select.value = String(selected); return;
  }
  select.replaceChildren(...rows.map(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; return option;
  }));
  select.value = String(selected);
}
function lock() {
  $('refresh').disabled = busy || loading || !api;
  $('refresh').setAttribute('aria-busy', String(loading));
  document.querySelectorAll('#workspace select, #workspace input, #workspace button, #edit-form input, #edit-form select, #edit-form button[type="submit"]').forEach(el => { el.disabled = busy || loading; });
  document.querySelectorAll('.plan, .scope-toggle').forEach(el => { el.disabled = busy || loading || queryLoading || feed?.loadingMore; });
  if ($('backlog-more')) $('backlog-more').disabled = busy || loading || queryLoading || feed?.loadingMore;
  $('sprint-actions').hidden = !buildMode() || !api || !projectId;
  $('close-sprint').hidden = sprint?.status !== 'open';
  $('reopen-sprint').hidden = sprint?.status !== 'closed';
  for (const id of ['new-sprint', 'close-sprint', 'reopen-sprint']) $(id).disabled = busy || loading || queryLoading || feed?.loadingMore || dragging || !buildTrackerId || blockedProjectId === projectId;
  $('sprint-form').querySelectorAll('input, select, button').forEach(el => { el.disabled = busy; });
  $('workspace').setAttribute('aria-busy', String(busy || loading || queryLoading));
  $('board').setAttribute('aria-busy', String(loading || queryLoading));
}
function destroyBoard() {
  board?.drake?.destroy(); board?.drakeBoard?.destroy(); board = null; $('board').replaceChildren();
}
function clearBoardCards() {
  if (!board) return;
  const emptyColumns = board.options.boards.map(column => {
    const title = document.createElement('div'); title.innerHTML = column.title;
    const count = title.querySelector('.count'); if (count) count.textContent = '0';
    return { ...column, title: title.innerHTML, item: [] };
  });
  reconcileBoard(board, emptyColumns);
}
function cancelQuery() {
  clearTimeout(queryTimer); queryRevision++; feed?.cancel(); queryLoading = false;
}
function allUnplanned() { return allUnplannedScope; }
// An eye: the Backlog Scope is about which unplanned issues are visible. Slashed while the
// Backlog is narrowed to the New status, because open work in other statuses is hidden.
const eyeIcon = open => `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.2 8S3.7 3.4 8 3.4 14.8 8 14.8 8 12.3 12.6 8 12.6 1.2 8 1.2 8Z"/><circle cx="8" cy="8" r="2.1"/>${open ? '' : '<path d="M2.6 13.4 13.4 2.6"/>'}</svg>`;
function scopeToggle() {
  const label = allUnplannedScope ? 'Showing every open issue without a sprint. Click to show only the New status.' : 'Showing only the New status without a sprint. Click to show every open unplanned issue.';
  return `<button type="button" class="scope-toggle" data-backlog-scope aria-label="Show all unplanned" aria-pressed="${allUnplannedScope}" title="${e(label)}">${eyeIcon(allUnplannedScope)}</button>`;
}
function backlogToggle() {
  const label = backlogCollapsed ? 'Expand Backlog' : 'Collapse Backlog';
  return `<button type="button" class="scope-toggle backlog-toggle" data-backlog-collapse aria-label="${label}" title="${label}" aria-expanded="${!backlogCollapsed}" aria-controls="backlog-issues"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${backlogCollapsed ? 'm6 3 5 5-5 5' : 'm10 3-5 5 5 5'}"/></svg></button>`;
}
function syncBacklogVisibility() {
  const column = board.findBoard('backlog'), list = column.querySelector('.kanban-drag');
  column.classList.toggle('backlog-collapsed', backlogCollapsed);
  list.id = 'backlog-issues'; list.hidden = backlogCollapsed; list.tabIndex = backlogCollapsed ? -1 : 0;
  column.querySelector('footer').hidden = backlogCollapsed;
  // Hidden Cards must not remain Dragula drop targets.
  if (backlogCollapsed) {
    const index = board.boardContainer.indexOf(list);
    if (index !== -1) board.boardContainer.splice(index, 1);
  }
}
function toggleBacklog() {
  if (busy || loading || queryLoading || feed?.loadingMore || dragging) return;
  backlogCollapsed = !backlogCollapsed;
  try { localStorage.setItem(collapsedBacklogStorageKey, backlogCollapsed ? '1' : '0'); } catch { /* Optional view preference. */ }
  renderBoard();
  $('board').querySelector('[data-backlog-collapse]')?.focus({ preventScroll: true });
  if (!backlogCollapsed) void fillBacklogColumn();
}
function toggleScope() {
  allUnplannedScope = !allUnplannedScope;
  try { localStorage.setItem(scopeStorageKey, allUnplannedScope ? '1' : '0'); } catch { /* Storage may be disabled. */ }
  // Only the backlog query changes: sprints and memberships stay as they are.
  if (api && feed && projectId) scheduleSearch(0);
}
function feedScope() { return { projectId, sprintId: sprint?.id, backlogStatusId: config.backlogStatusId, allUnplanned: allUnplanned(), buildTrackerId, categoryId, categoryOnly, builds: versions }; }
function backlogScope() {
  return { backlogStatusId: config.backlogStatusId, allUnplanned: allUnplanned(), closedStatusIds: closedStatusIds(), sprintSource: config.sprintSource, buildTrackerId };
}
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
  $('editor').close(); editing = null; $('sprint-dialog').close(); sprintAction = null; destroyBoard();
  issues = []; versions = []; memberships = []; projects = []; categories = []; sprint = null; projectId = ''; blockedProjectId = ''; buildTrackerId = undefined;
  document.body.classList.remove('board-active');
  $('notice-dialog').close(); $('help-dialog').close(); $('build-help').hidden = true;
  $('user-popover').hidePopover(); $('identity').hidden = true;
  $('refresh').hidden = true; $('refresh').disabled = true; $('statusbar').hidden = true; $('updated').textContent = '';
  $('user-avatar').textContent = ''; $('user-avatar').setAttribute('aria-label', 'Account'); $('user-avatar').removeAttribute('title'); $('user-name').textContent = '';
  $('workspace').hidden = true; $('login').hidden = false; $('api-key').focus(); notify('API key forgotten on this browser.');
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
const priorityNames = new Map([
  ['low', 'low'], ['bassa', 'low'], ['basso', 'low'],
  ['normal', 'normal'], ['normale', 'normal'], ['medium', 'normal'], ['media', 'normal'], ['medio', 'normal'],
  ['high', 'high'], ['alta', 'high'], ['alto', 'high'],
  ['urgent', 'urgent'], ['urgente', 'urgent'],
  ['immediate', 'immediate'], ['immediata', 'immediate'], ['immediato', 'immediate'],
]);
function priorityClass(name) {
  const key = String(name || '').trim().toLowerCase();
  return `prio-${priorityNames.get(key) || 'none'}`;
}
function card(issue) {
  const id = Number(issue.id);
  const open = sprint?.status === 'open';
  // Resolved issues strike through the ID, as on a YouTrack card.
  const resolved = statuses.find(status => status.id === issue.status.id)?.is_closed;
  const subject = e(issue.subject);
  const action = `${open ? 'Plan' : 'View'} #${id}`;
  const assignee = issue.assigned_to?.name || 'Unassigned';
  const initials = issue.assigned_to ? assignee.trim().split(/\s+/u).map(part => Array.from(part)[0]).filter(Boolean).slice(0, 2).join('') : '–';
  const fields = [
    `<span class="card-field" title="Priority: ${e(issue.priority.name)}">${e(issue.priority.name)}</span>`,
    `<span class="card-field plain" title="Tracker: ${e(issue.tracker.name)}">${e(issue.tracker.name)}</span>`,
    `<span class="card-field plain" title="Status: ${e(issue.status.name)}">${e(issue.status.name)}</span>`,
  ].join('');
  const hours = issue.estimated_hours == null
    ? '<strong class="unestimated" title="Unestimated">?</strong>'
    : `<strong>${e(issue.estimated_hours)} h</strong>`;
  return {
    id: String(id), class: [...(open ? [] : ['not-draggable']), priorityClass(issue.priority.name)],
    // The summary is clamped to three lines in CSS; title and aria-label keep the full text
    // reachable for pointer and assistive technology alike.
    title: `<div class="card-head"><a class="${resolved ? 'resolved' : ''}" href="${e(linkToIssue(issue.id))}" target="_blank" rel="noopener noreferrer"${resolved ? ' title="Resolved"' : ''}>#${id}</a><h3 title="${subject}" aria-label="${subject}">${subject}</h3></div><div class="card-bottom">${fields}</div><div class="card-footer"><span class="card-assignee" title="Assignee: ${e(assignee)}"><span class="avatar${issue.assigned_to ? '' : ' unassigned'}" aria-hidden="true">${e(initials)}</span><span>${e(assignee)}</span></span>${hours}</div><button type="button" class="plan" data-edit="${id}" aria-label="${action}" title="${action}"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10.5 2.5 3 3M3 10l7.5-7.5a2.1 2.1 0 0 1 3 3L6 13l-4 1 1-4Z"/></svg></button>`,
  };
}
function renderSprintHeading() {
  const heading = $('sprint-name');
  if (!sprint || !buildMode()) {
    const name = sprint?.name || 'No sprint selected';
    if (heading.textContent !== name || heading.querySelector('a')) heading.textContent = name;
    return;
  }
  let link = heading.querySelector('a');
  if (!link) {
    link = document.createElement('a');
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    heading.replaceChildren(document.createTextNode(''), link, document.createTextNode(')'));
  }
  const prefix = `${sprint.subject} (`;
  if (heading.firstChild.textContent !== prefix) heading.firstChild.textContent = prefix;
  const id = `#${sprint.id}`;
  if (link.textContent !== id) link.textContent = id;
  link.href = linkToIssue(sprint.id);
  link.title = `Open Build Sprint ${id} in Redmine`;
}

function renderBoard() {
  if (dragging) return;
  const visible = issues;
  const total = effort(feed?.snapshot.sprintAll || []), filtered = effort(feed?.snapshot.sprintVisible || []);
  renderSprintHeading();
  $('sprint-state').textContent = sprint ? `${sprint.status === 'open' ? 'Open sprint' : 'Closed sprint · read only'}${sprint.due_date ? ` · Due ${sprint.due_date}` : ''}` : buildMode() ? 'Use New sprint to create a Build Sprint in this category.' : 'Create an open target version in Redmine to start planning.';
  const totalsMarkup = `<div><strong>${e(Number(total.hours.toFixed(2)))}</strong><span>estimated hours</span></div><div><strong>${total.count}</strong><span>issues</span></div><div><strong>${total.unestimated}</strong><span>unestimated</span></div>`;
  if ($('totals').innerHTML !== totalsMarkup) $('totals').innerHTML = totalsMarkup;
  const filtering = Object.values(filters).some(value => String(value).trim());
  $('filtered').textContent = filtering
    ? `Visible sprint: ${filtered.count} issues · ${Number(filtered.hours.toFixed(2))} h · ${filtered.unestimated} unestimated`
    : '';
  const backlogIds = new Set(feed?.snapshot.backlog.map(issue => issue.id));
  const backlog = visible.filter(issue => backlogIds.has(issue.id));
  const boards = [{ id: 'backlog', title: `${backlogToggle()}<span class="backlog-label">Backlog</span> <span class="count">${backlog.length} / ${feed?.snapshot.total ?? '?'}</span>${scopeToggle()}${categoryToggle()}`, class: 'backlog-board', item: backlog.map(card) }];
  for (const statusId of config.columnStatusIds) {
    const items = visible.filter(issue => selectedMember(issue) && issue.status.id === statusId);
    boards.push({ id: `status-${statusId}`, title: `${e(statuses.find(status => status.id === statusId).name)} <span class="count">${items.length}</span>`, item: items.map(card) });
  }
  const other = visible.filter(issue => selectedMember(issue) && !config.columnStatusIds.includes(issue.status.id));
  // Filtered-out unmapped work must not make its Column disappear or resize its neighbors.
  if ((feed?.snapshot.sprintAll || []).some(issue => !config.columnStatusIds.includes(issue.status.id))) boards.push({ id: 'other', title: `Other statuses (unmapped) <span class="count">${other.length}</span>`, item: other.map(card) });
  if (!board) board = new jKanban({
    element: '#board', gutter: '16px', widthBoard: '290px', responsive: 0, dragBoards: false, boards,
    dragEl: () => { if (busy || loading || queryLoading || feed?.loadingMore || sprint?.status !== 'open') board.drake.cancel(true); else dragging = true; },
    dragendEl: () => { dragging = false; },
    dropEl: (element, target) => {
      const issue = issues.find(item => item.id === Number(element.dataset.eid));
      // Revert the DOM move immediately; only render a confirmed server state.
      queueMicrotask(() => {
        dragging = false;
        try {
          if (backlogCollapsed && target.parentElement.dataset.id === 'backlog') throw new Error('Expand Backlog before moving issues into it.');
          const patch = movePatch(issue, target.parentElement.dataset.id, sprint); void mutate(issue.id, patch);
        }
        catch (error) { notify(error.message, true); renderBoard(); }
      });
      return false;
    },
  });
  reconcileBoard(board, boards);
  for (const column of $('board').querySelectorAll('.kanban-board')) {
    const list = column.querySelector('.kanban-drag');
    list.tabIndex = 0;
    list.setAttribute('aria-label', `${column.querySelector('header').textContent.trim()} issues`);
  }
  const container = board.findBoard('backlog').querySelector('.kanban-drag');
  container.setAttribute('aria-label', 'Backlog issues'); container.tabIndex = 0;
  if (!observedLists.has(container)) {
    observedLists.add(container);
    container.addEventListener('scroll', () => {
      if (container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 64) void loadMoreBacklog();
    }, { passive: true });
  }
  renderBacklogFooter(); syncBacklogVisibility(); lock();
  $('empty').hidden = visible.length > 0;
}

function renderBacklogFooter() {
  if (!board || !feed) return;
  const node = board.findBoard('backlog');
  node.querySelector('.count').textContent = `${feed.snapshot.backlog.length} / ${feed.snapshot.total ?? '?'}`;
  node.querySelector('.kanban-drag').setAttribute('aria-busy', String(feed.loadingMore || queryLoading));
  const footer = node.querySelector('footer');
  let text = footer.querySelector('span');
  if (!text) { text = document.createElement('span'); text.className = 'muted'; footer.append(text); }
  const message = queryLoading ? 'Updating results…' : searchFailed ? 'Previous results · search failed'
    : !feed.snapshot.hasMore ? 'All matching backlog issues loaded'
      : feed.loadingMore ? 'Loading…' : 'Scroll to load more';
  if (text.textContent !== message) text.textContent = message;
  // A page that failed cannot rely on scrolling to retry: the column may already be at its
  // bottom, so no further scroll event would fire. Keep an explicit control for that case.
  if (feed.snapshot.hasMore && backlogFailed && !feed.loadingMore && !queryLoading && !searchFailed) {
    let more = $('backlog-more');
    if (!more) {
      more = document.createElement('button'); more.type = 'button'; more.id = 'backlog-more';
      more.addEventListener('click', () => void loadMoreBacklog()); footer.append(more);
    }
    more.textContent = 'Retry loading issues';
    more.disabled = busy || loading || queryLoading;
  } else $('backlog-more')?.remove();
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
  if (!container || backlogCollapsed) return;
  for (let page = 0; page < autoFillPages; page++) {
    if (backlogCollapsed || !feed?.snapshot.hasMore || container.scrollHeight > container.clientHeight) return;
    const before = feed.snapshot.backlog.length;
    await loadMoreBacklog({ silent: true });
    if (!container.isConnected) return;
    if (feed.snapshot.backlog.length === before) return;
  }
}
async function loadMoreBacklog({ silent = false } = {}) {
  if (backlogCollapsed || !api || !board || busy || loading || queryLoading || searchFailed || dragging || $('editor').open || feed?.loadingMore || !feed?.snapshot.hasMore) return;
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
    // An open issue can also be visible in a selected closed sprint as history.
    // Deduplicate within Backlog, not across the entire board.
    for (const issue of snapshot.backlog) if (!board.findBoard('backlog').querySelector(`[data-eid="${Number(issue.id)}"]`)) board.addElement('backlog', card(issue));
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
    searchFailed = false; syncFeed(snapshot); renderFilters(); renderBoard();
  } catch (error) {
    if (revision === queryRevision) {
      searchFailed = true;
      if (error.status === 403) blockedProjectId = projectId;
      $('filtered').textContent = 'Search unavailable · showing previous results';
      notify(`Search failed: ${error.message} Change the search or use Refresh to retry.`, true);
    }
  } finally {
    if (revision === queryRevision) { queryLoading = false; lock(); renderBacklogFooter(); void fillBacklogColumn(); }
  }
}
function scheduleSearch(delay) {
  cancelQuery(); queryLoading = true; searchFailed = false; notify('');
  board?.drake?.cancel(true); dragging = false;
  // Keep the last confirmed view throughout debounce and the network request.
  $('filtered').textContent = 'Searching Redmine…'; lock(); renderBacklogFooter();
  const revision = queryRevision;
  queryTimer = setTimeout(() => void searchIssues(revision), delay);
}
function chooseSprint(previousId) {
  const available = versions.filter(version => (!buildMode() || String(version.category?.id || 'none') === categoryId) && (version.status === 'open' || ($('closed').checked && version.status === 'closed')));
  available.sort(buildMode() ? (a, b) => b.id - a.id : (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.name.localeCompare(b.name));
  const preferred = previousId || (buildMode() ? preference(`sprint.${categoryId}`) : null);
  sprint = available.find(version => version.id === Number(preferred)) || available.find(version => version.status === 'open') || available[0] || null;
  if (buildMode() && sprint) remember(`sprint.${categoryId}`, sprint.id);
  options($('sprint'), available.length ? available.map(version => [version.id, version.name + (version.status === 'closed' ? ' (closed)' : '')]) : [['', 'No open sprints']], sprint?.id || '');
}
async function refresh(projectChanged = false, retryDenied = false) {
  if (!api || busy || loading || dragging || $('editor').open || $('sprint-dialog').open || (blockedProjectId === projectId && !projectChanged && !retryDenied)) return;
  if (!projectChanged && !retryDenied && (queryLoading || feed?.loadingMore || (!backlogCollapsed && board?.findBoard('backlog').querySelector('.kanban-drag').scrollTop > 0))) return;
  cancelQuery();
  if (projectChanged || retryDenied) notify('');
  loading = true; lock();
  const stamp = epoch;
  try {
    const project = projects.find(item => String(item.id) === projectId);
    if (buildMode()) {
      buildTrackerId = buildTracker(project, config.buildTrackerId);
      categories = await api.projectCategories(projectId);
      if (stamp !== epoch) return;
      categories.sort((a, b) => a.name.localeCompare(b.name));
      const preferred = projectChanged ? preference('category') : categoryId;
      categoryId = preferred === 'none' || categories.some(c => String(c.id) === preferred) ? preferred : String(categories[0]?.id || 'none');
      if (projectChanged) categoryOnly = preference('category-only', '1') !== '0';
      options($('category'), [...categories.map(c => [c.id, c.name]), ['none', 'Uncategorized']], categoryId);
      remember('category', categoryId);
    }
    const [newVersions, newMemberships] = await Promise.all([
      (buildMode()
        ? api.list('/issues.json', 'issues', { project_id: projectId, subproject_id: '!*', tracker_id: buildTrackerId, status_id: $('closed').checked ? '*' : 'open', sort: 'id:desc' }).then(rows => rows.filter(issue => issue.project.id === Number(projectId) && issue.tracker.id === buildTrackerId).map(issue => asBuildSprint(issue, closedStatusIds())))
        : api.list(`/projects/${projectId}/versions.json`, 'versions')).catch(error => {
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
    searchFailed = false; syncFeed(next); blockedProjectId = '';
    renderFilters(); renderBoard();
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    return true;
  } catch (error) {
    if (stamp === epoch) {
      if (error.status === 403) blockedProjectId = projectId;
      notify(`Refresh failed: ${error.message}${error.status === 403 ? ' Automatic refresh is paused for this project.' : ''}`, true);
      if (projectChanged || error.status === 403 || !issues.length) {
        issues = []; versions = []; memberships = []; sprint = null;
        renderFilters(); clearBoardCards();
        options($('sprint'), [['', 'Sprints unavailable']]);
        $('sprint-name').textContent = 'Sprint data unavailable';
        $('sprint-state').textContent = 'See the error above. Choose another project or retry with Refresh.';
        $('totals').replaceChildren(); $('filtered').textContent = ''; $('updated').textContent = ''; $('empty').hidden = true;
      }
    }
  } finally { if (stamp === epoch) { loading = false; lock(); renderBacklogFooter(); void fillBacklogColumn(); } }
}

async function mutate(id, patch) {
  if (buildMode()) return mutateBuild(id, patch);
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
    notify(patch.fixed_version_id === null && !isBacklog(confirmed, backlogScope())
      ? `Issue #${id} removed from sprint. ${allUnplanned() ? 'Its status is closed' : 'Its status is not the backlog status'}, so it is no longer shown here.`
      : `Issue #${id} saved in Redmine.`);
  } catch (error) {
    if (stamp === epoch) notify(writeConfirmed ? `Issue #${id} was saved, but reloading the board failed: ${error.message} Use Refresh; do not repeat the write.` : `Save not confirmed: ${error.message} Refresh before retrying if the connection failed.`, true);
  }
  finally { if (stamp === epoch) { busy = false; lock(); renderFilters(); renderBoard(); void fillBacklogColumn(); } }
}

async function mutateBuild(id, patch) {
  if (busy || loading || queryLoading || feed?.loadingMore || !api) return;
  cancelQuery(); busy = true; lock();
  const stamp = epoch, currentApi = api;
  let message, failed = false;
  try {
    if (sprint?.status !== 'open') throw new Error('Closed sprints are read only.');
    await saveBuildIssue(currentApi, id, sprint, patch, { closedStatusIds: closedStatusIds(), trackerId: buildTrackerId });
    if (stamp !== epoch) return;
    $('editor').close(); editing = null;
    message = patch.sprint_member === false
      ? `Issue #${id} removed from this sprint. Other Build relations, Category and target version are unchanged; another open Build or the backlog scope may keep it out of backlog.`
      : `Issue #${id} saved in Redmine.`;
  } catch (error) { failed = true; message = `Save not confirmed: ${error.message}`; }
  finally {
    if (stamp === epoch) {
      try {
        feed.pageSize = backlogPageSize(); backlogFailed = false;
        const snapshot = await feed.load(feedScope(), filters);
        if (stamp === epoch && snapshot) syncFeed(snapshot);
      } catch (error) {
        failed = true; message += ` Board reload failed: ${error.message} Use Refresh before retrying.`;
        if (stamp === epoch) { issues = []; feed.snapshot = { ...feed.snapshot, backlog: [], sprintAll: [], sprintVisible: [], total: null, hasMore: false }; }
      }
      if (stamp === epoch) {
        busy = false; notify(message, failed); lock(); renderFilters(); renderBoard(); void fillBacklogColumn();
      }
    }
  }
}

async function openSprintAction(action) {
  if (!buildMode() || !api || busy || loading || queryLoading || feed?.loadingMore || dragging || !buildTrackerId || blockedProjectId === projectId) return;
  if (action !== 'new' && !sprint) return;
  loading = true; lock();
  const stamp = epoch;
  const context = { action, projectId, categoryId, trackerId: buildTrackerId, sprint };
  try {
    let transitions = [];
    if (action !== 'new') {
      const fresh = await api.issue(context.sprint.id);
      if (stamp !== epoch) return;
      const closed = closedStatusIds().includes(fresh.status.id);
      if (closed !== (action === 'reopen')) throw new Error('The sprint state has changed. Refresh before retrying.');
      transitions = sprintTransitions(fresh, statuses, action === 'close');
      if (!transitions.length) throw new Error(`Redmine provides no permitted ${action === 'close' ? 'closed' : 'open'} status for this Sprint. Check your workflow and permissions.`);
    }
    sprintAction = context;
    $('sprint-dialog-title').textContent = action === 'new' ? 'New sprint' : action === 'close' ? 'Close sprint' : 'Reopen sprint';
    $('sprint-context').textContent = `${projects.find(p => String(p.id) === projectId)?.name} · ${categories.find(c => String(c.id) === categoryId)?.name || 'Uncategorized'}${action === 'new' ? '' : ` · ${context.sprint.name}`}`;
    $('sprint-warning').textContent = action === 'new'
      ? (categoryId === 'none' ? 'This Sprint will have no Category (Uncategorized). Continue only if that is intentional.' : 'Create a Build Sprint in the selected Project and Category. Redmine supplies defaults for other fields.')
      : action === 'close' ? 'Close this Sprint? Member issue statuses will not change. Open issues with no other open Sprint may return to the Backlog.'
        : 'Reopen this Sprint? Member issue statuses will not change.';
    $('sprint-create-fields').hidden = action !== 'new';
    $('new-sprint-name').required = action === 'new';
    $('new-sprint-name').value = ''; $('new-sprint-name').setCustomValidity(''); $('new-sprint-due').value = '';
    $('sprint-status-field').hidden = transitions.length < 2;
    options($('sprint-target-status'), transitions.map(s => [s.id, s.name]), transitions[0]?.id || '');
    $('submit-sprint').textContent = action === 'new' ? 'Create sprint' : action === 'close' ? 'Close sprint' : 'Reopen sprint';
    $('sprint-dialog-notice').hidden = true;
    if (action !== 'reopen' || transitions.length > 1) {
      $('sprint-dialog').showModal();
      (action === 'new' ? $('new-sprint-name') : transitions.length > 1 ? $('sprint-target-status') : $('submit-sprint')).focus();
    }
  } catch (error) { if (stamp === epoch) notify(error.message, true); }
  finally { if (stamp === epoch) { loading = false; lock(); } }
  if (stamp === epoch && sprintAction === context && action === 'reopen' && $('sprint-target-status').options.length === 1) await submitSprintAction();
}

async function submitSprintAction() {
  if (!sprintAction || busy || loading || !api) return;
  const context = sprintAction, currentApi = api, stamp = epoch;
  const name = $('new-sprint-name').value.trim();
  if (context.action === 'new' && !name) {
    $('new-sprint-name').setCustomValidity('Enter a Sprint name.'); $('new-sprint-name').reportValidity(); return;
  }
  cancelQuery(); busy = true; lock();
  let message, failed = false, createdId;
  try {
    if (context.action === 'new') {
      const fields = { project_id: Number(context.projectId), tracker_id: context.trackerId, subject: name,
        ...(context.categoryId === 'none' ? {} : { category_id: Number(context.categoryId) }),
        ...($('new-sprint-due').value ? { due_date: $('new-sprint-due').value } : {}) };
      const created = await currentApi.createIssue(fields);
      if (stamp !== epoch) return;
      if (!created?.id) throw new Error('Redmine did not return the created issue ID. It may already exist; inspect the Sprint list before creating another.');
      createdId = created.id;
      const confirmed = await currentApi.issue(created.id);
      if (stamp !== epoch) return;
      if (confirmed.project.id !== Number(context.projectId) || confirmed.tracker.id !== context.trackerId ||
          String(confirmed.category?.id || 'none') !== context.categoryId || confirmed.subject !== name ||
          (fields.due_date && confirmed.due_date !== fields.due_date) || closedStatusIds().includes(confirmed.status.id)) {
        throw new Error(`Build #${created.id} was created, but its requested fields or open status were not retained. Check it in Redmine; do not create a duplicate.`);
      }
      sprint = asBuildSprint(confirmed, closedStatusIds());
      message = `Sprint #${created.id} created in Redmine.`;
    } else {
      const confirmed = await changeBuildSprintState(currentApi, context.sprint, Number($('sprint-target-status').value), statuses, context.trackerId);
      if (stamp !== epoch) return;
      sprint = asBuildSprint(confirmed, closedStatusIds());
      message = `Sprint #${confirmed.id} ${context.action === 'close' ? 'closed' : 'reopened'} in Redmine.`;
    }
  } catch (error) {
    if (stamp !== epoch) return;
    // Validation/permission rejections are safe to correct; never invite an automatic
    // retry of an ambiguous POST, which could create a duplicate Sprint.
    if (context.action === 'new' && [403, 422].includes(error.status)) {
      $('sprint-dialog-notice').textContent = error.message; $('sprint-dialog-notice').hidden = false;
      busy = false; lock(); return;
    }
    failed = true;
    message = `${createdId ? `Build #${createdId} was created, but verification failed` : 'Sprint change not confirmed'}: ${error.message} Refresh and inspect Redmine before retrying; no automatic retry was attempted.`;
  }
  if (stamp !== epoch) return;
  $('sprint-dialog').close(); sprintAction = null;
  if (context.action === 'close') $('closed').checked = true;
  busy = false;
  const refreshed = await refresh(false, true);
  if (stamp === epoch) {
    const reloadFailed = !refreshed;
    notify(`${message}${reloadFailed ? ' Board reload may have failed; use Refresh before continuing.' : ''}`, failed || reloadFailed);
    lock();
  }
}

async function openEditor(id) {
  if (busy || loading || queryLoading || feed?.loadingMore) return;
  loading = true; lock();
  const stamp = epoch;
  try {
    const issue = await api.issue(id);
    if (buildMode() && sprint) issue.sprintMember = sprintRelations(await api.relations(sprint.id), id, sprint.id).length > 0;
    if (stamp !== epoch) return;
    editing = issue;
    $('editor-notice').hidden = true;
    $('editor-title').textContent = `Plan #${issue.id}`; $('editor-subject').textContent = issue.subject;
    const people = new Map(members()); if (issue.assigned_to) people.set(issue.assigned_to.id, issue.assigned_to.name);
    options($('edit-assignee'), [['', 'Unassigned'], ...people], issue.assigned_to?.id || '');
    $('edit-estimate').value = issue.estimated_hours ?? '';
    const allowed = new Map([issue.status, ...(issue.allowed_statuses || [])].map(status => [status.id, status.name]));
    options($('edit-status'), [...allowed], issue.status.id);
    $('edit-destination').value = selectedMember(issue) ? 'sprint' : 'backlog';
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
    feed = newFeed(); $('category-control').hidden = !buildMode(); $('build-help').hidden = !buildMode();
    if (!projects.length) throw new Error('No projects are visible to your account.');
    try {
      if (remember) localStorage.setItem(storageKey, key); else localStorage.removeItem(storageKey);
    } catch { notify('Connected, but browser storage is unavailable. The API key will not be remembered.', true); }
    $('api-key').value = ''; $('login').hidden = true; $('workspace').hidden = false;
    document.body.classList.add('board-active');
    $('refresh').hidden = false; $('statusbar').hidden = false;
    renderIdentity(userData.user);
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

$('user-popover').addEventListener('beforetoggle', event => {
  if (event.newState === 'open') positionUserPopover();
});
$('user-popover').addEventListener('toggle', event => {
  $('user-avatar').setAttribute('aria-expanded', String(event.newState === 'open'));
});
window.addEventListener('resize', () => {
  if ($('user-popover').matches(':popover-open')) positionUserPopover();
});
$('sign-out').addEventListener('click', forget);
$('open-help').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('forget-saved').addEventListener('click', forget);
$('login-form').addEventListener('submit', event => { event.preventDefault(); void connect($('api-key').value.trim(), $('remember').checked); });
$('project').addEventListener('change', () => {
  cancelQuery(); feed = newFeed();
  projectId = $('project').value; issues = []; sprint = null; versions = []; memberships = [];
  Object.assign(filters, { query: '', tracker: '', assignee: '' }); $('query').value = '';
  clearBoardCards(); void refresh(true);
});
$('category').addEventListener('change', () => {
  cancelQuery(); feed = newFeed(); categoryId = $('category').value; remember('category', categoryId);
  issues = []; sprint = null; void refresh(false, true);
});
$('sprint').addEventListener('change', () => {
  cancelQuery(); feed = newFeed();
  sprint = versions.find(version => version.id === Number($('sprint').value)); issues = []; void refresh(false, true);
});
$('closed').addEventListener('change', () => { cancelQuery(); issues = []; void refresh(false, true); });
$('refresh').addEventListener('click', () => { notify(''); void refresh(false, true); });
for (const [id, field, eventName] of [['query', 'query', 'input'], ['tracker', 'tracker', 'change'], ['assignee', 'assignee', 'change']]) {
  $(id).addEventListener(eventName, () => { filters[field] = $(id).value; scheduleSearch(field === 'query' ? 300 : 0); });
}
// jKanban cancels every Card click with preventDefault(). Stop link clicks before
// that handler, without cancelling native navigation (new tabs, modifiers, Enter).
$('board').addEventListener('click', event => {
  if (event.target.closest('.card-head a[href]')) event.stopPropagation();
}, { capture: true });
$('board').addEventListener('click', event => {
  if (event.target.closest('[data-backlog-collapse]')) { toggleBacklog(); return; }
  if (event.target.closest('[data-backlog-scope]')) { toggleScope(); return; }
  if (event.target.closest('[data-category-scope]')) {
    categoryOnly = !categoryOnly; remember('category-only', categoryOnly ? '1' : '0'); scheduleSearch(0); return;
  }
  const button = event.target.closest('[data-edit]'); if (button) void openEditor(Number(button.dataset.edit));
});
for (const [id, action] of [['new-sprint', 'new'], ['close-sprint', 'close'], ['reopen-sprint', 'reopen']]) {
  $(id).addEventListener('click', () => void openSprintAction(action));
}
for (const id of ['cancel-sprint', 'dismiss-sprint']) $(id).addEventListener('click', () => {
  if (!busy) { $('sprint-dialog').close(); sprintAction = null; }
});
$('sprint-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else sprintAction = null; });
$('new-sprint-name').addEventListener('input', () => $('new-sprint-name').setCustomValidity(''));
$('sprint-form').addEventListener('submit', event => { event.preventDefault(); void submitSprintAction(); });
$('close-editor').addEventListener('click', () => { if (!busy) { $('editor').close(); editing = null; } });
$('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('edit-form').addEventListener('submit', event => {
  event.preventDefault(); if (!editing || busy) return;
  try {
    if (sprint?.status !== 'open') throw new Error('Select an open sprint before editing issues.');
    const patch = { assigned_to_id: $('edit-assignee').value ? Number($('edit-assignee').value) : null, estimated_hours: parseEstimate($('edit-estimate').value), status_id: Number($('edit-status').value), ...(buildMode() ? { sprint_member: $('edit-destination').value === 'sprint' } : { fixed_version_id: $('edit-destination').value === 'sprint' ? sprint.id : null }) };
    void mutate(editing.id, patch);
  } catch (error) { notify(error.message, true); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
try {
  allUnplannedScope = localStorage.getItem(scopeStorageKey) === '1';
  backlogCollapsed = localStorage.getItem(collapsedBacklogStorageKey) === '1';
} catch { /* Default to the narrow backlog without local storage. */ }
try {
  const remembered = localStorage.getItem(storageKey);
  if (remembered) { $('forget-saved').hidden = false; $('remember').checked = true; void connect(remembered, true); }
} catch { /* Explicit login still works without local storage. */ }
