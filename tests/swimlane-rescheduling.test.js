import { describe, it, expect, vi } from 'vitest';
import { collectReschedulingIssues, rescheduleSwimlane, reschedulingTargets } from '../src/swimlane-rescheduling.js';

const scope = { projectId: 10, projectIds: [10, 11], sprintId: 20, sprintFieldId: 7, swimlaneTrackers: ['Feature'], closedStatusIds: [5, 9] };
function issue(id, parent, { status = 1, tracker = 'Task', sprint = ['20'], project = 11, children = [] } = {}) {
  return { id, project: { id: project }, tracker: { name: tracker }, status: { id: status },
    ...(parent ? { parent: { id: parent } } : {}), children: children.map(id => ({ id })),
    fixed_version: { id: 90 }, custom_fields: [{ id: 7, multiple: true, value: sprint }, { id: 8, value: 'keep' }] };
}
function fixture() {
  const issues = new Map([
    [1, issue(1, null, { tracker: 'Feature', project: 10, children: [2, 3, 7] })],
    [2, issue(2, 1, { status: 5, children: [4] })],
    [3, issue(3, 1, { tracker: 'Feature', sprint: ['30', '40'], children: [5] })],
    [4, issue(4, 2, { sprint: [] })],
    [5, issue(5, 3, { children: [6] })],
    [6, issue(6, 5, { status: 9 })],
    [7, issue(7, 1, { project: 99 })],
  ]);
  const versions = new Map([20, 30].map(id => [id, { id, status: 'open', project: { id: 10 }, sharing: 'descendants' }]));
  const api = {
    hierarchyIssue: vi.fn(async id => structuredClone(issues.get(id))),
    issue: vi.fn(async id => structuredClone(issues.get(id))),
    request: vi.fn(async path => ({ version: structuredClone(versions.get(Number(path.match(/\d+/)[0]))) })),
    update: vi.fn(async (id, patch) => { issues.get(id).custom_fields[0].value = patch.custom_fields[0].value; }),
  };
  return { api, issues, versions };
}

describe('collectReschedulingIssues', () => {
  it('includes the parent, nested Swimlanes and every descendant, closed and non-closed', async () => {
    const { api } = fixture();
    expect((await collectReschedulingIssues(api, 1, scope)).map(issue => issue.id)).toEqual([1, 2, 4, 3, 5, 6]);
    expect(api.hierarchyIssue.mock.calls.map(([id]) => id)).toEqual([1, 2, 4, 3, 5, 6, 7]);
  });

  it.each(['closed', 'tracker', 'membership', 'scope', 'source'])('rejects invalid root/source: %s', async condition => {
    const { api, issues, versions } = fixture();
    if (condition === 'closed') issues.get(1).status.id = 5;
    if (condition === 'tracker') issues.get(1).tracker.name = 'Task';
    if (condition === 'membership') issues.get(1).custom_fields[0].value = [];
    if (condition === 'scope') issues.get(1).project.id = 99;
    if (condition === 'source') versions.get(20).status = 'closed';
    await expect(collectReschedulingIssues(api, 1, scope)).rejects.toThrow();
  });

  it('rejects changed parent links and malformed/cyclic hierarchy', async () => {
    const { api, issues } = fixture();
    issues.get(4).parent.id = 3;
    await expect(collectReschedulingIssues(api, 1, scope)).rejects.toThrow(/Hierarchy changed/);
    issues.get(4).parent.id = 2;
    issues.get(4).children = [{ id: 1 }];
    await expect(collectReschedulingIssues(api, 1, scope)).rejects.toThrow(/cyclic/);
  });
});

