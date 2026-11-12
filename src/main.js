const jKanban = window.jKanban;
import './style.css';
import { reconcileBoard, alignSwimlanes, positionSwimlaneHeaders } from './board-view.js';
import { RedmineClient, RedmineError } from './api.js';
import { validateConfig, isBacklog, effort, movePatch, parseEstimate, assertTransition, matchesPatch, sprintValues, membershipPatch, hasSprintField, projectScope, escapeHtml as e } from './domain.js';
import { PlanningFeed } from './planning-feed.js';
import { isSwimlane, loadAncestors, groupSwimlanes } from './swimlanes.js';
import { collectMissingSubtasks, createHierarchyReader, planDescendants } from './descendant-planning.js';
import { createLoadingOverlay } from './loading-overlay.js';
import { settledResults } from './settled-results.js';
import { createSelectionPreferences } from './selection-preferences.js';

const $ = id => document.getElementById(id);
const beginLoading = createLoadingOverlay($('loading-overlay'));
const storageKey = 'redmine-sprint-board.api-key';
const collapsedBacklogStorageKey = 'redmine-sprint-board.backlog-collapsed';
let backlogCollapsed = false;
let backlogFiltersExpanded = false;
let showClosedParents = false;
const closedParentsStorageKey = 'redmine-sprint-board.closed-parents';
let api, config, statuses = [], projects = [], versions = [], memberships = [], issues = [], board;
let sprint = null, projectId = '', blockedProjectId = '', busy = false, dragging = false, loading = false, epoch = 0, timer, editing;
let autorefresh = false;
let selectionPreferences;
function setAutorefresh(enabled) {
  autorefresh = enabled;
  clearInterval(timer);
  if (enabled) timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, config.refreshSeconds * 1000);
  $('refresh').setAttribute('aria-pressed', String(enabled));
  $('refresh').title = `Autorefresh ${enabled ? 'on — disable' : 'off — enable'}`;
}
let feed, queryLoading = false, queryTimer, queryRevision = 0, backlogFailed = false, searchFailed = false;
let expansionFailed = false;
const observedLists = new WeakSet();
const mirroredStatusScrolls = new WeakMap();
const filters = { query: '', tracker: '', assignee: '', tags: [] };
const backlogFiltered = () => Boolean(filters.query.trim() || filters.tracker || filters.assignee || filters.tags.length);
function resetFilters() {
  Object.assign(filters, { query: '', tracker: '', assignee: '', tags: [] });
  for (const id of ['query', 'tracker', 'assignee', 'backlog-tag']) $(id).value = '';
}
const tagsMarkup = issue => (issue.tags || []).map(tag => `<span class="issue-tag">${e(tag)}</span>`).join('');
let laneAncestors = [], laneMembers;
let lanePlanning = new Map();
let lanePlanningController;
let laneResizeObserver;
const newFeed = () => new PlanningFeed(api);
const closedStatusIds = () => statuses.filter(status => status.is_closed).map(status => status.id);
function selectedMember(issue) { return Boolean(sprint) && sprintValues(issue, config.sprintFieldId).includes(sprint.id); }

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
  $('refresh').disabled = !api;
  $('refresh-now').disabled = busy || loading || !api;
  $('refresh-now').setAttribute('aria-busy', String(loading));
  document.querySelectorAll('#workspace select, #workspace input, #workspace button, #edit-form input, #edit-form select, #edit-form button[type="submit"]').forEach(el => { el.disabled = busy || loading; });
  document.querySelectorAll('.plan, .scope-toggle').forEach(el => { el.disabled = busy || loading || (el.closest('[data-id="backlog"]') && (queryLoading || feed?.loadingMore)); });
  $('tracker').disabled = busy || loading || !eligibleTrackers().length;
  document.querySelectorAll('[data-add-descendants]').forEach(el => { el.disabled = busy || loading || sprint?.status !== 'open' || !lanePlanning.get(Number(el.dataset.addDescendants))?.count; });
  if ($('backlog-more')) $('backlog-more').disabled = busy || loading || queryLoading || feed?.loadingMore;
  document.querySelectorAll('[data-backlog-collapse]').forEach(el => { el.disabled = busy || loading || dragging; });
  $('workspace').setAttribute('aria-busy', String(busy || loading));
  $('board').setAttribute('aria-busy', String(loading));
}
function destroyBoard() {
  // Preserve the controls and their event listeners when replacing the board.
  for (const id of ['filter-controls', 'backlog-search', 'filtered']) { $(id).hidden = true; $('workspace').append($(id)); }
  laneResizeObserver?.disconnect(); laneResizeObserver = null;
  board?.drake?.destroy(); board?.drakeBoard?.destroy(); board = null; $('board').replaceChildren();
}
function clearBoardCards() {
  if (!board) return;
  const emptyColumns = board.options.boards.map(column => {
    const title = document.createElement('div'); title.innerHTML = column.title;
    const count = title.querySelector('.count'); if (count) count.textContent = '0';
    return { ...column, title: title.innerHTML, item: [], lanes: undefined };
  });
  reconcileBoard(board, emptyColumns);
}
function cancelQuery() {
  clearTimeout(queryTimer); queryRevision++; feed?.cancel(); queryLoading = false;
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
  const controls = $('filter-controls');
  if (controls.parentElement !== column) column.insertBefore(controls, list);
  controls.hidden = backlogCollapsed || !backlogFiltersExpanded;
  $('toggle-backlog-filters').setAttribute('aria-expanded', String(backlogFiltersExpanded));
  $('backlog-closed').checked = showClosedParents;
  const search = $('backlog-search'), header = column.querySelector('header');
  if (search.parentElement !== header) header.append(search);
  search.hidden = backlogCollapsed;
  const feedback = $('filtered');
  if (feedback.parentElement !== column) column.insertBefore(feedback, list);
  feedback.hidden = backlogCollapsed;
  // Hidden Cards must not remain Dragula drop targets.
  if (backlogCollapsed) {
    const index = board.boardContainer.indexOf(list);
    if (index !== -1) board.boardContainer.splice(index, 1);
  }
}
function toggleBacklog() {
  if (busy || loading || dragging) return;
  backlogCollapsed = !backlogCollapsed;
  clearTimeout(queryTimer); queryRevision++; queryLoading = false;
  feed.clearBacklog(); expansionFailed = searchFailed = backlogFailed = false;
  try { localStorage.setItem(collapsedBacklogStorageKey, backlogCollapsed ? '1' : '0'); } catch { /* Optional view preference. */ }
  issues = issues.filter(issue => selectedMember(issue));
  renderBoard();
  if (!backlogCollapsed) startBacklog();
  $('board').querySelector('[data-backlog-collapse]')?.focus({ preventScroll: true });
}
function eligibleTrackers() {
  if (!config) return [];
  const ids = projectScope(projects, projectId);
  return [...new Map(projects.filter(project => ids.includes(project.id)).flatMap(project => project.trackers || [])
    .filter(tracker => config.swimlaneTrackers.includes(tracker.name)).map(tracker => [tracker.id, tracker])).values()];
}
function feedScope() { return { projectId, projectIds: projectScope(projects, projectId), sprintId: sprint?.id, sprintFieldId: config.sprintFieldId, swimlaneTrackers: config.swimlaneTrackers, showClosedParents, parentTrackerIds: eligibleTrackers().map(tracker => tracker.id) }; }
function backlogScope() {
  return { sprintFieldId: config.sprintFieldId, swimlaneTrackers: config.swimlaneTrackers, showClosedParents, closedStatusIds: closedStatusIds() };
}
async function syncFeed(snapshot) {
  const activeFeed = feed, currentApi = api, stamp = epoch, revision = queryRevision;
  const scope = feedScope();
  const ancestors = !config.swimlaneTrackers.length ? [] : laneMembers === snapshot.sprintAll ? laneAncestors : await loadAncestors(currentApi, snapshot.sprintAll);
  if (activeFeed !== feed || stamp !== epoch || revision !== queryRevision || activeFeed.snapshot !== snapshot) return false;
  const changed = laneMembers !== snapshot.sprintAll || lanePlanningController?.signal.aborted;
  const planning = changed ? new Map() : lanePlanning;
  if (activeFeed !== feed || stamp !== epoch || revision !== queryRevision || activeFeed.snapshot !== snapshot) return false;
  laneAncestors = ancestors; laneMembers = snapshot.sprintAll; lanePlanning = planning;
  issues = [...new Map([...snapshot.backlog, ...snapshot.sprintVisible].map(issue => [issue.id, issue])).values()];
  if (changed) {
    lanePlanningController?.abort();
    const signal = (lanePlanningController = new AbortController()).signal;
    const hierarchy = createHierarchyReader(currentApi, { signal, cache: true });
    const current = () => !signal.aborted && activeFeed === feed && stamp === epoch && laneMembers === snapshot.sprintAll;
    for (const parent of snapshot.sprintAll.filter(issue => isSwimlane(issue, config.swimlaneTrackers))) {
      planning.set(parent.id, { pending: true });
      void (async () => {
        let state;
        try { state = { count: (await collectMissingSubtasks(hierarchy, parent.id, scope)).length }; }
        catch (error) { state = { error: error.message }; }
        if (!current()) return;
        planning.set(parent.id, state);
        renderBoard();
      })();
    }
  }
  return true;
}
function forget() {
  lanePlanningController?.abort();
  selectionPreferences = null;
  cancelQuery(); feed = null;
  epoch++; setAutorefresh(false); api?.dispose(); api = null; busy = loading = dragging = false;
  resetFilters();
  try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
  $('api-key').value = ''; $('remember').checked = false;
  $('login-form').querySelector('button').disabled = false;
  $('forget-saved').hidden = true;
  $('editor').close(); editing = null; destroyBoard();
  issues = []; versions = []; memberships = []; projects = []; sprint = null; projectId = ''; blockedProjectId = '';
  document.body.classList.remove('board-active');
  $('notice-dialog').close(); $('help-dialog').close();
  $('user-popover').hidePopover(); $('identity').hidden = true;
  $('refresh').hidden = true; $('refresh').disabled = true; $('refresh-now').hidden = true; $('statusbar').hidden = true; $('updated').textContent = '';
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
  const trackers = eligibleTrackers();
  if (filters.tracker && !trackers.some(tracker => String(tracker.id) === filters.tracker)) filters.tracker = '';
  options($('tracker'), [['', 'All eligible trackers'], ...trackers.map(tracker => [tracker.id, tracker.name])], filters.tracker);
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
  const heading = $('sprint-name'), name = sprint?.name || 'No sprint selected';
  if (heading.textContent !== name) heading.textContent = name;
}

