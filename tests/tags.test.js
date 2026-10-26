import { describe, it, expect, vi } from 'vitest';
import { PlanningFeed, matchesTags } from '../src/planning-feed.js';
import { BuildPlanningFeed } from '../src/build-planning-feed.js';

const scope = { projectId: '1', sprintId: 10, backlogStatusId: 1, buildTrackerId: 9, builds: [{ id: 10, status: 'open' }] };
const issue = (id, tags) => ({ id, tags, project: { id: 1 }, tracker: { id: 2 } });

describe('Backlog tags', () => {
  it('matches any selected exact name, tolerating missing and empty issue tags', () => {
    expect(matchesTags(issue(1))).toBe(true);
    expect(matchesTags(issue(1), [])).toBe(true);
    expect(matchesTags(issue(1), ['foo'])).toBe(false);
    expect(matchesTags(issue(1, []), ['foo'])).toBe(false);
    expect(matchesTags(issue(1, ['foobar']), ['foo'])).toBe(false);
    expect(matchesTags(issue(1, ['Foo']), ['foo'])).toBe(false);
    expect(matchesTags(issue(1, ['(447) Adria']), ['foo', '(447) Adria'])).toBe(true);
  });
  for (const Feed of [PlanningFeed, BuildPlanningFeed]) {
    it(`${Feed.name}: scans unmatched pages, buffers multiple-tag matches, and leaves Sprint visibility unchanged`, async () => {
      const sprint = issue(90, ['other']);
      const api = {
        relations: vi.fn().mockResolvedValue([{ issue_id: 10, issue_to_id: 90, relation_type: 'relates' }]),
        list: vi.fn().mockResolvedValue([sprint]),
        page: vi.fn()
          .mockResolvedValueOnce({ items: [issue(1), issue(2, ['foobar'])], total: 5, nextOffset: 2, hasMore: true })
          .mockResolvedValueOnce({ items: [issue(3, ['foo']), issue(4, ['bar']), issue(5, ['foo', 'bar'])], total: 5, nextOffset: 5, hasMore: false }),
      };
      const feed = new Feed(api, 2);
      await feed.load(scope, { tags: ['foo', 'bar'], tracker: '2' });
      expect(feed.snapshot.backlog.map(row => row.id)).toEqual([3, 4]);
      expect(feed.snapshot.total).toBeNull();
      expect(feed.snapshot.hasMore).toBe(true);
      expect(feed.snapshot.sprintVisible.map(row => row.id)).toEqual([90]);
      for (const [, , params] of api.page.mock.calls) {
        expect(params).toMatchObject({ tracker_id: '2' });
        expect(params).not.toHaveProperty('tags');
        expect(params).not.toHaveProperty('tag');
      }
      await feed.next();
      expect(feed.snapshot.backlog.map(row => row.id)).toEqual([3, 4, 5]);
      expect(feed.snapshot.total).toBe(3);
      expect(feed.snapshot.hasMore).toBe(false);
      expect(api.page).toHaveBeenCalledTimes(2);
    });
    it(`${Feed.name}: a tag-only filter does not refetch or narrow Sprint members, and clearing restores Backlog`, async () => {
      const api = {
        relations: vi.fn().mockResolvedValue([{ issue_id: 10, issue_to_id: 90, relation_type: 'relates' }]),
        list: vi.fn().mockResolvedValue([issue(90, [])]),
        page: vi.fn().mockResolvedValue({ items: [issue(1, [])], total: 1, nextOffset: 1, hasMore: false }),
      };
      const feed = new Feed(api);
      await feed.load(scope, {});
      await feed.load(scope, { tags: ['absent', 'also absent'] }, { refreshSprint: false });
      expect(api.list).toHaveBeenCalledTimes(1);
      expect(feed.snapshot.sprintVisible.map(row => row.id)).toEqual([90]);
      expect(feed.snapshot.backlog).toEqual([]);
      expect(feed.snapshot.total).toBe(0);
      await feed.load(scope, { tags: [] }, { refreshSprint: false });
      expect(feed.snapshot.backlog.map(row => row.id)).toEqual([1]);
      expect(api.list).toHaveBeenCalledTimes(1);
    });
  }
});
