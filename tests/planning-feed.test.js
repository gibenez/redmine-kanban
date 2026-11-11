import { describe, it, expect, vi } from 'vitest';
import { PlanningFeed, issueQuery } from '../src/planning-feed.js';

const scope = { projectId: '2', sprintId: 10, sprintFieldId: 7, parentTrackerIds: [3] };
const filters = { query: '', tracker: '', assignee: '' };
const row = (id, value = '') => ({ id, tracker: { id: 3, name: 'Feature' }, custom_fields: [{ id: 7, value }] });
const page = (ids, total = ids.length, offset = 0) => ({ items: ids.map(id => row(id)), total, nextOffset: offset + ids.length, hasMore: offset + ids.length < total });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('server-side issue queries', () => {
  it('applies project, backlog, search and filters before stable server sorting/pagination', () => {
    expect(issueQuery(scope, { query: 'Needs review', tracker: '3', assignee: 'none' }, true)).toEqual({ project_id: '2', subproject_id: '!*', sort: 'priority:desc,id:asc', status_id: 'open', cf_7: '!*', subject: '~Needs review', tracker_id: '3', assigned_to_id: '!*' });
    expect(issueQuery(scope, { query: ' #123 ', assignee: '7' })).toMatchObject({ issue_id: '123', assigned_to_id: '7', cf_7: 10, status_id: '*' });
    expect(issueQuery({ ...scope, projectIds: [2, 3, 4] })).toMatchObject({ subproject_id: '3|4' });
    expect(issueQuery(scope, { query: '123' })).not.toHaveProperty('subject');
  });
  it('queries only unplanned Swimlane-capable issues, optionally including closed ones', () => {
    expect(issueQuery({ ...scope, parentTrackerIds: [3, 4] }, {}, true)).toMatchObject({ status_id: 'open', cf_7: '!*', tracker_id: '3|4' });
    expect(issueQuery({ ...scope, showClosedParents: true }, {}, true)).toMatchObject({ status_id: '*', cf_7: '!*' });
    expect(issueQuery(scope, {})).toMatchObject({ status_id: '*', cf_7: 10 });
    expect(issueQuery({ ...scope, sprintId: undefined }, {}, true)).toHaveProperty('cf_7', '!*');
  });
});

