import { describe, it, expect } from 'vitest';
import { emptySprintFilters, matchesSprintFilters, filteredSprint, sprintFilterChoices, createSprintFilterPreferences } from '../src/sprint-filters.js';

const issue = (id, overrides = {}) => ({ id, subject: `Login ${id}`, project: { id: 2, name: 'Module' }, tracker: { name: 'Task' }, priority: { id: 3, name: 'High' }, ...overrides });
const filters = overrides => ({ ...emptySprintFilters(), ...overrides });

describe('Sprint Card predicates', () => {
  it('combines OR within selections and AND across controls and search', () => {
    const row = issue(123, { assigned_to: { id: 7, name: 'Alice' } });
    expect(matchesSprintFilters(row, filters({ query: ' LOGIN ', project: ['1', '2'], assignee: ['7', '8'], priority: ['3'] }))).toBe(true);
    for (const mismatch of [{ query: 'absent' }, { project: ['1'] }, { assignee: ['none'] }, { priority: ['2'] }]) {
      expect(matchesSprintFilters(row, filters(mismatch))).toBe(false);
    }
    expect(matchesSprintFilters(issue(1), filters({ assignee: ['none'] }))).toBe(true);
  });
  it('supports exact numeric IDs, ID-only hashes, and literal title substrings', () => {
    const row = issue(123, { subject: 'Release 456 [Beta]' });
    for (const query of ['123', '#123', '  #123  ', '456', '[bETA]', '   ']) expect(matchesSprintFilters(row, filters({ query }))).toBe(true);
    for (const query of ['12', '#456', 'Release Beta', '.*', '#12']) expect(matchesSprintFilters(row, filters({ query }))).toBe(false);
  });
});

describe('filtered Sprint projection', () => {
  const parent = issue(1, { tracker: { name: 'Feature' }, project: { id: 1, name: 'Product' } });
  const nested = issue(2, { tracker: { name: 'Feature' }, parent: { id: 1 } });
  const child = issue(3, { parent: { id: 2 }, status: { id: 99 } });
  const ungrouped = issue(4);
  const members = [parent, nested, child, ungrouped];
  it('preserves roots and nearest grouping, excluding headings from matching and counts', () => {
    const result = filteredSprint(members, ['Feature'], members, filters({ query: '#3' }));
    expect(result.cards.map(row => row.id)).toEqual([3, 4]);
    expect(result.lanes.map(lane => lane.id)).toEqual(['2']);
    expect(result.lanes[0].visible).toEqual([child]);
    expect(filteredSprint(members, ['Feature'], members, filters({ query: '#1' })).lanes).toEqual([]);
    expect(filteredSprint(members, ['Feature'], members, filters({ project: ['1'] })).visible).toEqual([]);
  });
  it('restores empty headings when cleared and hides zero-match Ungrouped', () => {
    expect(filteredSprint(members, ['Feature'], members, filters()).lanes.map(lane => lane.id)).toEqual(['1', '2', 'ungrouped']);
    expect(filteredSprint(members, ['Feature'], members, filters({ query: '#4' })).lanes.map(lane => lane.id)).toEqual(['ungrouped']);
  });
  it('supports flat mode and complete unfiltered option sources', () => {
    const result = filteredSprint(members, [], members, filters({ query: '#3' }));
    expect(result.lanes).toBeNull();
    expect(result.cards).toHaveLength(4);
    expect(result.visible).toEqual([child]);
    const grouped = filteredSprint(members, ['Feature'], members, filters({ query: 'absent' }));
    expect(sprintFilterChoices(grouped.cards, 'project')).toEqual([['2', 'Module']]);
    expect(sprintFilterChoices(grouped.cards, 'assignee')).toEqual([['none', 'Unassigned']]);
  });
});

describe('Sprint filter persistence', () => {
  const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  };
  it('isolates projects, servers and users, preserves absent values, and normalizes server slashes', () => {
    const local = storage(), preferences = createSprintFilterPreferences('https://one/', 7, () => local);
    const saved = filters({ query: 'Login', project: ['999'], assignee: ['none'], priority: ['3'], tag: ['release', 'UI'] });
    preferences.write('1', saved);
    expect(preferences.read('2')).toEqual(filters());
    expect(createSprintFilterPreferences('https://one', 7, () => local).read('1')).toEqual(saved);
    expect(createSprintFilterPreferences('https://one', 8, () => local).read('1')).toEqual(filters());
    expect(createSprintFilterPreferences('https://two', 7, () => local).read('1')).toEqual(filters());
    preferences.write('1', filters());
    expect(preferences.read('1')).toEqual(filters());
  });
  it('handles unavailable storage and malformed data without losing in-memory selections', () => {
    const preferences = createSprintFilterPreferences('server', 1, () => { throw new Error('disabled'); });
    preferences.write(1, filters({ query: 'test' }));
    expect(preferences.read(1).query).toBe('test');
    const local = { getItem: () => '{broken' };
    expect(createSprintFilterPreferences('server', 1, () => local).read(1)).toEqual(filters());
  });
});
