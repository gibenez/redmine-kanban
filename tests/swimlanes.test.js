import { describe, it, expect, vi } from 'vitest';
import { groupSwimlanes, loadAncestors, collectHierarchy, groupPlan, executeGroup } from '../src/swimlanes.js';

const project = { id: 1 };
const issue = (id, parent, tracker = 'Task', version) => ({ id, project, subject: `Issue ${id}`, tracker: { id: tracker === 'Build' ? 9 : 1, name: tracker }, status: { id: 1 }, ...(parent ? { parent: { id: parent } } : {}), ...(version ? { fixed_version: { id: version } } : {}) });
const options = { trackers: ['Feature', 'Bug', 'Improvement'], closedStatusIds: [5], trackerId: 9 };
const sprint = { id: 10, status: 'open', project };

function fixture() {
  const rows = [issue(1, null, 'Feature'), issue(2, 1), issue(3, 2, 'Bug'), { ...issue(4, 1), project: { id: 2 } }, issue(5, 3)];
  rows[0].children = [{ id: 2 }, { id: 4 }]; rows[1].children = [{ id: 3 }]; rows[2].children = [{ id: 5 }];
  const api = {
    hierarchyIssue: vi.fn(async id => structuredClone(rows.find(row => row.id === id))),
    issue: vi.fn(async id => structuredClone(rows.find(row => row.id === id))),
    request: vi.fn(async () => ({ version: sprint })),
    update: vi.fn(async (id, patch) => { rows.find(row => row.id === id).fixed_version = patch.fixed_version_id ? { id: patch.fixed_version_id } : undefined; }),
  };
  return { rows, api };
}

describe('Swimlane presentation', () => {
  it('uses the topmost qualifying member and displays each descendant once', () => {
    const members = [issue(1, null, 'Feature'), issue(2, 1, 'Bug'), issue(3, 2), issue(4)];
    const lanes = groupSwimlanes(members, members, options.trackers);
    expect(lanes.map(lane => lane.id)).toEqual(['1', 'ungrouped']);
    expect(lanes[0].visible.map(row => row.id)).toEqual([2, 3]);
    expect(lanes[1].visible.map(row => row.id)).toEqual([4]);
  });
  it('keeps empty lanes and ancestors when filters hide parents', () => {
    const members = [issue(1, null, 'Feature'), issue(2, 1)];
    const lanes = groupSwimlanes(members, [members[1]], options.trackers);
    expect(lanes[0].parent.id).toBe(1);
    expect(lanes[0].visible.map(row => row.id)).toEqual([2]);
    expect(groupSwimlanes([members[0]], [], options.trackers)[0].all).toEqual([]);
  });
  it('groups through an independently removed intermediate issue without adding it', async () => {
    const members = [issue(1, null, 'Feature'), issue(3, 2)];
    const api = { issue: vi.fn(async () => issue(2, 1)) };
    const ancestors = await loadAncestors(api, members);
    const lanes = groupSwimlanes(members, members, options.trackers, ancestors);
    expect(lanes[0].all.map(row => row.id)).toEqual([3]);
    expect(api.issue).toHaveBeenCalledExactlyOnceWith(2);
  });
  it('does not infer a lane from an unplanned qualifying ancestor', () => {
    const members = [issue(2, 1)];
    const lanes = groupSwimlanes(members, members, options.trackers, [issue(1, null, 'Feature')]);
    expect(lanes[0].id).toBe('ungrouped');
    expect(lanes[0].all).toEqual(members);
  });
});

