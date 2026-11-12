import { describe, it, expect, vi } from 'vitest';
import { groupSwimlanes, loadAncestors } from '../src/swimlanes.js';

const issue = (id, parent, tracker = 'Task') => ({ id, tracker: { name: tracker }, ...(parent ? { parent: { id: parent } } : {}) });
const trackers = ['Feature', 'Epic'];
describe('membership-driven Swimlanes', () => {
  it('renders a planned parent even with no planned children', () => {
    const parent = issue(1, null, 'Feature');
    const lanes = groupSwimlanes([parent], [parent], trackers);
    expect(lanes.map(lane => lane.id)).toEqual(['1']);
    expect(lanes[0].all).toEqual([]);
  });
  it('omits Ungrouped from an empty Sprint', () => {
    expect(groupSwimlanes([], [], trackers)).toEqual([]);
  });
  it('omits Ungrouped when all Cards have a planned qualifying ancestor', () => {
    const members = [issue(1, null, 'Feature'), issue(2, 1)];
    const lanes = groupSwimlanes(members, members, trackers);
    expect(lanes.map(lane => lane.id)).toEqual(['1']);
    expect(lanes[0].all).toEqual([members[1]]);
  });
  it('keeps Ungrouped for members outside the visible set and displayed statuses', () => {
    const member = { ...issue(2), status: { id: 99, name: 'Other' } };
    const lanes = groupSwimlanes([member], [], trackers);
    expect(lanes.map(lane => lane.id)).toEqual(['ungrouped']);
    expect(lanes[0].all).toEqual([member]);
    expect(lanes[0].visible).toEqual([]);
  });
  it('does not create a heading from an unplanned ancestor', () => {
    const child = issue(2, 1);
    const lanes = groupSwimlanes([child], [child], trackers, [issue(1, null, 'Feature')]);
    expect(lanes.map(lane => lane.id)).toEqual(['ungrouped']);
    expect(lanes[0].all).toEqual([child]);
  });
  it('uses nearest planned qualifying ancestor and renders each planned parent', () => {
    const members = [issue(1, null, 'Epic'), issue(2, 1, 'Feature'), issue(3, 2), issue(4, 1), issue(5)];
    const lanes = groupSwimlanes(members, members, trackers);
    expect(lanes.map(lane => lane.id)).toEqual(['1', '2', 'ungrouped']);
    expect(lanes.map(lane => lane.all.map(row => row.id))).toEqual([[4], [3], [5]]);
  });
  it('connects through unplanned intermediate ancestors without adding them', async () => {
    const parent = issue(1, null, 'Epic'), child = issue(3, 2);
    const api = { issue: vi.fn(async () => issue(2, 1)) };
    const ancestors = await loadAncestors(api, [parent, child]);
    const lanes = groupSwimlanes([parent, child], [], trackers, ancestors);
    expect(lanes[0].all).toEqual([child]);
    expect(lanes[0].visible).toEqual([]);
    expect(api.issue).toHaveBeenCalledExactlyOnceWith(2);
  });
});
