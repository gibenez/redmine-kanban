import { describe, it, expect } from 'vitest';
import { validateConfig, isBacklog, effort, movePatch, parseEstimate, assertTransition, matchesPatch, escapeHtml } from '../src/domain.js';

const statuses = [{ id: 1, name: 'New', is_closed: false }, { id: 2, name: 'Open', is_closed: false }, { id: 5, name: 'Done', is_closed: true }];
const sprint = { id: 10, status: 'open' };
const issue = { id: 8, subject: 'Ship a feature', status: statuses[0], tracker: { id: 1 }, priority: { id: 2 }, estimated_hours: null };

describe('deployment configuration', () => {
  const config = { backlogStatusId: 1, columnStatusIds: [1, 2, 5], redminePublicUrl: 'https://redmine.example.test/subpath' };
  it('validates IDs against actual statuses and preserves deployment paths', () => {
    expect(validateConfig(config, statuses)).toMatchObject({ backlogStatusId: 1, refreshSeconds: 60, redminePublicUrl: config.redminePublicUrl });
  });
  it('defaults, normalizes and disables Swimlane tracker names', () => {
    expect(validateConfig(config, statuses).swimlaneTrackers).toEqual(['Feature', 'Bug', 'Improvement']);
    expect(validateConfig({ ...config, swimlaneTrackers: [' Story ', 'Bug', 'Story'] }, statuses).swimlaneTrackers).toEqual(['Story', 'Bug']);
    expect(validateConfig({ ...config, swimlaneTrackers: [] }, statuses).swimlaneTrackers).toEqual([]);
  });
  it.each([
    { swimlaneTrackers: 'Feature,Bug' }, { swimlaneTrackers: [''] }, { swimlaneTrackers: [1] },
    { columnStatusIds: [] }, { columnStatusIds: [1, 1] }, { backlogStatusId: 5 }, { columnStatusIds: [999] },
    { backlogStatusId: -1 }, { redminePublicUrl: 'javascript:alert(1)' }, { redminePublicUrl: 'https://secret@redmine.test' },
  ])('rejects unsafe or invalid mappings: %j', overrides => expect(() => validateConfig({ ...config, ...overrides }, statuses)).toThrow());
});

describe('planning semantics', () => {
  it('backlog means unplanned, narrowed to New unless the scope is widened', () => {
    const narrow = { backlogStatusId: 1, allUnplanned: false, closedStatusIds: [5] };
    const wide = { ...narrow, allUnplanned: true };
    expect(isBacklog(issue, narrow)).toBe(true);
    expect(isBacklog({ ...issue, status: statuses[1] }, narrow)).toBe(false);
    expect(isBacklog({ ...issue, status: statuses[1] }, wide)).toBe(true);
    // Widening admits every OPEN status; closed unplanned issues stay off the board.
    expect(isBacklog({ ...issue, status: statuses[2] }, wide)).toBe(false);
    expect(isBacklog({ ...issue, fixed_version: sprint }, narrow)).toBe(false);
    expect(isBacklog({ ...issue, fixed_version: sprint }, wide)).toBe(false);
  });
  it('commits and changes status in one explicit move', () => {
    expect(movePatch(issue, 'status-2', sprint)).toEqual({ fixed_version_id: 10, status_id: 2 });
    expect(movePatch({ ...issue, fixed_version: sprint }, 'status-1', sprint)).toEqual({});
  });
  it('removing in-progress work does NOT reset its status', () => {
    expect(movePatch({ ...issue, status: statuses[1], fixed_version: sprint }, 'backlog', sprint)).toEqual({ fixed_version_id: null });
  });
  it('rejects writes to closed sprints or unmapped drop targets', () => {
    expect(() => movePatch(issue, 'backlog', { ...sprint, status: 'closed' })).toThrow();
    expect(() => movePatch(issue, 'other', sprint)).toThrow();
  });
  it('checks per-user allowed workflow transitions', () => {
    expect(() => assertTransition(issue, { status_id: 2 })).toThrow('allowed statuses');
    expect(() => assertTransition({ ...issue, allowed_statuses: [statuses[0]] }, { status_id: 2 })).toThrow('does not allow');
    expect(() => assertTransition({ ...issue, allowed_statuses: statuses }, { status_id: 2 })).not.toThrow();
  });
  it('detects fields silently ignored by Redmine', () => {
    expect(matchesPatch(issue, { fixed_version_id: null, estimated_hours: null, status_id: 1 })).toBe(true);
    expect(matchesPatch(issue, { assigned_to_id: 9 })).toBe(false);
    expect(matchesPatch({ ...issue, estimated_hours: 0 }, { estimated_hours: 0 })).toBe(true);
    expect(matchesPatch(issue, { estimated_hours: 0 })).toBe(false);
  });
});

describe('display and estimates', () => {
  it('does not conflate zero estimates with missing estimates', () => {
    expect(effort([issue, { ...issue, estimated_hours: 0 }, { ...issue, estimated_hours: 2.5 }])).toEqual({ count: 3, hours: 2.5, unestimated: 1 });
    expect(parseEstimate('')).toBe(null); expect(parseEstimate('0')).toBe(0); expect(parseEstimate('2.5')).toBe(2.5);
    for (const value of ['-1', 'NaN', 'Infinity']) expect(() => parseEstimate(value)).toThrow();
  });
  it('escapes every API-derived string before passing HTML to jKanban', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)"> & \'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;');
  });
});