describe('bounded backlog feed', () => {
  it('does not eagerly list Swimlane-capable Backlog issues on startup', async () => {
    const parents = Array.from({ length: 1400 }, (_, index) => ({ ...row(index + 1), tracker: { id: 3, name: 'Feature' } }));
    const api = {
      page: vi.fn(async (_path, _collection, params) => ({ items: parents.slice(params.offset, params.offset + 5), total: parents.length, nextOffset: params.offset + 5, hasMore: params.offset + 5 < parents.length })),
      list: vi.fn(async (_path, _collection, params) => params.tracker_id ? parents : []),
    };
    const feed = new PlanningFeed(api, 5);
    await feed.load({ ...scope, parentTrackerIds: [3], swimlaneTrackers: ['Feature'] }, filters);
    expect(feed.snapshot.backlog.length + (feed.snapshot.parents?.length || 0)).toBeLessThanOrEqual(5);
    expect(api.list.mock.calls.filter(([, , params]) => params.tracker_id)).toHaveLength(0);
    expect(api.page).toHaveBeenCalledTimes(1);
  });
  it('paginates only Swimlane-capable issues without requesting ordinary issues', async () => {
    const parents = [1, 2, 3].map(id => row(id));
    const api = {
      page: vi.fn(async (_path, _collection, params) => {
        const rows = params.tracker_id === '3' ? parents : [row(4), row(5)];
        return { items: rows.slice(params.offset, params.offset + params.limit), total: rows.length, nextOffset: Math.min(rows.length, params.offset + params.limit), hasMore: params.offset + params.limit < rows.length };
      }), list: vi.fn().mockResolvedValue([]),
    };
    const feed = new PlanningFeed(api, 2);
    await feed.load({ ...scope, parentTrackerIds: [3] }, filters);
    expect(feed.snapshot.backlog.map(issue => issue.id)).toEqual([1, 2]);
    await feed.next();
    expect(feed.snapshot.backlog.map(issue => issue.id)).toEqual([1, 2, 3]);
    expect(feed.snapshot.total).toBe(3);
    await feed.next();
    expect(feed.snapshot.backlog.map(issue => issue.id)).toEqual([1, 2, 3]);
    expect(feed.snapshot.total).toBe(3);
    expect(feed.snapshot.hasMore).toBe(false);
    expect(api.page).toHaveBeenCalledTimes(2);
    for (const [, , params] of api.page.mock.calls) expect(params).toMatchObject({ tracker_id: '3', cf_7: '!*' });
  });
  it('returns an empty Backlog for disabled or nonmatching Swimlane trackers', async () => {
    const api = { page: vi.fn(), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api);
    await feed.load({ ...scope, parentTrackerIds: [] }, filters);
    expect(feed.snapshot).toMatchObject({ backlog: [], total: 0, hasMore: false });
    await feed.load(scope, { ...filters, tracker: '8' });
    expect(feed.snapshot).toMatchObject({ backlog: [], total: 0, hasMore: false });
    expect(api.page).not.toHaveBeenCalled();
  });
  it('excludes ordinary issues even if Redmine returns them', async () => {
    const api = { page: vi.fn().mockResolvedValue({ ...page([1, 2]), items: [row(1), { ...row(2), tracker: { id: 8, name: 'Task' } }] }), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api);
    await feed.load(scope, filters);
    expect(feed.snapshot.backlog.map(issue => issue.id)).toEqual([1]);
  });
  it.each(['10', '20', ['10', '20']])('rejects nonempty Sprint membership %j in Backlog results', async value => {
    const api = { page: vi.fn().mockResolvedValue({ ...page([1]), items: [row(1, value)] }), list: vi.fn().mockResolvedValue([]) };
    await expect(new PlanningFeed(api).load(scope, filters)).rejects.toThrow('Sprint field filter');
  });
  it('rejects silently ignored custom-field filters instead of showing incorrect membership', async () => {
    const api = { page: vi.fn().mockResolvedValue({ ...page([1]), items: [row(1, '10')] }), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api);
    await expect(feed.load(scope, filters)).rejects.toThrow('Used as a filter');
    api.page.mockResolvedValue(page([1])); api.list.mockResolvedValue([row(20, '99')]);
    await expect(feed.load(scope, filters)).rejects.toThrow('Sprint field filter');
    api.list.mockResolvedValue([{ id: 20 }]);
    await feed.load(scope, filters);
    expect(feed.snapshot.sprintAll).toEqual([]);
  });
  it('skips missing-field issues and continues paging to fill the Backlog', async () => {
    const api = {
      page: vi.fn().mockResolvedValueOnce({ items: [{ id: 9262 }], total: 2, nextOffset: 1, hasMore: true }).mockResolvedValueOnce({ items: [row(2)], total: 2, nextOffset: 2, hasMore: false }),
      list: vi.fn().mockResolvedValue([{ id: 9262 }, row(20, '10')]),
    };
    const feed = new PlanningFeed(api);
    await feed.load(scope, filters);
    expect(feed.snapshot.backlog.map(issue => issue.id)).toEqual([2]);
    expect(feed.snapshot.sprintAll.map(issue => issue.id)).toEqual([20]);
    expect(api.page).toHaveBeenCalledTimes(2);
  });
  it('loads just five initially, and fetches the next cursor only when requested', async () => {
    const api = { page: vi.fn().mockResolvedValueOnce(page([1, 2, 3, 4, 5], 8)).mockResolvedValueOnce(page([6, 7, 8], 8, 5)), list: vi.fn().mockResolvedValue([row(20, '10')]) };
    const feed = new PlanningFeed(api);
    await feed.load(scope, filters);
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(api.page.mock.calls[0][2]).toMatchObject({ limit: 5, offset: 0 });
    await feed.next();
    expect(api.page.mock.calls[1][2]).toMatchObject({ limit: 5, offset: 5 });
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await feed.next(); expect(api.page).toHaveBeenCalledTimes(2);
  });
  it('reuses whole-sprint totals while querying filtered sprint/backlog results from the server', async () => {
    const api = { page: vi.fn().mockResolvedValue(page([1])), list: vi.fn().mockResolvedValueOnce([row(20, '10'), row(21, '10')]).mockResolvedValueOnce([row(21, '10')]) };
    const feed = new PlanningFeed(api);
    await feed.load(scope, filters);
    await feed.load(scope, { ...filters, query: 'unloaded subject' }, { refreshSprint: false });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list.mock.calls[1][2]).toHaveProperty('subject', '~unloaded subject');
    expect(feed.snapshot.sprintAll).toHaveLength(2); expect(feed.snapshot.sprintVisible).toHaveLength(1);
    expect(api.page.mock.calls[1][2]).toMatchObject({ subject: '~unloaded subject', offset: 0, limit: 5 });
  });
  it('discards a superseded search even when the server ignores cancellation', async () => {
    const slow = deferred();
    const api = { page: vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([9])), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api);
    const old = feed.load(scope, { ...filters, query: 'old' });
    await feed.load(scope, { ...filters, query: 'new' });
    expect(api.page.mock.calls[0][3].signal.aborted).toBe(true);
    slow.resolve(page([1])); expect(await old).toBeNull();
    expect(feed.snapshot.backlog).toEqual([row(9)]);
  });
  it('deduplicates overlapping scroll events and overlapping issue IDs', async () => {
    const slow = deferred();
    const api = { page: vi.fn().mockResolvedValueOnce(page([1, 2, 3, 4, 5], 8)).mockReturnValueOnce(slow.promise), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api); await feed.load(scope, filters);
    const a = feed.next(), b = feed.next(); expect(a).toBe(b);
    slow.resolve(page([5, 6, 7], 8, 5)); await a;
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(api.page).toHaveBeenCalledTimes(2);
  });
  it('keeps the failed cursor retryable and never advances it on an error', async () => {
    const api = { page: vi.fn().mockResolvedValueOnce(page([1, 2, 3, 4, 5], 6)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([6], 6, 5)), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api); await feed.load(scope, filters);
    await expect(feed.next()).rejects.toThrow('offline');
    expect(feed.snapshot.nextOffset).toBe(5); expect(feed.loadingMore).toBe(false);
    await feed.next(); expect(api.page.mock.calls[2][2].offset).toBe(5);
  });
  it('discards a late next page after the project changes', async () => {
    const slow = deferred();
    const api = { page: vi.fn().mockResolvedValueOnce(page([1, 2, 3, 4, 5], 8)).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([99])), list: vi.fn().mockResolvedValue([]) };
    const feed = new PlanningFeed(api); await feed.load(scope, filters);
    const oldPage = feed.next(); await feed.load({ ...scope, projectId: '3' }, filters);
    slow.resolve(page([6, 7, 8], 8, 5)); expect(await oldPage).toBeNull();
    expect(feed.snapshot.backlog).toEqual([row(99)]);
  });
});
