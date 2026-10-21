// Redmine applies all search/filter predicates BEFORE pagination.
export function issueQuery({ projectId, sprintId, backlogStatusId, allUnplanned = false }, filters = {}, backlog = false) {
  const backlogStatus = allUnplanned ? 'open' : backlogStatusId;
  const params = {
    project_id: projectId, subproject_id: '!*', sort: 'priority:desc,id:asc',
    status_id: backlog ? backlogStatus : '*', fixed_version_id: backlog ? '!*' : sprintId,
  };
  if (filters.tracker) params.tracker_id = filters.tracker;
  if (filters.assignee) params.assigned_to_id = filters.assignee === 'none' ? '!*' : filters.assignee;
  const query = (filters.query || '').trim();
  if (/^#?\d+$/.test(query)) params.issue_id = query.replace(/^#/, '');
  else if (query) params.subject = `~${query}`;
  return params;
}

const empty = () => ({ backlog: [], total: 0, nextOffset: 0, hasMore: false, sprintAll: [], sprintVisible: [] });
const scopeKey = scope => `${scope.projectId}:${scope.sprintId || ''}:${scope.backlogStatusId}`;

export class PlanningFeed {
  constructor(api, pageSize = 5) {
    this.api = api; this.pageSize = pageSize; this.snapshot = empty(); this.revision = 0;
    this.loading = false; this.loadingMore = false;
  }
  cancel() {
    this.revision++; this.controller?.abort(); this.loading = false; this.loadingMore = false; this.nextPromise = null;
  }
  async load(scope, filters, { refreshSprint = true } = {}) {
    this.cancel();
    const revision = this.revision;
    const controller = this.controller = new AbortController();
    this.loading = true;
    const key = scopeKey(scope), selectedFilters = { ...filters };
    const filtered = Object.values(selectedFilters).some(value => String(value).trim());
    try {
      const unfilteredSprint = !scope.sprintId ? Promise.resolve([])
        : !refreshSprint && this.key === key ? Promise.resolve(this.snapshot.sprintAll)
          : this.api.list('/issues.json', 'issues', issueQuery(scope), { signal: controller.signal });
      const [backlog, sprintAll, sprintVisible] = await Promise.all([
        this.api.page('/issues.json', 'issues', { ...issueQuery(scope, selectedFilters, true), limit: this.pageSize, offset: 0 }, { signal: controller.signal }),
        unfilteredSprint,
        scope.sprintId && filtered ? this.api.list('/issues.json', 'issues', issueQuery(scope, selectedFilters), { signal: controller.signal }) : unfilteredSprint,
      ]);
      if (revision !== this.revision) return null;
      this.key = key; this.scope = { ...scope }; this.filters = selectedFilters;
      this.snapshot = { backlog: backlog.items, total: backlog.total, nextOffset: backlog.nextOffset, hasMore: backlog.hasMore, sprintAll, sprintVisible };
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
        const page = await this.api.page('/issues.json', 'issues', { ...issueQuery(this.scope, this.filters, true), limit: this.pageSize, offset: this.snapshot.nextOffset }, { signal });
        if (revision !== this.revision) return null;
        this.snapshot = {
          ...this.snapshot,
          backlog: [...new Map([...this.snapshot.backlog, ...page.items].map(issue => [issue.id, issue])).values()],
          total: page.total, nextOffset: page.nextOffset, hasMore: page.hasMore,
        };
        return this.snapshot;
      } catch (error) { if (revision === this.revision) throw error; return null; }
      finally { if (revision === this.revision) { this.loadingMore = false; this.nextPromise = null; } }
    })();
    return this.nextPromise;
  }
}
