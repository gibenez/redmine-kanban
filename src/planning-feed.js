import { sprintValues, hasSprintField } from './domain.js';
import { settledResults } from './settled-results.js';
// Redmine applies server predicates before pagination; tags must be matched locally.
export const matchesTags = (issue, tags = []) => !tags.length || tags.some(tag => (issue.tags || []).includes(tag));
export function issueQuery({ projectId, projectIds = [Number(projectId)], sprintFieldId, sprintId, showClosedParents = false, parentTrackerIds = [] }, filters = {}, backlog = false) {
  const params = {
    project_id: projectId, subproject_id: projectIds.length > 1 ? projectIds.filter(id => id !== Number(projectId)).join('|') : '!*', sort: 'priority:desc,id:asc',
    status_id: backlog && !showClosedParents ? 'open' : '*', [`cf_${sprintFieldId}`]: backlog ? '!*' : sprintId,
  };
  if (!backlog) return params;
  if (filters.tracker) params.tracker_id = filters.tracker;
  else if (backlog) params.tracker_id = parentTrackerIds.join('|');
  if (filters.assignee) params.assigned_to_id = filters.assignee === 'none' ? '!*' : filters.assignee;
  const query = (filters.query || '').trim();
  if (/^#?\d+$/.test(query)) params.issue_id = query.replace(/^#/, '');
  else if (query) params.subject = `~${query}`;
  return params;
}

const empty = () => ({ backlog: [], total: 0, nextOffset: 0, hasMore: false, sprintAll: [], sprintVisible: [] });
const scopeKey = scope => `${scope.projectId}:${scope.sprintId || ''}:${scope.sprintFieldId}`;

export class PlanningFeed {
  constructor(api, pageSize = 5) {
    this.api = api; this.pageSize = pageSize; this.snapshot = empty(); this.revision = 0;
    this.loading = false; this.loadingMore = false;
  }
  cancel() {
    this.cancelBacklog();
    this.revision++; this.controller?.abort(); this.loading = false; this.loadingMore = false; this.nextPromise = null;
  }
  cancelBacklog() {
    this.backlogRevision = (this.backlogRevision || 0) + 1;
    this.backlogController?.abort(); this.loadingMore = false; this.nextPromise = null;
  }
  clearBacklog() {
    this.cancelBacklog(); this.scope = null; this.cursor = null;
    this.snapshot = { ...this.snapshot, backlog: [], total: null, nextOffset: 0, hasMore: false };
  }
  async loadBacklog(scope, filters) {
    this.cancelBacklog();
    const revision = this.backlogRevision;
    const controller = this.backlogController = new AbortController();
    try {
      const page = await this.backlogPage(scope, filters, 0, controller.signal);
      if (revision !== this.backlogRevision) return null;
      this.scope = { ...scope }; this.filters = { ...filters }; this.cursor = page;
      this.snapshot = { ...this.snapshot, backlog: page.items, total: filters.tags?.length && !page.hasMore ? page.items.length : page.total, nextOffset: page.nextOffset, hasMore: page.hasMore };
      return this.snapshot;
    } catch (error) { if (revision !== this.backlogRevision) return null; throw error; }
  }
  async backlogPage(scope, filters, offset, signal, cursor = {}) {
    const items = [], pending = [...(cursor.pending || [])];
    let rawHasMore = cursor.rawHasMore ?? true, total = cursor.rawTotal ?? null;
    const trackerIds = scope.parentTrackerIds || [];
    if (!trackerIds.length || (filters.tracker && !trackerIds.includes(Number(filters.tracker)))) {
      return { items: [], nextOffset: 0, pending: [], rawHasMore: false, rawTotal: 0, total: 0, hasMore: false };
    }
    if (!rawHasMore && total == null) total = 0;
    while (items.length < this.pageSize && (pending.length || rawHasMore)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!pending.length) {
        const page = await this.api.page('/issues.json', 'issues', { ...issueQuery(scope, filters, true), limit: this.pageSize - items.length, offset }, { signal });
        if (page.hasMore && page.nextOffset <= offset) throw new Error('Redmine did not advance the backlog cursor.');
        offset = page.nextOffset; rawHasMore = page.hasMore; total = filters.tags?.length ? null : page.total;
        const cards = page.items.filter(issue => hasSprintField(issue, scope.sprintFieldId));
        if (cards.some(issue => sprintValues(issue, scope.sprintFieldId).length)) throw new Error('Redmine did not apply the Sprint field filter. Enable “Used as a filter” on the Version custom field.');
        pending.push(...cards.filter(issue => trackerIds.includes(issue.tracker?.id) && matchesTags(issue, filters.tags)));
      }
      items.push(...pending.splice(0, this.pageSize - items.length));
    }
    return { items, nextOffset: offset, pending, rawHasMore, rawTotal: total, total, hasMore: pending.length > 0 || rawHasMore };
  }
  async load(scope, filters, { refreshSprint = true, includeBacklog = true } = {}) {
    this.cancel();
    const revision = this.revision;
    const controller = this.controller = new AbortController();
    this.loading = true;
    const key = scopeKey(scope), selectedFilters = { ...filters };
    try {
      const unfilteredSprint = !scope.sprintId ? Promise.resolve([])
        : !refreshSprint && this.key === key ? Promise.resolve(this.snapshot.sprintAll)
          : this.api.list('/issues.json', 'issues', issueQuery(scope), { signal: controller.signal });
      const [backlog, rawSprintAll] = await settledResults([
        includeBacklog ? this.backlogPage(scope, selectedFilters, 0, controller.signal) : Promise.resolve({ items: [], total: null, nextOffset: 0, hasMore: false }),
        unfilteredSprint,
      ]);
      const validateMembers = items => items.filter(issue => {
        if (!hasSprintField(issue, scope.sprintFieldId)) return false;
        if (!sprintValues(issue, scope.sprintFieldId).includes(scope.sprintId)) throw new Error('Redmine did not apply the Sprint field filter. Check field visibility and “Used as a filter”.');
        return true;
      });
      // Backlog predicates never narrow Sprint membership or trigger a Sprint search.
      const sprintAll = !refreshSprint && this.key === key ? rawSprintAll : validateMembers(rawSprintAll);
      const sprintVisible = sprintAll;
      if (revision !== this.revision) return null;
      this.key = key; this.scope = includeBacklog ? { ...scope } : null; this.filters = selectedFilters; this.cursor = backlog;
      this.snapshot = { backlog: backlog.items, total: selectedFilters.tags?.length && !backlog.hasMore ? backlog.items.length : backlog.total, nextOffset: backlog.nextOffset, hasMore: backlog.hasMore, sprintAll, sprintVisible };
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
    const backlogRevision = this.backlogRevision;
    if (!this.backlogController || this.backlogController.signal.aborted) this.backlogController = new AbortController();
    const signal = this.backlogController.signal;
    this.loadingMore = true;
    this.nextPromise = (async () => {
      try {
        const page = await this.backlogPage(this.scope, this.filters, this.snapshot.nextOffset, signal, this.cursor);
        if (revision !== this.revision || backlogRevision !== this.backlogRevision) return null;
        this.cursor = page;
        this.snapshot = {
          ...this.snapshot,
          backlog: [...new Map([...this.snapshot.backlog, ...page.items].map(issue => [issue.id, issue])).values()],
          total: this.filters.tags?.length && !page.hasMore ? this.snapshot.backlog.length + page.items.length : page.total, nextOffset: page.nextOffset, hasMore: page.hasMore,
        };
        return this.snapshot;
      } catch (error) { if (revision === this.revision && backlogRevision === this.backlogRevision) throw error; return null; }
      finally { if (revision === this.revision && backlogRevision === this.backlogRevision) { this.loadingMore = false; this.nextPromise = null; } }
    })();
    return this.nextPromise;
  }
}
