import { PlanningFeed, issueQuery, matchesTags, sprintFiltered } from './planning-feed.js';
import { relatedId } from './build-sprints.js';

export function buildIssueQuery(scope, filters = {}, backlog = false) {
  const params = issueQuery(scope, filters, backlog);
  delete params.fixed_version_id;
  if (backlog && scope.categoryOnly) params.category_id = scope.categoryId === 'none' ? '!*' : scope.categoryId;
  return params;
}
const indexKey = scope => JSON.stringify([scope.projectId, scope.buildTrackerId, scope.sprintId, scope.builds.map(b => [b.id, b.status])]);
const check = signal => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };

export class BuildPlanningFeed extends PlanningFeed {
  async membership(scope, signal) {
    const open = new Map(), selected = new Set();
    const builds = scope.builds.filter(build => build.status === 'open' || build.id === scope.sprintId);
    // Limit fanout: projects can have many Builds, and all open ones matter to Backlog.
    for (let offset = 0; offset < builds.length; offset += 4) {
      check(signal);
      const batch = builds.slice(offset, offset + 4);
      const rows = await Promise.all(batch.map(build => this.api.relations(build.id, { signal })));
      batch.forEach((build, i) => rows[i].forEach(relation => {
        const id = relatedId(relation, build.id);
        if (id == null) return;
        if (build.id === scope.sprintId) selected.add(id);
        if (build.status === 'open') open.set(id, [...(open.get(id) || []), build.id]);
      }));
    }
    return { open, selected };
  }
  annotate(issue, index) { return { ...issue, openBuildIds: index.open.get(issue.id) || [], sprintMember: index.selected.has(issue.id) }; }
  async sprintIssues(scope, filters, index, signal) {
    const ids = [...index.selected];
    const result = [];
    const query = buildIssueQuery(scope, filters);
    for (let offset = 0; offset < ids.length; offset += 100) {
      check(signal);
      const batch = ids.slice(offset, offset + 100);
      if (query.issue_id && !batch.includes(Number(query.issue_id))) continue;
      const rows = await this.api.list('/issues.json', 'issues', { ...query, issue_id: query.issue_id || batch.join(',') }, { signal });
      result.push(...rows.filter(issue => batch.includes(issue.id) && issue.project.id === Number(scope.projectId) && issue.tracker.id !== scope.buildTrackerId).map(issue => this.annotate(issue, index)));
    }
    // IDs are not priority ranks. Redmine's enumeration is ordered by position.
    if (ids.length > 100) {
      const priorities = await this.api.list('/enumerations/issue_priorities.json', 'issue_priorities', {}, { signal });
      const ranks = new Map(priorities.map((priority, rank) => [priority.id, rank]));
      result.sort((a, b) => (ranks.get(b.priority?.id) ?? -1) - (ranks.get(a.priority?.id) ?? -1) || a.id - b.id);
    }
    return result;
  }
  async backlogPage(scope, filters, index, cursor, signal) {
    let { nextOffset, rawHasMore } = cursor;
    const pending = [...cursor.pending], items = [];
    while (items.length < this.pageSize && (pending.length || rawHasMore)) {
      check(signal);
      if (!pending.length) {
        const page = await this.api.page('/issues.json', 'issues', { ...buildIssueQuery(scope, filters, true), limit: 100, offset: nextOffset }, { signal });
        if (page.hasMore && page.nextOffset <= nextOffset) throw new Error('Redmine did not advance the backlog cursor.');
        nextOffset = page.nextOffset; rawHasMore = page.hasMore;
        pending.push(...page.items.filter(issue => issue.project.id === Number(scope.projectId) && issue.tracker.id !== scope.buildTrackerId && !index.open.has(issue.id) && matchesTags(issue, filters.tags)));
      }
      items.push(...pending.splice(0, this.pageSize - items.length).map(issue => this.annotate(issue, index)));
    }
    return { items, nextOffset, rawHasMore, pending, hasMore: pending.length > 0 || rawHasMore };
  }
  async load(scope, filters, { refreshSprint = true } = {}) {
    this.cancel();
    const revision = this.revision, controller = this.controller = new AbortController(), signal = controller.signal;
    const key = indexKey(scope), selectedFilters = { ...filters };
    this.loading = true;
    try {
      const reuse = !refreshSprint && this.key === key;
      const index = reuse ? this.index : await this.membership(scope, signal);
      const unfiltered = reuse ? Promise.resolve(this.snapshot.sprintAll) : this.sprintIssues(scope, {}, index, signal);
      const filtered = sprintFiltered(filters);
      const [page, sprintAll, sprintVisible] = await Promise.all([
        this.backlogPage(scope, selectedFilters, index, { nextOffset: 0, rawHasMore: true, pending: [] }, signal),
        unfiltered, filtered ? this.sprintIssues(scope, selectedFilters, index, signal) : unfiltered,
      ]);
      if (revision !== this.revision) return null;
      this.key = key; this.index = index; this.scope = { ...scope }; this.filters = selectedFilters; this.cursor = page;
      this.snapshot = { backlog: page.items, total: page.hasMore ? null : page.items.length, nextOffset: page.nextOffset, hasMore: page.hasMore, sprintAll, sprintVisible };
      return this.snapshot;
    } catch (error) { if (revision !== this.revision) return null; controller.abort(); throw error; }
    finally { if (revision === this.revision) this.loading = false; }
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
        const page = await this.backlogPage(this.scope, this.filters, this.index, this.cursor, signal);
        if (revision !== this.revision) return null;
        const backlog = [...new Map([...this.snapshot.backlog, ...page.items].map(issue => [issue.id, issue])).values()];
        this.cursor = page;
        this.snapshot = { ...this.snapshot, backlog, total: page.hasMore ? null : backlog.length, nextOffset: page.nextOffset, hasMore: page.hasMore };
        return this.snapshot;
      } catch (error) { if (revision === this.revision) throw error; return null; }
      finally { if (revision === this.revision) { this.loadingMore = false; this.nextPromise = null; } }
    })();
    return this.nextPromise;
  }
}