function unmappedNotice(items) {
  if (!items.length) return '';
  return `<details class="unmapped-notice"><summary>${items.length} issues outside displayed statuses</summary><ul>${items.map(issue => `<li><a href="${e(linkToIssue(issue.id))}" target="_blank" rel="noopener noreferrer">#${Number(issue.id)} — ${e(issue.subject)}</a> · ${e(issue.status.name)}</li>`).join('')}</ul></details>`;
}
function laneHeading(lane) {
  const id = Number(lane.parent?.id);
  const title = lane.parent ? `<a href="${e(linkToIssue(id))}" target="_blank" rel="noopener noreferrer">#${id} — ${e(lane.parent.subject)}</a>` : 'Ungrouped';
  const metadata = lane.parent ? `<span class="lane-tracker">${e(lane.parent.tracker?.name || '')}</span><span class="lane-priority ${priorityClass(lane.parent.priority?.name || '')}"><span class="card-field">${e(lane.parent.priority?.name || '')}</span></span><span class="lane-tags">${tagsMarkup(lane.parent)}</span>` : '';
  const state = lanePlanning.get(id);
  const hint = !state || state.pending ? 'Checking missing subtasks…' : state.error ? `Missing subtasks unknown: ${state.error} Use Refresh to retry.` : `Add missing subtasks to ${sprint?.name || 'this Sprint'} (${state.count || 0} missing). Includes closed subtasks and those assigned elsewhere; preserves statuses and other Sprints. Cards group under their nearest planned Swimlane.`;
  const icon = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v10h3M3 6h3M9 6h7M9 13h2M15 11v6M12 14h6"/>${state?.error ? '<circle cx="16" cy="3" r="2"/>' : ''}</svg>`;
  const action = lane.parent ? `<span class="swimlane-actions" title="${e(hint)}"><button type="button" class="add-subtasks${state?.count ? ' requires-attention' : ''}${state?.error ? ' planning-unknown' : ''}" data-add-descendants="${id}" aria-label="Add missing subtasks for #${id}" title="${e(hint)}"${state?.error ? ' aria-invalid="true"' : ''}>${icon}</button></span>` : '';
  return `<div class="swimlane-title-row"><strong>${title}</strong>${metadata}${action}</div>${unmappedNotice(lane.visible.filter(issue => !config.columnStatusIds.includes(issue.status.id)))}`;
}