describe('hierarchy planning', () => {
  it('reads every descendant and excludes other projects before writing', async () => {
    const { api } = fixture();
    const hierarchy = await collectHierarchy(api, 1, 1);
    expect(hierarchy.issues.map(row => row.id)).toEqual([1, 2, 3, 5]);
    expect(hierarchy.excluded.map(row => row.id)).toEqual([4]);
    expect(api.update).not.toHaveBeenCalled();
  });
  it('aborts preflight if a descendant cannot be read', async () => {
    const { api } = fixture(); api.hierarchyIssue.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(groupPlan(api, 1, sprint, 1, true, options)).rejects.toThrow('Forbidden');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('identifies version replacements and preserves statuses during addition', async () => {
    const { api, rows } = fixture(); rows[1].fixed_version = { id: 20 };
    const plan = await groupPlan(api, 1, sprint, 1, true, options);
    expect(plan.replacements.map(row => row.id)).toEqual([2]);
    const result = await executeGroup(api, plan, sprint, options);
    expect(result.succeeded).toEqual([1, 2, 3, 5]);
    expect(result.failed).toEqual([]);
    expect(api.update.mock.calls.every(([, patch]) => JSON.stringify(patch) === '{"fixed_version_id":10}')).toBe(true);
    expect(rows[3].fixed_version).toBeUndefined();
  });
  it('removes only current selected Sprint members, never another Sprint', async () => {
    const { api, rows } = fixture(); rows[0].fixed_version = { id: 10 }; rows[1].fixed_version = { id: 20 }; rows[2].fixed_version = { id: 10 };
    const plan = await groupPlan(api, 1, sprint, 1, false, options);
    expect(plan.targets.map(row => row.id)).toEqual([1, 3]);
    await executeGroup(api, plan, sprint, options);
    expect(rows[1].fixed_version.id).toBe(20);
    expect(api.update.mock.calls).toEqual([[1, { fixed_version_id: null }], [3, { fixed_version_id: null }]]);
  });
  it('does not overwrite membership changed after confirmation', async () => {
    const { api, rows } = fixture(); rows[0].fixed_version = { id: 10 };
    const plan = await groupPlan(api, 1, sprint, 1, false, options);
    rows[0].fixed_version = { id: 20 };
    expect((await executeGroup(api, plan, sprint, options)).failed[0].message).toContain('changed');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('reports partial failures, verifies writes and does not roll back', async () => {
    const { api } = fixture(); api.update.mockRejectedValueOnce(new Error('Forbidden'));
    const plan = await groupPlan(api, 1, sprint, 1, true, options);
    const result = await executeGroup(api, plan, sprint, options);
    expect(result.failed.map(row => row.id)).toEqual([1]);
    expect(result.succeeded).toEqual([2, 3, 5]);
    expect(api.update).toHaveBeenCalledTimes(4);
    expect(api.issue).toHaveBeenCalledTimes(8);
  });
  it('adds only missing descendants on explicit replanning', async () => {
    const { api, rows } = fixture(); rows[0].fixed_version = { id: 10 }; rows[1].fixed_version = { id: 10 };
    const plan = await groupPlan(api, 1, sprint, 1, true, options);
    expect(plan.targets.map(row => row.id)).toEqual([3, 5]);
  });
  it('refuses a closed Sprint', async () => {
    const { api } = fixture();
    await expect(groupPlan(api, 1, { ...sprint, status: 'closed' }, 1, true, options)).rejects.toThrow('read only');
    expect(api.hierarchyIssue).not.toHaveBeenCalled();
  });
  it('preserves unrelated and other Build memberships during removal', async () => {
    const { api, rows } = fixture();
    const build = { ...issue(10, null, 'Build'), category: { id: 2 } }; rows.push(build);
    let relations = [
      { id: 101, issue_id: 10, issue_to_id: 1, relation_type: 'relates' },
      { id: 102, issue_id: 2, issue_to_id: 10, relation_type: 'relates' },
      { id: 103, issue_id: 10, issue_to_id: 3, relation_type: 'blocks' },
      { id: 104, issue_id: 20, issue_to_id: 1, relation_type: 'relates' },
    ];
    api.relations = vi.fn(async () => relations);
    api.unrelate = vi.fn(async id => { relations = relations.filter(row => row.id !== id); });
    const selected = { ...sprint, source: 'build', category: { id: 2 } };
    const plan = await groupPlan(api, 1, selected, 1, false, options);
    const result = await executeGroup(api, plan, selected, options);
    expect(result.failed).toEqual([]);
    expect(api.unrelate.mock.calls).toEqual([[101], [102]]);
    expect(relations.map(row => row.id)).toEqual([103, 104]);
    expect(api.update).not.toHaveBeenCalled();
  });
});