describe('rescheduleSwimlane', () => {
  it('replaces the entire Sprint field and changes no status, Target version or other fields', async () => {
    const { api, issues } = fixture();
    const before = structuredClone([...issues]);
    expect(await rescheduleSwimlane(api, 1, scope, 30, { expectedIds: [6, 5, 3, 4, 2, 1] })).toEqual({ added: [1, 2, 4, 3, 5, 6], failed: [], notAttempted: [], error: null });
    for (const [id, original] of before) {
      if ([1, 2, 4, 3, 5, 6].includes(id)) original.custom_fields[0].value = ['30'];
      expect(issues.get(id)).toEqual(original);
    }
    expect(api.update).toHaveBeenCalledTimes(6);
    expect(api.update.mock.calls.every(([, patch]) => Object.keys(patch).join() === 'custom_fields')).toBe(true);
  });

  it('rejects hierarchy additions since the popup before writing', async () => {
    const { api, issues } = fixture();
    issues.get(3).children.push({ id: 8 }); issues.set(8, issue(8, 3));
    const result = await rescheduleSwimlane(api, 1, scope, 30, { expectedIds: [1, 2, 4, 3, 5, 6] });
    expect(result.error).toMatch(/Eligible issues changed/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it.each(['closed', 'foreign', 'unshared', 'same'])('rejects invalid targets (%s)', async condition => {
    const { api, versions } = fixture();
    if (condition === 'closed') versions.get(30).status = 'closed';
    if (condition === 'foreign') versions.get(30).project.id = 11;
    if (condition === 'unshared') versions.get(30).sharing = 'none';
    expect((await rescheduleSwimlane(api, 1, scope, condition === 'same' ? 20 : 30)).error).toMatch(/Preflight failed/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('rejects unshared versions even for a root-only product and missing ownership metadata', async () => {
    const { api, versions } = fixture();
    versions.get(30).sharing = 'none';
    expect((await rescheduleSwimlane(api, 1, { ...scope, projectIds: [10] }, 30)).error).toMatch(/not shared/);
    versions.get(30).sharing = 'descendants';
    delete versions.get(30).project;
    expect((await rescheduleSwimlane(api, 1, scope, 30)).error).toMatch(/not owned/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it.each(['parent', 'root-closed', 'scope', 'field', 'root'])('preflights every fresh issue before any writes (%s)', async change => {
    const { api } = fixture();
    const read = api.issue.getMockImplementation();
    api.issue.mockImplementation(async id => {
      const result = await read(id);
      if (id === (change.startsWith('root') ? 1 : 5)) {
        if (change === 'parent') result.parent.id = 2;
        if (change === 'root-closed') result.status.id = 5;
        if (change === 'scope') result.project.id = 99;
        if (change === 'field') result.custom_fields = [];
        if (change === 'root') result.custom_fields[0].value = [];
      }
      return result;
    });
    expect((await rescheduleSwimlane(api, 1, scope, 30)).error).toMatch(/Preflight failed/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('still moves a descendant that closes after the popup, without changing its status', async () => {
    const { api, issues } = fixture();
    const expectedIds = (await collectReschedulingIssues(api, 1, scope)).map(issue => issue.id);
    issues.get(5).status.id = 5;
    const result = await rescheduleSwimlane(api, 1, scope, 30, { expectedIds });
    expect(result.error).toBeNull();
    expect(result.added).toEqual([1, 2, 4, 3, 5, 6]);
    expect(issues.get(5).status.id).toBe(5);
    expect(issues.get(5).custom_fields[0].value).toEqual(['30']);
  });

  it('detects hierarchy additions during preflight', async () => {
    const { api, issues } = fixture();
    const read = api.issue.getMockImplementation();
    api.issue.mockImplementation(async id => {
      if (id === 5) { issues.get(3).children.push({ id: 8 }); issues.set(8, issue(8, 3)); }
      return read(id);
    });
    expect((await rescheduleSwimlane(api, 1, scope, 30)).error).toMatch(/Hierarchy changed/);
    expect(api.update).not.toHaveBeenCalled();
  });

  it.each(['throws', 'ignored'])('stops on a failed or uncertain write (%s), without rollback/retry', async failure => {
    const { api } = fixture();
    const update = api.update.getMockImplementation();
    api.update.mockImplementation(async (id, patch) => {
      if (id === 4) { if (failure === 'throws') throw new Error('permission denied'); return; }
      await update(id, patch);
    });
    const result = await rescheduleSwimlane(api, 1, scope, 30);
    expect(result).toEqual({ added: [1, 2], failed: [4], notAttempted: [3, 5, 6], error: expect.stringMatching(/permission denied|did not retain/) });
    expect(api.update.mock.calls.map(([id]) => id)).toEqual([1, 2, 4]);
  });

  it('rechecks issue scope and Sprint openness immediately before each write', async () => {
    const { api, versions } = fixture();
    const update = api.update.getMockImplementation();
    api.update.mockImplementation(async (id, patch) => { await update(id, patch); versions.get(30).status = 'closed'; });
    const result = await rescheduleSwimlane(api, 1, scope, 30);
    expect(result.added).toEqual([1]);
    expect(result.failed).toEqual([2]);
    expect(result.notAttempted).toEqual([4, 3, 5, 6]);
    expect(api.update).toHaveBeenCalledTimes(1);
  });
});

describe('reschedulingTargets', () => {
  const version = (id, created_on, status = 'open') => ({ id, created_on, status });
  it('sorts creation times and numeric ID ties descending, keeping missing dates last and the nearest next Sprint selected', () => {
    const versions = [version(12, '2025-01-01T01:00:00+01:00'), version(2, '2025-01-01T00:00:00Z'), version(10, '2025-01-01'), version(1, '2024-12-31'), version(3, '2025-02-01', 'closed'), version(4, null), version(5, 'invalid')];
    expect(reschedulingTargets(versions, 2)).toEqual({ targets: [versions[0], versions[2], versions[3], versions[6], versions[5]], selectedId: 10 });
    expect(versions.map(version => version.id)).toEqual([12, 2, 10, 1, 3, 4, 5]);
  });

  it('selects the first strictly later version; no later timestamp or missing source date gives no default', () => {
    const versions = [version(1, '2025-01-01'), version(2, '2025-02-01'), version(3, null)];
    expect(reschedulingTargets(versions, 1).selectedId).toBe(2);
    expect(reschedulingTargets(versions, 2).selectedId).toBe('');
    expect(reschedulingTargets(versions, 3).selectedId).toBe('');
    expect(reschedulingTargets(versions, 99).selectedId).toBe('');
    expect(reschedulingTargets([], 1)).toEqual({ targets: [], selectedId: '' });
  });
});