function renderBoard() {
  if (dragging) return;
  const visible = issues;
  const total = effort(feed?.snapshot.sprintAll || []);
  renderSprintHeading();
  $('sprint-state').textContent = sprint ? `${sprint.status === 'open' ? 'Open sprint' : 'Closed sprint · read only'}${sprint.due_date ? ` · Due ${sprint.due_date}` : ''}` : 'Create an open product version in Redmine to start planning.';
  const totalsMarkup = `<div><strong>${e(Number(total.hours.toFixed(2)))}</strong><span>estimated hours</span></div><div><strong>${total.count}</strong><span>issues</span></div><div><strong>${total.unestimated}</strong><span>unestimated</span></div>`;
  if ($('totals').innerHTML !== totalsMarkup) $('totals').innerHTML = totalsMarkup;
  const backlogIds = new Set(feed?.snapshot.backlog.map(issue => issue.id));
  const backlog = visible.filter(issue => backlogIds.has(issue.id));
  const boards = [{ id: 'backlog', title: `${backlogToggle()}<span class="backlog-label">Backlog</span> <span class="count">${backlog.length} / ${feed?.snapshot.total ?? '?'}</span>${backlogCollapsed && backlogFiltered() ? '<span class="backlog-filtered muted">Filtered</span>' : ''}`, class: 'backlog-board', item: backlog.map(card) }];
  const lanes = config.swimlaneTrackers.length ? groupSwimlanes(feed?.snapshot.sprintAll || [], feed?.snapshot.sprintVisible || [], config.swimlaneTrackers, laneAncestors) : null;
  for (const [index, statusId] of config.columnStatusIds.entries()) {
    const items = lanes ? lanes.flatMap(lane => lane.visible.filter(issue => issue.status.id === statusId).map(issue => ({ ...card(issue), lane: lane.id })))
      : visible.filter(issue => selectedMember(issue) && issue.status.id === statusId).map(card);
    boards.push({ id: `status-${statusId}`, title: `${e(statuses.find(status => status.id === statusId).name)} <span class="count">${items.length}</span>`, item: items,
      lanes: lanes?.map(lane => ({ id: lane.id, title: index === 0 ? laneHeading(lane) : '' })),
    });
  }
  if (!lanes) {
    const other = visible.filter(issue => selectedMember(issue) && !config.columnStatusIds.includes(issue.status.id));
    if (other.length) boards[1].title += unmappedNotice(other);
  }
  if (!board) board = new jKanban({
    element: '#board', gutter: '16px', widthBoard: '290px', responsive: 0, dragBoards: false, boards,
    dragEl: element => { if (busy || loading || (element.closest('[data-id="backlog"]') && (queryLoading || feed?.loadingMore)) || sprint?.status !== 'open') board.drake.cancel(true); else dragging = true; },
    dragendEl: () => { dragging = false; queueMicrotask(() => { if (board && !busy) renderBoard(); }); },
    dropEl: (element, target) => {
      const issue = issues.find(item => item.id === Number(element.dataset.eid));
      // Revert the DOM move immediately; only render a confirmed server state.
      queueMicrotask(() => {
        dragging = false;
        try {
          if (backlogCollapsed && target.parentElement.dataset.id === 'backlog') throw new Error('Expand Backlog before moving issues into it.');
           if (target.parentElement.dataset.id !== 'backlog' && isSwimlane(issue, config.swimlaneTrackers) && !selectedMember(issue)) {
             void addMissingSubtasks(issue.id, true);
           } else {
             const patch = movePatch(issue, target.parentElement.dataset.id, sprint, config.sprintFieldId); void mutate(issue.id, patch);
           }
        }
        catch (error) { notify(error.message, true); renderBoard(); }
      });
      return false;
    },
  });
  // Headers and controls are never draggable; Cards remain jKanban/Dragula items.
  board.__getCanMove = handle => !handle.closest('a, button, input, select, summary') && Boolean(handle.closest('.kanban-item'));
  reconcileBoard(board, boards);
  if (!laneResizeObserver) {
    laneResizeObserver = new ResizeObserver(() => { if (board && !dragging) alignSwimlanes(board.container); });
    laneResizeObserver.observe($('board'));
  }
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
  renderBacklogFooter(); syncBacklogVisibility(); alignSwimlanes(board.container); lock();
  $('empty').hidden = true;
}

