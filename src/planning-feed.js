import { sprintValues, hasSprintField } from './domain.js';
// Redmine applies server predicates before pagination; tags must be matched locally.
export const matchesTags = (issue, tags = []) => !tags.length || tags.some(tag => (issue.tags || []).includes(tag));
export const sprintFiltered = filters => ['query', 'tracker', 'assignee'].some(key => String(filters[key] || '').trim());
export function issueQuery({ projectId, projectIds = [Number(projectId)], sprintFieldId, sprintId, backlogStatusId, allUnplanned = false, parentTrackerIds = [] }, filters = {}, backlog = false) {
  const backlogStatus = allUnplanned ? 'open' : backlogStatusId;
  const params = {
    project_id: projectId, subproject_id: projectIds.length > 1 ? projectIds.filter(id => id !== Number(projectId)).join('|') : '!*', sort: 'priority:desc,id:asc',
    status_id: backlog ? backlogStatus : '*', [`cf_${sprintFieldId}`]: backlog ? '!*' : sprintId,
  };
  if (filters.tracker) params.tracker_id = filters.tracker;
  if (filters.assignee) params.assigned_to_id = filters.assignee === 'none' ? '!*' : filters.assignee;
  const query = (filters.query || '').trim();
  if (/^#?\d+$/.test(query)) params.issue_id = query.replace(/^#/, '');
  else if (query) params.subject = `~${query}`;
  return params;
}

const empty = () => ({ backlog: [], total: 0, nextOffset: 0, hasMore: false, sprintAll: [], sprintVisible: [] });
const scopeKey = scope => `${scope.projectId}:${scope.sprintId || ''}:${scope.backlogStatusId}:${scope.sprintFieldId}`;

export class PlanningFeed {
  constructor(api, pageSize = 5) {
    this.api = api; this.pageSize = pageSize; this.snapshot = empty(); this.revision = 0;
    this.loading = false; this.loadingMore = false;
  }
  cancel() {
    this.revision++; this.controller?.abort(); this.loading = false; this.loadingMore = false; this.nextPromise = null;
  }
  async backlogPage(scope, filters, offset, signal, cursor = {}) {
    const items = [], pending = [...(cursor.pending || [])];
    let rawHasMore = cursor.rawHasMore ?? true, total = cursor.total ?? null;
    while (items.length < this.pageSize && (pending.length || rawHasMore)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!pending.length) {
        const page = await this.api.page('/issues.json', 'issues', { ...issueQuery(scope, filters, true), limit: filters.tags?.length ? 100 : this.pageSize, offset }, { signal });
        if (page.hasMore && page.nextOffset <= offset) throw new Error('Redmine did not advance the backlog cursor.');
        offset = page.nextOffset; rawHasMore = page.hasMore; total = filters.tags?.length ? null : page.total;
        const cards = page.items.filter(issue => hasSprintField(issue, scope.sprintFieldId) && !scope.swimlaneTrackers?.includes(issue.tracker?.name));
        if (cards.some(issue => sprintValues(issue, scope.sprintFieldId).length)) throw new Error('Redmine did not apply the Sprint field filter. Enable “Used as a filter” on the Version custom field.');
        pending.push(...cards.filter(issue => matchesTags(issue, filters.tags)));
      }
      items.push(...pending.splice(0, this.pageSize - items.length));
    }
    return { items, nextOffset: offset, pending, rawHasMore, total, hasMore: pending.length > 0 || rawHasMore };
  }
  async load(scope, filters, { refreshSprint = true } = {}) {
    this.cancel();
    const revision = this.revision;
    const controller = this.controller = new AbortController();
    this.loading = true;
    const key = scopeKey(scope), selectedFilters = { ...filters };
    const filtered = sprintFiltered(selectedFilters);
    try {
      const unfilteredSprint = !scope.sprintId ? Promise.resolve([])
        : !refreshSprint && this.key === key ? Promise.resolve(this.snapshot.sprintAll)
          : this.api.list('/issues.json', 'issues', issueQuery(scope), { signal: controller.signal });
      const parentQuery = issueQuery(scope, selectedFilters);
      delete parentQuery[`cf_${scope.sprintFieldId}`];
      delete parentQuery.tracker_id;
      parentQuery.tracker_id = scope.parentTrackerIds?.join('|');
      parentQuery.status_id = scope.showClosedParents ? '*' : 'open';
      const [backlog, rawSprintAll, rawSprintVisible, parents] = await Promise.all([
        this.backlogPage(scope, selectedFilters, 0, controller.signal),
        unfilteredSprint,
        scope.sprintId && filtered ? this.api.list('/issues.json', 'issues', issueQuery(scope, selectedFilters), { signal: controller.signal }) : unfilteredSprint,
        scope.parentTrackerIds?.length ? this.api.list('/issues.json', 'issues', parentQuery, { signal: controller.signal }) : [],
      ]);
      const validateMembers = items => items.filter(issue => {
        if (!hasSprintField(issue, scope.sprintFieldId)) return false;
        if (!sprintValues(issue, scope.sprintFieldId).includes(scope.sprintId)) throw new Error('Redmine did not apply the Sprint field filter. Check field visibility and “Used as a filter”.');
        return true;
      });
      const sprintAll = validateMembers(rawSprintAll), sprintVisible = validateMembers(rawSprintVisible);
      if (revision !== this.revision) return null;
      this.key = key; this.scope = { ...scope }; this.filters = selectedFilters; this.cursor = backlog;
      this.snapshot = { backlog: backlog.items, parents: parents.filter(issue => hasSprintField(issue, scope.sprintFieldId) && (!selectedFilters.tracker || issue.tracker?.id === Number(selectedFilters.tracker)) && matchesTags(issue, selectedFilters.tags)), total: selectedFilters.tags?.length && !backlog.hasMore ? backlog.items.length : backlog.total, nextOffset: backlog.nextOffset, hasMore: backlog.hasMore, sprintAll, sprintVisible };
      return this.snapshot;
    } catch (error) {
      if (revision !== this.revision) return null;
      controller.abort(); throw error;
    } finally { if (revision === this.revision) this.loading = false; }
  }
  next() {
    if (this.nextPromise) return this.nextPromise;
    if (this.loading || !this.scope || !this.snapshot.hasMore) return Promise.resolve(null);
    const revision = this.revision;
    if (this.controller.signal.aborted) this.controller = new AbortController();
    const signal = this.controller.signal;
    this.loadingMore = true;
    this.nextPromise = (async () => {
      try {
        const page = await this.backlogPage(this.scope, this.filters, this.snapshot.nextOffset, signal, this.cursor);
        if (revision !== this.revision) return null;
        this.cursor = page;
        this.snapshot = {
          ...this.snapshot,
          backlog: [...new Map([...this.snapshot.backlog, ...page.items].map(issue => [issue.id, issue])).values()],
          total: this.filters.tags?.length && !page.hasMore ? this.snapshot.backlog.length + page.items.length : page.total, nextOffset: page.nextOffset, hasMore: page.hasMore,
        };
        return this.snapshot;
      } catch (error) { if (revision === this.revision) throw error; return null; }
      finally { if (revision === this.revision) { this.loadingMore = false; this.nextPromise = null; } }
    })();
    return this.nextPromise;
  }
}
