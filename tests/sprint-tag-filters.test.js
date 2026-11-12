import { it, expect } from 'vitest';
import { emptySprintFilters, filteredSprint } from '../src/sprint-filters.js';

const parent = (id, tags, parentId) => ({ id, tracker: { name: 'Feature' }, tags, ...(parentId ? { parent: { id: parentId } } : {}) });
const card = (id, parentId, tags = []) => ({ id, subject: `Card ${id}`, tracker: { name: 'Task' }, parent: { id: parentId }, tags });
const members = [parent(1, ['outer', 'shared']), parent(2, ['inner', 'shared'], 1), parent(3, ['empty']), card(10, 1), card(11, 2, ['outer']), card(12, 99, ['inner'])];
const project = overrides => filteredSprint(members, ['Feature'], members, { ...emptySprintFilters(), ...overrides });

it('matches the nearest planned Swimlane tags, not Card or outer ancestor tags', () => {
  const result = project({ tag: ['outer'] });
  expect(result.visible.map(row => row.id)).toEqual([10]);
  expect(result.lanes.map(lane => lane.id)).toEqual(['1']);
  expect(result.cards).toHaveLength(3);
});

it('uses OR for tags and AND with search, and keeps choices independent of matches', () => {
  const result = project({ tag: ['outer', 'inner'], query: '#11' });
  expect(result.visible.map(row => row.id)).toEqual([11]);
  expect(result.tagChoices).toEqual([['empty', 'empty'], ['inner', 'inner'], ['outer', 'outer'], ['shared', 'shared']]);
  expect(project({ tag: ['shared'] }).visible.map(row => row.id)).toEqual([10, 11]);
  expect(project({ tag: ['OUTER'] }).visible).toEqual([]);
  expect(project({ tag: ['empty'] }).lanes).toEqual([]);
});

it('restores all Cards and empty headings when cleared, with no tag matches in flat mode', () => {
  expect(project({}).lanes.map(lane => lane.id)).toEqual(['1', '2', '3', 'ungrouped']);
  const flat = filteredSprint(members, [], members, { ...emptySprintFilters(), tag: ['outer'] });
  expect(flat.visible).toEqual([]);
  expect(flat.tagChoices).toEqual([]);
});