function renderBacklogFooter() {
  if (!board || !feed) return;
  const node = board.findBoard('backlog');
  node.querySelector('.count').textContent = `${feed.snapshot.backlog.length} / ${feed.snapshot.total ?? '?'}`;
  node.querySelector('.kanban-drag').setAttribute('aria-busy', String(feed.loadingMore || queryLoading));
  const footer = node.querySelector('footer');
  let text = footer.querySelector('span');
  if (!text) { text = document.createElement('span'); text.className = 'muted'; footer.append(text); }
  const message = queryLoading ? 'Updating results…' : expansionFailed ? 'Could not load Backlog' : searchFailed ? 'Previous results · search failed'
    : !feed.snapshot.backlog.length && backlogFiltered() ? 'No backlog issues match these filters'
    : !feed.snapshot.backlog.length ? 'No backlog issues'
    : !feed.snapshot.hasMore ? 'All matching backlog issues loaded'
      : feed.loadingMore ? 'Loading…' : 'Scroll to load more';
  if (text.textContent !== message) text.textContent = message;
  $('filtered').textContent = queryLoading ? 'Searching backlog…' : expansionFailed ? 'Backlog unavailable' : searchFailed ? 'Search unavailable · showing previous results' : '';
  if (expansionFailed && !queryLoading) {
    let retry = $('backlog-retry');
    if (!retry) {
      retry = document.createElement('button'); retry.type = 'button'; retry.id = 'backlog-retry'; retry.textContent = 'Retry';
      retry.addEventListener('click', startBacklog); footer.append(retry);
    }
  } else $('backlog-retry')?.remove();
  $('clear-filters').hidden = !backlogFiltered();
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
    if (!await syncFeed(snapshot)) return;
    renderFilters();
    if (board !== activeBoard) { renderBoard(); return; }
    // Append only newly loaded Backlog Cards, preserving existing DOM and scroll state.
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
function startBacklog() {
  if (backlogCollapsed || !api || !board) return;
  clearTimeout(queryTimer); queryRevision++;
  feed.clearBacklog(); issues = issues.filter(issue => selectedMember(issue));
  queryLoading = true; expansionFailed = searchFailed = backlogFailed = false;
  renderBoard();
  void searchIssues(queryRevision, true);
}
async function searchIssues(revision, fresh = false) {
  if (revision !== queryRevision || backlogCollapsed) return;
  try {
    feed.pageSize = backlogPageSize();
    const snapshot = await feed.loadBacklog(feedScope(), filters);
    if (!snapshot || revision !== queryRevision) return;
    if (!await syncFeed(snapshot)) return;
    searchFailed = false; renderFilters(); renderBoard();
  } catch (error) {
    if (revision === queryRevision) {
      searchFailed = true;
      expansionFailed = fresh;
      $('filtered').textContent = 'Search unavailable · showing previous results';
      // Keep failure feedback inside Backlog; Sprint content and access are unaffected.
      $('filtered').title = error.message;
    }
  } finally {
    if (revision === queryRevision) { queryLoading = false; lock(); renderBacklogFooter(); }
  }
}
function scheduleSearch(delay) {
  if (backlogCollapsed) return;
  cancelQuery(); queryLoading = true; searchFailed = expansionFailed = false; notify('');
  // Keep the last confirmed view throughout debounce and the network request.
  $('filtered').removeAttribute('title'); lock(); renderBacklogFooter();
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
  if (!projectChanged && !retryDenied && (queryLoading || feed?.loadingMore || (!backlogCollapsed && board?.findBoard('backlog').querySelector('.kanban-drag').scrollTop > 0))) return;
  lanePlanningController?.abort();
  cancelQuery();
  if (projectChanged || retryDenied) notify('');
  loading = true; lock();
  const finishLoading = beginLoading();
  const stamp = epoch;
  let refreshed = false;
  try {
    const project = projects.find(item => String(item.id) === projectId);
    const [newVersions, newMemberships] = await settledResults([
      api.list(`/projects/${projectId}/versions.json`, 'versions').catch(error => {
        if (error.status === 403) throw new RedmineError(`Cannot load sprints for project "${project?.name || projectId}" (#${projectId}): Redmine returned 403 Forbidden. Check that Issue tracking is enabled and your project role has View issues permission. If both are correct, check plugin or gateway restrictions. Select another project, or click Refresh after access is corrected.`, 403);
        throw error;
      }),
      api.list(`/projects/${projectId}/memberships.json`, 'memberships').catch(error => { if (error.status === 403) return []; throw error; }),
    ]);
    if (stamp !== epoch) return;
    versions = newVersions.filter(version => Number(version.project?.id) === Number(projectId) && version.sharing !== 'none'); memberships = newMemberships;
    chooseSprint(projectChanged || !sprint ? selectionPreferences?.sprint(projectId) : sprint.id);
    renderFilters();
    feed.pageSize = backlogPageSize(); backlogFailed = false;
    const next = await feed.load(feedScope(), filters, { includeBacklog: false });
    if (!next || stamp !== epoch) return;
    if (!await syncFeed(next)) return;
    searchFailed = false; blockedProjectId = '';
    renderFilters(); renderBoard();
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    refreshed = true;
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
  } finally { if (stamp === epoch) { loading = false; lock(); renderBacklogFooter(); if (refreshed) startBacklog(); } finishLoading(); }
}

async function addMissingSubtasks(id, includeParent = false) {
  if (busy || loading || !api || sprint?.status !== 'open') return;
  cancelQuery(); busy = true; lock();
  const finishLoading = beginLoading();
  const stamp = epoch, currentApi = api;
  notify('Checking hierarchy and planning Sprint membership…');
  try {
    const report = await planDescendants(currentApi, id, feedScope(), { includeParent, openedStatusId: config.openedStatusId });
    if (stamp !== epoch) return;
    const list = ids => ids.length ? ids.map(id => `#${id}`).join(', ') : 'none';
    let message = `Added/confirmed: ${list(report.added)}. Failed/unconfirmed: ${list(report.failed)}. Not attempted: ${list(report.notAttempted)}.${report.error ? ` ${report.error}` : ''}`;
    let refreshFailed = false;
    try {
      feed.pageSize = backlogPageSize(); backlogFailed = false;
      const snapshot = await feed.load(feedScope(), filters, { includeBacklog: false });
      if (stamp !== epoch) return;
      if (!snapshot || !await syncFeed(snapshot)) throw new Error('Refresh was superseded.');
      $('updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      refreshFailed = true; lanePlanning = new Map([...lanePlanning.keys()].map(id => [id, { error: 'Refresh failed; state may be stale.' }]));
      message += ` Refresh failed: ${error.message} Displayed state may be stale; use Refresh, do not repeat an uncertain write.`;
    }
    if (stamp === epoch) notify(message, Boolean(report.error) || refreshFailed);
  } catch (error) {
    if (stamp === epoch) notify(`Planning failed: ${error.message}. Refresh before retrying.`, true);
  } finally {
    if (stamp === epoch) { busy = false; renderFilters(); renderBoard(); startBacklog(); }
    finishLoading();
  }
}

async function mutate(id, patch) {
  const issue = issues.find(item => item.id === id) || feed?.snapshot.sprintAll.find(item => item.id === id);
  if (busy || loading || !api) return;
  if (!Object.keys(patch).length) { renderBoard(); return; }
  cancelQuery(); busy = true; lock();
  const finishLoading = beginLoading();
  const stamp = epoch;
  let writeConfirmed = false;
  try {
    if (sprint?.status !== 'open') throw new Error('Closed sprints are read only.');
    const currentApi = api;
    const fresh = await currentApi.issue(id);
    if (!projectScope(projects, projectId).includes(fresh.project.id)) throw new Error('Issue moved outside the product hierarchy.');
    if (patch.custom_fields) {
      const value = patch.custom_fields[0].value;
      const add = (Array.isArray(value) ? value.map(Number) : [Number(value)]).includes(sprint.id);
      Object.assign(patch, membershipPatch(fresh, config.sprintFieldId, sprint.id, add));
    }
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
    const snapshot = await feed.load(feedScope(), filters, { includeBacklog: false });
    if (!snapshot || stamp !== epoch) return;
    if (!await syncFeed(snapshot)) return;
    if (!writeConfirmed) throw new Error('Redmine did not retain all requested changes. Showing its confirmed values; check field permissions and workflow rules.');
    $('editor').close(); editing = null;
    notify(patch.custom_fields && !sprintValues(confirmed, config.sprintFieldId).includes(sprint.id) && !isBacklog(confirmed, backlogScope())
      ? `Issue #${id} removed from sprint. ${sprintValues(confirmed, config.sprintFieldId).length ? 'It still belongs to other Sprints' : !isSwimlane(confirmed, config.swimlaneTrackers) ? 'It is not Swimlane-capable' : 'Its status is closed'}, so it is no longer shown here.`
      : `Issue #${id} saved in Redmine.`);
  } catch (error) {
    if (stamp === epoch) notify(writeConfirmed ? `Issue #${id} was saved, but reloading the board failed: ${error.message} Use Refresh; do not repeat the write.` : `Save not confirmed: ${error.message} Refresh before retrying if the connection failed.`, true);
  }
  finally { if (stamp === epoch) { busy = false; lock(); renderFilters(); renderBoard(); startBacklog(); } finishLoading(); }
}

async function openEditor(id) {
  if (busy || loading) return;
  loading = true; lock();
  const finishLoading = beginLoading();
  const stamp = epoch;
  try {
    const issue = await api.issue(id);
    if (stamp !== epoch) return;
    editing = issue;
    $('editor-notice').hidden = true;
    $('editor-title').textContent = `Plan #${issue.id}`; $('editor-subject').textContent = issue.subject;
    $('editor-tags').innerHTML = tagsMarkup(issue) || '<span class="muted">No tags</span>';
    const people = new Map(members()); if (issue.assigned_to) people.set(issue.assigned_to.id, issue.assigned_to.name);
    options($('edit-assignee'), [['', 'Unassigned'], ...people], issue.assigned_to?.id || '');
    $('edit-estimate').value = issue.estimated_hours ?? '';
    const allowed = new Map([issue.status, ...(issue.allowed_statuses || [])].map(status => [status.id, status.name]));
    options($('edit-status'), [...allowed], issue.status.id);
    $('edit-destination').value = selectedMember(issue) ? 'sprint' : 'backlog';
    $('issue-link').href = linkToIssue(issue.id);
    $('editor-warning').textContent = sprint?.status !== 'open' ? 'Read only. Select an open sprint to plan issues.' : 'Redmine enforces workflow and field permissions. Removing from a sprint does not reset status or Target version.';
  } catch (error) { if (stamp === epoch) notify(error.message, true); }
  finally {
    finishLoading();
    if (stamp === epoch) {
      loading = false; lock();
      $('edit-form').querySelectorAll('input, select, button[type="submit"]').forEach(el => { el.disabled = sprint?.status !== 'open'; });
      if (editing?.id === id) $('editor').showModal();
    }
  }
}

async function connect(key, remember) {
  if (loading) return;
  loading = true; const stamp = ++epoch;
  const finishLoading = beginLoading();
  $('login-form').querySelector('button').disabled = true;
  api = new RedmineClient(key); feed = new PlanningFeed(api);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Cannot load deployment configuration.');
    const raw = await response.json();
    const [userData, statusData, projectData] = await settledResults([
      api.request('/users/current.json'), api.list('/issue_statuses.json', 'issue_statuses'),
      api.list('/projects.json', 'projects', { include: 'trackers' }),
    ]);
    if (stamp !== epoch) return;
    config = validateConfig(raw, statusData); statuses = statusData; projects = projectData;
    feed = newFeed();
    if (!projects.length) throw new Error('No projects are visible to your account.');
    try {
      if (remember) localStorage.setItem(storageKey, key); else localStorage.removeItem(storageKey);
    } catch { notify('Connected, but browser storage is unavailable. The API key will not be remembered.', true); }
    $('api-key').value = ''; $('login').hidden = true; $('workspace').hidden = false;
    document.body.classList.add('board-active');
    $('refresh').hidden = false; $('refresh-now').hidden = false; $('statusbar').hidden = false;
    renderIdentity(userData.user);
    selectionPreferences = createSelectionPreferences(config.redminePublicUrl, userData.user.id);
    const savedProjectId = selectionPreferences.project();
    projectId = String((projects.find(project => String(project.id) === savedProjectId) || projects[0]).id);
    options($('project'), projects.map(project => [project.id, project.name]), projectId);
    notify('Connected.'); loading = false; await refresh(true);
    if (stamp !== epoch) return;
  } catch (error) {
    if (stamp === epoch) { api?.dispose(); api = null; notify(error.message, true); }
  } finally { if (stamp === epoch) { loading = false; $('login-form').querySelector('button').disabled = false; lock(); } finishLoading(); }
}

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
  selectionPreferences?.selectProject(projectId);
  resetFilters(); renderFilters();
  clearBoardCards(); void refresh(true);
});
$('sprint').addEventListener('change', () => {
  cancelQuery(); feed = newFeed();
  sprint = versions.find(version => version.id === Number($('sprint').value));
  if (sprint) {
    selectionPreferences?.selectProject(projectId);
    selectionPreferences?.selectSprint(projectId, sprint.id);
  }
  issues = []; void refresh(false, true);
});
$('closed').addEventListener('change', () => { cancelQuery(); issues = []; void refresh(false, true); });
$('refresh').addEventListener('click', () => setAutorefresh(!autorefresh));
$('refresh-now').addEventListener('click', () => { notify(''); void refresh(false, true); });
for (const [id, field, eventName] of [['query', 'query', 'input'], ['tracker', 'tracker', 'change'], ['assignee', 'assignee', 'change']]) {
  $(id).addEventListener(eventName, () => { filters[field] = $(id).value; scheduleSearch(field === 'query' ? 300 : 0); });
}
$('backlog-tag').addEventListener('input', () => {
  const tag = $('backlog-tag').value.trim();
  filters.tags = tag ? [tag] : []; scheduleSearch(300);
});
$('clear-filters').addEventListener('click', () => { resetFilters(); scheduleSearch(0); $('query').focus(); });
$('toggle-backlog-filters').addEventListener('click', () => {
  backlogFiltersExpanded = !backlogFiltersExpanded;
  syncBacklogVisibility();
});
$('backlog-closed').addEventListener('change', () => {
  showClosedParents = $('backlog-closed').checked;
  try { localStorage.setItem(closedParentsStorageKey, showClosedParents ? '1' : '0'); } catch { /* Optional preference. */ }
  scheduleSearch(0);
});
$('board').addEventListener('toggle', () => { if (board) alignSwimlanes(board.container); }, { capture: true });
// Shared headers live outside the status scrollports; wheel over their links and
// controls must still scroll the synchronized Sprint rows, not strand the pointer.
$('board').addEventListener('wheel', event => {
  if (!event.target.closest('.swimlane-headers') || !event.deltaY || event.ctrlKey) return;
  const list = $('board').querySelector('.has-swimlanes');
  if (!list) return;
  event.preventDefault();
  list.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1);
}, { passive: false });
$('board').addEventListener('scroll', event => {
  const list = event.target;
  if (!list.classList?.contains('has-swimlanes')) return;
  // Ignore mirrored events so they cannot interrupt the user's native wheel or
  // keyboard scrolling by echoing an earlier position back to the active list.
  if (mirroredStatusScrolls.get(list) === list.scrollTop) return;
  mirroredStatusScrolls.delete(list);
  for (const other of $('board').querySelectorAll('.has-swimlanes')) {
    if (other === list || other.scrollTop === list.scrollTop) continue;
    other.scrollTop = list.scrollTop;
    mirroredStatusScrolls.set(other, other.scrollTop);
  }
  if (board) positionSwimlaneHeaders(board.container);
}, { capture: true, passive: true });
// jKanban cancels every Card click with preventDefault(). Stop link clicks before
// that handler, without cancelling native navigation (new tabs, modifiers, Enter).
$('board').addEventListener('click', event => {
  if (event.target.closest('.card-head a[href], .swimlane-heading a[href]')) event.stopPropagation();
}, { capture: true });
$('board').addEventListener('click', event => {
  if (event.target.closest('[data-backlog-collapse]')) { toggleBacklog(); return; }
  const add = event.target.closest('[data-add-descendants]');
  if (add && !add.disabled) { void addMissingSubtasks(Number(add.dataset.addDescendants)); return; }
  const button = event.target.closest('[data-edit]'); if (button) void openEditor(Number(button.dataset.edit));
});
$('close-editor').addEventListener('click', () => { if (!busy) { $('editor').close(); editing = null; } });
$('editor').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('edit-form').addEventListener('submit', event => {
  event.preventDefault(); if (!editing || busy) return;
  try {
    if (sprint?.status !== 'open') throw new Error('Select an open sprint before editing issues.');
    const patch = { assigned_to_id: $('edit-assignee').value ? Number($('edit-assignee').value) : null, estimated_hours: parseEstimate($('edit-estimate').value), status_id: Number($('edit-status').value), ...membershipPatch(editing, config.sprintFieldId, sprint.id, $('edit-destination').value === 'sprint') };
    void mutate(editing.id, patch);
  } catch (error) { notify(error.message, true); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
try {
  backlogCollapsed = localStorage.getItem(collapsedBacklogStorageKey) === '1';
  showClosedParents = localStorage.getItem(closedParentsStorageKey) === '1';
} catch { /* Default view preferences without local storage. */ }
try {
  const remembered = localStorage.getItem(storageKey);
  if (remembered) { $('forget-saved').hidden = false; $('remember').checked = true; void connect(remembered, true); }
} catch { /* Explicit login still works without local storage. */ }
