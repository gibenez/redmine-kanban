import { describe, it, expect, vi } from 'vitest';
import { PlanningFeed, issueQuery } from '../src/planning-feed.js';

const scope = { projectId: '2', sprintId: 10, backlogStatusId: 1 };
const filters = { query: '', tracker: '', assignee: '' };
const page = (ids, total = ids.length, offset = 0) => ({ items: ids.map(id => ({ id })), total, nextOffset: offset + ids.length, hasMore: offset + ids.length < total });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('server-side issue queries', () => {
  it('applies project, backlog, search and filters before stable server sorting/pagination', () => {
    expect(issueQuery(scope, { query: 'Needs review', tracker: '3', assignee: 'none' }, true)).toEqual({ project_id: '2', subproject_id: '!*', sort: 'priority:desc,id:asc', status_id: 1, fixed_version_id: '!*', subject: '~Needs review', tracker_id: '3', assigned_to_id: '!*' });
    expect(issueQuery(scope, { query: ' #123 ', assignee: '7' })).toMatchObject({ issue_id: '123', assigned_to_id: '7', fixed_version_id: 10, status_id: '*' });
    expect(issueQuery(scope, { query: '123' })).not.toHaveProperty('subject');
  });
  it('widens the backlog query to every open status when the backlog scope is widened', () => {
    const wide = { ...scope, allUnplanned: true };
    expect(issueQuery(wide, {}, true)).toMatchObject({ status_id: 'open', fixed_version_id: '!*' });
    // Only the backlog column is scoped; sprint columns already show every status.
    expect(issueQuery(wide, {})).toMatchObject({ status_id: '*', fixed_version_id: 10 });
  });
});

describe('bounded backlog feed', () => {
  it('loads just five initially, and fetches the next cursor only when requested', async () => {
    const api = { page: vi.fn().mockResolvedValueOnce(page([1, 2, 3, 4, 5], 8)).mockResolvedValueOnce(page([6, 7, 8], 8, 5)), list: vi.fn().mockResolvedValue([{ id: 20 }]) };
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
    const api = { page: vi.fn().mockResolvedValue(page([1])), list: vi.fn().mockResolvedValueOnce([{ id: 20 }, { id: 21 }]).mockResolvedValueOnce([{ id: 21 }]) };
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
    expect(feed.snapshot.backlog).toEqual([{ id: 9 }]);
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
    expect(feed.snapshot.backlog).toEqual([{ id: 99 }]);
  });
});
