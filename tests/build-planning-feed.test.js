import { describe, it, expect, vi } from 'vitest';
import { BuildPlanningFeed, buildIssueQuery } from '../src/build-planning-feed.js';

const filters = { query: '', tracker: '', assignee: '' };
const scope = { projectId: '1', sprintId: 100, backlogStatusId: 1, buildTrackerId: 9, categoryId: '4', categoryOnly: true, builds: [{ id: 100, status: 'open' }, { id: 101, status: 'open' }, { id: 99, status: 'closed' }] };
const issue = (id, extra = {}) => ({ id, project: { id: 1 }, tracker: { id: 1 }, status: { id: 1 }, category: { id: 4 }, priority: { id: 2 }, ...extra });
const rel = (build, id, type = 'relates') => ({ id: build + id, issue_id: build, issue_to_id: id, relation_type: type });
function client() {
  const api = {
    relations: vi.fn(async id => id === 100 ? [rel(100, 1), rel(100, 9, 'blocks'), rel(100, 7)] : id === 101 ? [rel(101, 2)] : [rel(99, 3)]),
    list: vi.fn(async () => [issue(1), issue(7, { category: { id: 5 } }), issue(20, { project: { id: 2 } })]),
    page: vi.fn(async () => ({ items: [issue(1), issue(2), issue(3, { fixed_version: { id: 33 } }), issue(4, { tracker: { id: 9 } }), issue(5), issue(9)], nextOffset: 6, hasMore: false })),
  };
  return api;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

describe('Build planning feed', () => {
  it('never queries target versions and scopes only backlog by category', () => {
    expect(buildIssueQuery(scope, filters, true)).toMatchObject({ category_id: '4', status_id: 1 });
    expect(buildIssueQuery(scope, filters, true)).not.toHaveProperty('fixed_version_id');
    expect(buildIssueQuery(scope, filters)).not.toHaveProperty('category_id');
    expect(buildIssueQuery({ ...scope, categoryId: 'none' }, filters, true).category_id).toBe('!*');
    expect(buildIssueQuery({ ...scope, categoryOnly: false }, filters, true)).not.toHaveProperty('category_id');
  });
  it('indexes every open Build, not just the selected category; ignores closed historical membership', async () => {
    const api = client(), feed = new BuildPlanningFeed(api, 2);
    await feed.load(scope, filters);
    expect(api.relations.mock.calls.map(([id]) => id)).toEqual([100, 101]);
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([3, 5]);
    expect(feed.snapshot.total).toBeNull(); expect(feed.snapshot.hasMore).toBe(true);
    await feed.next();
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([3, 5, 9]);
    expect(feed.snapshot.total).toBe(3); expect(api.page).toHaveBeenCalledTimes(1);
    expect(feed.snapshot.sprintAll.map(i => i.id)).toEqual([1, 7]);
    expect(feed.snapshot.sprintAll[1].category.id).toBe(5);
    expect(api.list.mock.calls[0][2]).toMatchObject({ issue_id: '1,7', project_id: '1', status_id: '*' });
  });
  it('loads a selected closed sprint without letting it block backlog', async () => {
    const api = client(), feed = new BuildPlanningFeed(api);
    api.list.mockResolvedValue([issue(3)]);
    await feed.load({ ...scope, sprintId: 99 }, filters);
    expect(api.relations.mock.calls.map(([id]) => id)).toEqual([100, 101, 99]);
    expect(feed.snapshot.sprintAll.map(i => i.id)).toEqual([3]);
    expect(feed.snapshot.backlog.map(i => i.id)).toContain(3);
  });
  it('scans past fully planned server pages before returning a page and preserves target-version issues', async () => {
    const api = client(), feed = new BuildPlanningFeed(api, 1);
    api.page.mockResolvedValueOnce({ items: [issue(1), issue(2)], nextOffset: 2, hasMore: true })
      .mockResolvedValueOnce({ items: [issue(3, { fixed_version: { id: 88 } })], nextOffset: 3, hasMore: false });
    await feed.load(scope, filters);
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([3]);
    expect(api.page.mock.calls[1][2].offset).toBe(2);
  });
  it('applies search before pagination and reuses membership and unfiltered totals', async () => {
    const api = client(), feed = new BuildPlanningFeed(api);
    await feed.load(scope, filters);
    await feed.load(scope, { ...filters, query: 'some text', tracker: '2', assignee: 'none' }, { refreshSprint: false });
    expect(api.relations).toHaveBeenCalledTimes(2);
    expect(api.page.mock.calls[1][2]).toMatchObject({ subject: '~some text', tracker_id: '2', assigned_to_id: '!*', offset: 0 });
    expect(api.list.mock.calls[1][2]).toMatchObject({ subject: '~some text', issue_id: '1,7' });
    await feed.load(scope, { ...filters, query: '#555' }, { refreshSprint: false });
    expect(feed.snapshot.sprintVisible).toEqual([]);
  });
  it('still serves backlog when there are no Builds or no sprint selected', async () => {
    const api = client(), feed = new BuildPlanningFeed(api);
    await feed.load({ ...scope, builds: [], sprintId: undefined }, filters);
    expect(api.relations).not.toHaveBeenCalled(); expect(api.list).not.toHaveBeenCalled();
    expect(feed.snapshot.sprintAll).toEqual([]);
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([1, 2, 3, 5, 9]);
  });
  it('discards old scope responses even if the upstream ignores cancellation', async () => {
    const api = client(), slow = deferred(), feed = new BuildPlanningFeed(api);
    api.page.mockReturnValueOnce(slow.promise);
    const old = feed.load(scope, filters);
    await vi.waitFor(() => expect(api.page).toHaveBeenCalledTimes(1));
    await feed.load({ ...scope, projectId: '2' }, filters);
    slow.resolve({ items: [issue(3)], nextOffset: 1, hasMore: false });
    expect(await old).toBeNull(); expect(feed.snapshot.backlog).toEqual([]);
  });
  it('merges large sprint batches using priority order rather than priority IDs', async () => {
    const api = client(), feed = new BuildPlanningFeed(api);
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    api.relations.mockImplementation(async id => id === 100 ? ids.map(i => rel(100, i)) : []);
    api.list.mockImplementation(async (path, collection, query) => path.includes('issue_priorities')
      ? [{ id: 20, name: 'Low' }, { id: 2, name: 'High' }]
      : query.issue_id.split(',').map(Number).map(id => issue(id, { priority: { id: id === 101 ? 2 : 20 } })));
    await feed.load(scope, filters);
    expect(feed.snapshot.sprintAll).toHaveLength(101);
    expect(feed.snapshot.sprintAll[0].id).toBe(101);
    expect(feed.snapshot.sprintAll[1].id).toBe(1);
  });
  it('discards a late next page after category scope changes', async () => {
    const api = client(), feed = new BuildPlanningFeed(api, 1), slow = deferred();
    api.page.mockResolvedValueOnce({ items: [issue(3)], nextOffset: 1, hasMore: true })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [issue(8)], nextOffset: 1, hasMore: false });
    await feed.load(scope, filters);
    const old = feed.next();
    await feed.load({ ...scope, categoryId: '5' }, filters);
    slow.resolve({ items: [issue(6)], nextOffset: 2, hasMore: false });
    expect(await old).toBeNull();
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([8]);
  });
  it('keeps failed next pages retryable and deduplicates concurrent requests', async () => {
    const api = client(), feed = new BuildPlanningFeed(api, 1);
    api.page.mockResolvedValueOnce({ items: [issue(3)], nextOffset: 1, hasMore: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [issue(5)], nextOffset: 2, hasMore: false });
    await feed.load(scope, filters);
    const a = feed.next(), b = feed.next(); expect(a).toBe(b);
    await expect(a).rejects.toThrow('offline'); expect(feed.snapshot.nextOffset).toBe(1);
    await feed.next(); expect(api.page.mock.calls[2][2].offset).toBe(1);
    expect(feed.snapshot.backlog.map(i => i.id)).toEqual([3, 5]);
  });
});
