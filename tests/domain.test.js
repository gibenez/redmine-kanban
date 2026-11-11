import { describe, it, expect } from 'vitest';
import { validateConfig, isBacklog, effort, movePatch, parseEstimate, assertTransition, matchesPatch, escapeHtml, sprintValue, sprintValues, membershipPatch, sprintPatch, projectScope } from '../src/domain.js';

const statuses = [{ id: 1, name: 'New', is_closed: false }, { id: 2, name: 'Open', is_closed: false }, { id: 5, name: 'Done', is_closed: true }];
const sprint = { id: 10, status: 'open' };
const issue = { id: 8, custom_fields: [{ id: 7, value: '' }], subject: 'Ship a feature', status: statuses[0], tracker: { id: 1, name: 'Feature' }, priority: { id: 2 }, estimated_hours: null };
const backlogScope = { sprintFieldId: 7, swimlaneTrackers: ['Feature'], closedStatusIds: [5] };

describe('deployment configuration', () => {
  const config = { sprintFieldId: 7, backlogStatusId: 1, columnStatusIds: [1, 2, 5], redminePublicUrl: 'https://redmine.example.test/subpath' };
  it('validates IDs against actual statuses and preserves deployment paths', () => {
    expect(validateConfig(config, statuses)).toMatchObject({ backlogStatusId: 1, refreshSeconds: 60, redminePublicUrl: config.redminePublicUrl });
  });
  it('defaults, normalizes and disables Swimlane tracker names', () => {
    expect(validateConfig(config, statuses).swimlaneTrackers).toEqual(['Feature', 'Bug', 'Improvement']);
    expect(validateConfig({ ...config, swimlaneTrackers: [' Story ', 'Bug', 'Story'] }, statuses).swimlaneTrackers).toEqual(['Story', 'Bug']);
    expect(validateConfig({ ...config, swimlaneTrackers: [] }, statuses).swimlaneTrackers).toEqual([]);
  });
  it('rejects legacy Build configuration instead of silently reinterpreting planning', () => {
    expect(() => validateConfig({ ...config, sprintSource: 'build', buildTrackerId: 9 }, statuses)).toThrow('Build-based Sprints are no longer supported');
    const validated = validateConfig({ ...config, sprintSource: 'version', buildTrackerId: 9 }, statuses);
    expect(validated).not.toHaveProperty('sprintSource');
    expect(validated).not.toHaveProperty('buildTrackerId');
  });
  it.each([
    { swimlaneTrackers: 'Feature,Bug' }, { swimlaneTrackers: [''] }, { swimlaneTrackers: [1] },
    { columnStatusIds: [] }, { columnStatusIds: [1, 1] }, { backlogStatusId: 5 }, { columnStatusIds: [999] },
    { backlogStatusId: -1 }, { redminePublicUrl: 'javascript:alert(1)' }, { redminePublicUrl: 'https://secret@redmine.test' },
    { sprintFieldId: null }, { sprintFieldId: -1 }, { sprintFieldId: 1.5 },
  ])('rejects unsafe or invalid mappings: %j', overrides => expect(() => validateConfig({ ...config, ...overrides }, statuses)).toThrow());
});

