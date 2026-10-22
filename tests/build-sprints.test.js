import { describe, it, expect, vi } from 'vitest';
import { buildTracker, asBuildSprint, relatedId, saveBuildIssue } from '../src/build-sprints.js';
import { isBacklog, movePatch, validateConfig } from '../src/domain.js';

const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 5, name: 'Closed', is_closed: true }];
const build = { id: 100, subject: '7.1', tracker: { id: 9, name: 'Build' }, project: { id: 1 }, category: { id: 4 }, status: statuses[0] };
const sprint = asBuildSprint(build, [5]);
const work = { id: 10, tracker: { id: 1 }, project: { id: 1 }, status: statuses[0], fixed_version: { id: 88 }, allowed_statuses: statuses };
const options = { closedStatusIds: [5], trackerId: 9 };
const relation = (id = 1, type = 'relates', from = 100, to = 10) => ({ id, relation_type: type, issue_id: from, issue_to_id: to });
function client() {
  const issue = structuredClone(work), currentBuild = structuredClone(build), relations = [];
  const api = {
    issue: vi.fn(async id => id === 100 ? currentBuild : issue),
    relations: vi.fn(async () => relations),
    relate: vi.fn(async () => { relations.push(relation()); }),
    unrelate: vi.fn(async id => { relations.splice(relations.findIndex(r => r.id === id), 1); }),
    update: vi.fn(async (id, patch) => { if (patch.status_id) issue.status = statuses.find(s => s.id === patch.status_id); }),
  };
  return { api, issue, currentBuild, relations };
}

describe('Build sprint domain', () => {
  it('resolves configured tracker or exact Build name and reports missing trackers', () => {
    const project = { name: 'Team', trackers: [{ id: 9, name: 'Build' }, { id: 8, name: 'Release' }] };
    expect(buildTracker(project)).toBe(9); expect(buildTracker(project, 8)).toBe(8);
    expect(() => buildTracker(project, 4)).toThrow('not available');
    expect(() => buildTracker({ name: 'Other', trackers: [] })).toThrow('Configure buildTrackerId');
  });
  it('uses closed status IDs rather than status names and keeps duplicate titles distinguishable', () => {
    expect(sprint).toMatchObject({ name: '7.1 (#100)', source: 'build', status: 'open' });
    expect(asBuildSprint({ ...build, status: { id: 5, name: 'Archived' } }, [5]).status).toBe('closed');
  });
  it('recognizes only symmetric relates membership', () => {
    expect(relatedId(relation(), 100)).toBe(10);
    expect(relatedId(relation(1, 'relates', 10, 100), 100)).toBe(10);
    expect(relatedId(relation(1, 'blocks'), 100)).toBeNull();
    expect(relatedId(relation(1, 'relates', 12, 13), 100)).toBeNull();
  });
  it('ignores target versions and keeps open-build membership independent of backlog status scope', () => {
    const scope = { backlogStatusId: 1, sprintSource: 'build', buildTrackerId: 9, closedStatusIds: [5] };
    expect(isBacklog(work, scope)).toBe(true);
    expect(isBacklog({ ...work, openBuildIds: [101] }, scope)).toBe(false);
    expect(isBacklog({ ...work, tracker: { id: 9 } }, scope)).toBe(false);
    expect(isBacklog({ ...work, status: statuses[2] }, { ...scope, allUnplanned: true })).toBe(false);
    expect(movePatch(work, 'status-2', sprint)).toEqual({ sprint_member: true, status_id: 2 });
    expect(movePatch(work, 'backlog', sprint)).toEqual({ sprint_member: false });
  });
  it('validates optional mode and tracker configuration', () => {
    const config = { backlogStatusId: 1, columnStatusIds: [1, 2], redminePublicUrl: 'https://example.test' };
    expect(validateConfig(config, statuses)).toMatchObject({ sprintSource: 'version', buildTrackerId: null });
    expect(validateConfig({ ...config, sprintSource: 'build', buildTrackerId: '9' }, statuses)).toMatchObject({ buildTrackerId: 9 });
    expect(() => validateConfig({ ...config, sprintSource: 'other' }, statuses)).toThrow('sprintSource');
    expect(() => validateConfig({ ...config, buildTrackerId: -1 }, statuses)).toThrow('buildTrackerId');
  });
});

describe('verified Build planning writes', () => {
  it('adds a relation and updates status without sending or changing target version or category', async () => {
    const { api, issue } = client();
    await saveBuildIssue(api, 10, sprint, { sprint_member: true, status_id: 2 }, options);
    expect(api.relate).toHaveBeenCalledWith(100, 10);
    expect(api.update).toHaveBeenCalledWith(10, { status_id: 2 });
    expect(issue.fixed_version).toEqual({ id: 88 });
  });
  it('removes only the selected sprint relates link in either orientation, without resetting status', async () => {
    const { api, relations } = client();
    relations.push(relation(1, 'relates', 10, 100), relation(2, 'blocks'), relation(3, 'relates', 101, 10));
    await saveBuildIssue(api, 10, sprint, { sprint_member: false }, options);
    expect(api.unrelate).toHaveBeenCalledExactlyOnceWith(1);
    expect(relations.map(r => r.id)).toEqual([2, 3]); expect(api.update).not.toHaveBeenCalled();
  });
  it('avoids no-op relation and field writes', async () => {
    const { api, relations } = client(); relations.push(relation());
    await saveBuildIssue(api, 10, sprint, { sprint_member: true, status_id: 1 }, options);
    expect(api.relate).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it('checks fresh closed state and workflow before writing relations', async () => {
    const { api, currentBuild } = client(); currentBuild.status = statuses[2];
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true }, options)).rejects.toThrow('no longer open');
    expect(api.relate).not.toHaveBeenCalled();
    currentBuild.status = statuses[0];
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true, status_id: 99 }, options)).rejects.toThrow('does not allow');
    expect(api.relate).not.toHaveBeenCalled();
  });
  it('reports observed partial state after a field failure and never rolls back the relation', async () => {
    const { api, relations } = client(); api.update.mockRejectedValue(new Error('Denied'));
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true, status_id: 2 }, options)).rejects.toThrow('Observed sprint membership: present. Requested field values: not retained');
    expect(relations).toHaveLength(1); expect(api.unrelate).not.toHaveBeenCalled();
  });
  it('detects silently ignored fields and relation writes', async () => {
    const { api } = client(); api.relate.mockResolvedValue(null);
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true }, options)).rejects.toThrow('membership: absent');
  });
  it('reports the verified outcome after a relation response is lost, without rollback or retry', async () => {
    const { api, relations } = client();
    api.relate.mockImplementation(async () => { relations.push(relation()); throw new Error('Connection lost'); });
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true }, options)).rejects.toThrow('Observed sprint membership: present');
    expect(api.relate).toHaveBeenCalledTimes(1); expect(api.unrelate).not.toHaveBeenCalled();
  });
  it('rejects a Build moved to another category before planning', async () => {
    const { api, currentBuild } = client(); currentBuild.category = { id: 8 };
    await expect(saveBuildIssue(api, 10, sprint, { sprint_member: true }, options)).rejects.toThrow('no longer valid');
    expect(api.relate).not.toHaveBeenCalled();
  });
  it('rejects target-version patches outright', async () => {
    const { api } = client();
    await expect(saveBuildIssue(api, 10, sprint, { fixed_version_id: null }, options)).rejects.toThrow('must not modify');
    expect(api.update).not.toHaveBeenCalled();
  });
});
