import { describe, it, expect, vi } from 'vitest';
import { collectMissingSubtasks, planDescendants } from '../src/descendant-planning.js';

const scope = { projectIds: [1, 2], sprintId: 100, sprintFieldId: 7, swimlaneTrackers: ['Feature'] };
function fixture() {
  const make = (id, parent, tracker = 'Task', values = []) => ({ id, project: { id: 1 }, tracker: { name: tracker }, status: { id: 1 }, parent: parent ? { id: parent } : undefined, allowed_statuses: [{ id: 2 }], fixed_version: { id: 800 }, custom_fields: [{ id: 7, multiple: true, value: values }] });
  const rows = [make(1, null, 'Feature'), make(2, 1), make(3, 2, 'Task', ['99']), make(4, 1, 'Feature'), make(5, 4), make(6, 1, 'Task', ['99', '100'])];
  rows[2].status = { id: 5, is_closed: true };
  const api = {
    issue: vi.fn(async id => structuredClone(rows.find(row => row.id === id))),
    hierarchyIssue: vi.fn(async id => ({ ...await api.issue(id), children: rows.filter(row => row.parent?.id === id).map(row => ({ id: row.id })) })),
    request: vi.fn(async () => ({ version: { status: 'open' } })),
    update: vi.fn(async (id, patch) => {
      const issue = rows.find(row => row.id === id);
      if (patch.custom_fields) issue.custom_fields = structuredClone(patch.custom_fields);
      if (patch.status_id) issue.status = { id: patch.status_id };
    }),
  };
  return { rows, api };
}

describe('descendant collection', () => {
  it('includes all depths, closed and other-Sprint issues, traverses excluded parents and skips current members', async () => {
    const { api } = fixture();
    expect((await collectMissingSubtasks(api, 1, scope)).map(row => row.id)).toEqual([2, 3, 5]);
  });
  it('does not cross the product boundary', async () => {
    const { api, rows } = fixture(); rows[1].project.id = 99;
    expect((await collectMissingSubtasks(api, 1, scope)).map(row => row.id)).toEqual([5]);
  });
  it('does not treat a hidden field as Unplanned', async () => {
    const { api, rows } = fixture(); rows[2].custom_fields = [];
    await expect(collectMissingSubtasks(api, 1, scope)).rejects.toThrow('unavailable');
  });
  it('still counts a missing scalar membership for attention; write compatibility is a preflight concern', async () => {
    const { api, rows } = fixture(); rows[2].custom_fields = [{ id: 7, value: '99' }];
    expect((await collectMissingSubtasks(api, 1, scope)).map(row => row.id)).toContain(3);
  });
  it('rejects cycles and malformed children', async () => {
    const { api } = fixture(); api.hierarchyIssue.mockResolvedValue({ id: 1, project: { id: 1 }, tracker: { name: 'Feature' }, children: [{ id: 1 }] });
    await expect(collectMissingSubtasks(api, 1, scope)).rejects.toThrow('cyclic');
  });
});

describe('bulk planning', () => {
  it('writes only missing memberships, preserving statuses, releases and other Sprints', async () => {
    const { api, rows } = fixture();
    const report = await planDescendants(api, 1, scope);
    expect(report).toEqual({ added: [2, 3, 5], failed: [], notAttempted: [], error: null });
    expect(api.update.mock.calls).toEqual([
      [2, { custom_fields: [{ id: 7, value: ['100'] }] }],
      [3, { custom_fields: [{ id: 7, value: ['99', '100'] }] }],
      [5, { custom_fields: [{ id: 7, value: ['100'] }] }],
    ]);
    expect(rows[2].status.id).toBe(5); expect(rows[2].fixed_version.id).toBe(800);
    expect(rows[0].custom_fields[0].value).toEqual([]);
  });
  it('plans the parent with opened status but does not change descendant statuses', async () => {
    const { api, rows } = fixture();
    const report = await planDescendants(api, 1, scope, { includeParent: true, openedStatusId: 2 });
    expect(report.added).toEqual([1, 2, 3, 5]);
    expect(api.update.mock.calls[0][1]).toMatchObject({ status_id: 2 });
    expect(rows[1].status.id).toBe(1); expect(rows[2].status.id).toBe(5);
  });
  it('aborts before every write when the parent transition is forbidden', async () => {
    const { api, rows } = fixture(); rows[0].allowed_statuses = [];
    const report = await planDescendants(api, 1, scope, { includeParent: true, openedStatusId: 2 });
    expect(report.error).toContain('workflow'); expect(api.update).not.toHaveBeenCalled();
  });
  it('requires no transition metadata when already opened', async () => {
    const { api, rows } = fixture(); rows[0].status.id = 2; delete rows[0].allowed_statuses;
    expect((await planDescendants(api, 1, scope, { includeParent: true, openedStatusId: 2 })).error).toBeNull();
  });
  it.each(['hidden', 'scalar', 'closed', 'unreadable'])('preflights %s failures before writes', async kind => {
    const { api, rows } = fixture();
    if (kind === 'hidden') rows[2].custom_fields = [];
    if (kind === 'scalar') rows[2].custom_fields = [{ id: 7, value: '99' }];
    if (kind === 'closed') api.request.mockResolvedValue({ version: { status: 'closed' } });
    if (kind === 'unreadable') api.hierarchyIssue.mockRejectedValue(new Error('Forbidden'));
    expect((await planDescendants(api, 1, scope)).error).toContain('Preflight failed');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('stops and reports partial results without retry or rollback', async () => {
    const { api } = fixture();
    api.update.mockImplementationOnce(async () => {}).mockRejectedValue(new Error('Disconnected'));
    // First write is retained for verification; the second write fails.
    const original = api.issue.getMockImplementation();
    api.issue.mockImplementation(async id => {
      const issue = await original(id);
      if (id === 2 && api.update.mock.calls.length) issue.custom_fields[0].value = ['100'];
      return issue;
    });
    const report = await planDescendants(api, 1, scope);
    expect(report).toEqual({ added: [2], failed: [3], notAttempted: [5], error: 'Disconnected' });
    expect(api.update).toHaveBeenCalledTimes(2);
  });
  it('recomputes from fresh membership values and preserves concurrent additions', async () => {
    const { api, rows } = fixture(); const original = api.request.getMockImplementation();
    api.request.mockImplementation(async (...args) => { rows[1].custom_fields[0].value = ['77']; return original(...args); });
    await planDescendants(api, 1, scope);
    expect(api.update.mock.calls[0][1].custom_fields[0].value).toEqual(['77', '100']);
  });
  it('detects a write Redmine did not retain', async () => {
    const { api } = fixture(); api.update.mockResolvedValue(undefined);
    const report = await planDescendants(api, 1, scope);
    expect(report.failed).toEqual([2]); expect(report.notAttempted).toEqual([3, 5]);
    expect(report.error).toContain('did not retain');
  });
});