describe('planning semantics', () => {
  it('accepts a present single-valued Version field with null as Unplanned', () => {
    const empty = { ...issue, custom_fields: [{ id: 7, value: null }] };
    expect(sprintValues(empty, 7)).toEqual([]);
    expect(isBacklog(empty, backlogScope)).toBe(true);
    expect(membershipPatch(empty, 7, 10, true)).toEqual(sprintPatch(7, 10));
    expect(matchesPatch(empty, sprintPatch(7, null))).toBe(true);
    expect(() => sprintValues({ ...issue, custom_fields: [] }, 7)).toThrow('unavailable');
  });
  it('treats former Build containers and related work as ordinary version-planned issues', () => {
    const formerBuild = { ...issue, tracker: { id: 9, name: 'Build' }, openBuildIds: [42] };
    expect(isBacklog(formerBuild, backlogScope)).toBe(false);
    expect(isBacklog({ ...formerBuild, fixed_version: { id: 10, status: 'closed' } }, backlogScope)).toBe(false);
    expect(movePatch(formerBuild, 'status-2', sprint, 7)).toEqual({ ...sprintPatch(7, 10), status_id: 2 });
  });
  it('backlog means Swimlane-capable with no Sprint, regardless of open status', () => {
    expect(isBacklog(issue, backlogScope)).toBe(true);
    expect(isBacklog({ ...issue, status: statuses[1] }, backlogScope)).toBe(true);
    expect(isBacklog({ ...issue, tracker: { name: 'Task' } }, backlogScope)).toBe(false);
    expect(isBacklog({ ...issue, custom_fields: [] }, backlogScope)).toBe(false);
    expect(isBacklog(issue, { ...backlogScope, swimlaneTrackers: [] })).toBe(false);
    expect(isBacklog({ ...issue, status: statuses[2] }, backlogScope)).toBe(false);
    expect(isBacklog({ ...issue, status: statuses[2] }, { ...backlogScope, showClosedParents: true })).toBe(true);
    for (const value of [10, 20, [10, 20]]) {
      expect(isBacklog({ ...issue, ...sprintPatch(7, value) }, backlogScope)).toBe(false);
    }
    expect(isBacklog({ ...issue, fixed_version: sprint }, backlogScope)).toBe(true);
  });
  it('commits and changes status in one explicit move', () => {
    expect(movePatch(issue, 'status-2', sprint, 7)).toEqual({ ...sprintPatch(7, 10), status_id: 2 });
    expect(movePatch({ ...issue, ...sprintPatch(7, 10) }, 'status-1', sprint, 7)).toEqual({});
  });
  it('removing in-progress work does NOT reset its status', () => {
    expect(movePatch({ ...issue, status: statuses[1], ...sprintPatch(7, 10) }, 'backlog', sprint, 7)).toEqual(sprintPatch(7, null));
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
    expect(matchesPatch(issue, { ...sprintPatch(7, null), estimated_hours: null, status_id: 1 })).toBe(true);
    expect(matchesPatch(issue, { assigned_to_id: 9 })).toBe(false);
    expect(matchesPatch({ ...issue, estimated_hours: 0 }, { estimated_hours: 0 })).toBe(true);
    expect(matchesPatch(issue, { estimated_hours: 0 })).toBe(false);
  });
  it('rejects missing and malformed membership without using Target version', () => {
    for (const fields of [undefined, [], [{ id: 7, value: ['invalid'] }], [{ id: 7, value: 'invalid' }]]) {
      expect(() => sprintValue({ ...issue, custom_fields: fields, fixed_version: sprint }, 7)).toThrow();
    }
    expect(sprintValue({ ...issue, fixed_version: sprint }, 7)).toBeNull();
    expect(matchesPatch({ ...issue, ...sprintPatch(7, 11) }, sprintPatch(7, 10))).toBe(false);
  });
  it('reads multiple Sprint values, appends and removes only the selected Sprint', () => {
    const multiple = { ...issue, custom_fields: [{ id: 7, multiple: true, value: ['20', '10'] }] };
    expect(sprintValues(multiple, 7)).toEqual([10, 20]);
    expect(movePatch(multiple, 'status-1', sprint, 7)).toEqual({});
    expect(movePatch(multiple, 'backlog', sprint, 7)).toEqual(sprintPatch(7, [20]));
    expect(membershipPatch(multiple, 7, 30, true)).toEqual(sprintPatch(7, [10, 20, 30]));
    expect(membershipPatch(multiple, 7, 10, true)).toEqual(sprintPatch(7, [10, 20]));
    expect(matchesPatch(multiple, sprintPatch(7, [20, 10]))).toBe(true);
    expect(matchesPatch(multiple, sprintPatch(7, [10]))).toBe(false);
    expect(isBacklog({ ...issue, custom_fields: [{ id: 7, multiple: true, value: [] }] }, backlogScope)).toBe(true);
    expect(membershipPatch({ ...issue, custom_fields: [{ id: 7, value: ['10'] }] }, 7, 10, false)).toEqual(sprintPatch(7, []));
  });
  it('includes all nested projects but not unrelated version-sharing projects', () => {
    expect(projectScope([{ id: 3, parent: { id: 2 } }, { id: 2, parent: { id: 1 } }, { id: 4 }], 1)).toEqual([1, 2, 3]);
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
