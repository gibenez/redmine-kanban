import { describe, it, expect } from 'vitest';
import { completedLane, closingStatuses, preferredClosingStatus } from '../src/swimlane-completion.js';

const trackers = ['Epic', 'Feature'];
const statuses = [
  { id: 1, name: 'Open', is_closed: false },
  { id: 5, name: 'Done', is_closed: true },
  { id: 9, name: 'Rejected', is_closed: true },
];
const issue = (id, parent, status = 5, tracker = 'Task') => ({
  id, tracker: { name: tracker }, status: { id: status },
  ...(parent ? { parent: { id: parent } } : {}),
});
const parent = issue(1, null, 1, 'Epic');

describe('completed Swimlanes', () => {
  it('returns the containing Swimlane when all its Cards are closed in the catalogue', () => {
    const cards = [issue(2, 1), issue(3, 1, 9)];
    const members = [parent, ...cards];
    expect(completedLane(members, members, trackers, statuses, 2)).toEqual({
      id: '1', parent, all: cards, visible: cards,
    });
  });

  it('checks full membership, including Cards hidden by filters or outside displayed statuses', () => {
    const members = [parent, issue(2, 1), issue(3, 1, 99)];
    // No visibility or displayed-Column subset is passed: every member counts.
    expect(completedLane(members, members, trackers, statuses, 2)).toBeNull();
    const catalogue = [...statuses, { id: 99, is_closed: false }];
    expect(completedLane(members, members, trackers, catalogue, 2)).toBeNull();
    catalogue[3].is_closed = true;
    expect(completedLane(members, members, trackers, catalogue, 2)?.all).toEqual(members.slice(1));
  });

  it('uses catalogue closure rather than abbreviated issue status metadata', () => {
    const card = issue(2, 1, 99);
    card.status.is_closed = true;
    expect(completedLane([parent, card], [], trackers, statuses, 2)).toBeNull();
    card.status = { id: 5, is_closed: false };
    expect(completedLane([parent, card], [], trackers, statuses, 2)?.parent).toBe(parent);
  });

  it('checks only the nearest planned Swimlane in nested lanes', () => {
    const nested = issue(2, 1, 1, 'Feature');
    const members = [parent, nested, issue(3, 2), issue(4, 1, 1)];
    expect(completedLane(members, members, trackers, statuses, 3)?.parent).toBe(nested);
    expect(completedLane(members, members, trackers, statuses, 4)).toBeNull();
    expect(completedLane(members, members, trackers, statuses, 2)).toBeNull();
  });

  it('connects through context ancestors without counting them as members', () => {
    const card = issue(3, 2);
    const members = [parent, card];
    const ancestors = [...members, issue(2, 1, 1, 'Feature'), issue(4, 1, 1)];
    expect(completedLane(members, ancestors, trackers, statuses, 3)?.all).toEqual([card]);
  });

  it('does not complete empty lanes, absent Cards, or Ungrouped', () => {
    expect(completedLane([], [], trackers, statuses, 2)).toBeNull();
    expect(completedLane([parent], [parent], trackers, statuses, 1)).toBeNull();
    expect(completedLane([parent, issue(2, 1)], [], trackers, statuses, 99)).toBeNull();
    expect(completedLane([issue(2, 1)], [parent], trackers, statuses, 2)).toBeNull();
  });

  it('does not offer completion for an already closed parent', () => {
    const members = [{ ...parent, status: { id: 9 } }, issue(2, 1)];
    expect(completedLane(members, members, trackers, statuses, 2)).toBeNull();
  });
});

describe('closing statuses', () => {
  it('intersects workflow IDs with closed catalogue statuses and excludes the current status', () => {
    const heading = { ...parent, status: { id: 9 }, allowed_statuses: [
      { id: 9 }, { id: 99, is_closed: true }, { id: 1, is_closed: true }, { id: 5 },
    ] };
    expect(closingStatuses(heading, statuses)).toEqual([statuses[1]]);
  });

  it('preserves catalogue order when multiple transitions are allowed', () => {
    expect(closingStatuses({ ...parent, allowed_statuses: [{ id: 9 }, { id: 5 }] }, statuses))
      .toEqual([statuses[1], statuses[2]]);
  });

  it('returns no choices for missing or empty workflow information or an empty catalogue', () => {
    expect(closingStatuses(parent, statuses)).toEqual([]);
    expect(closingStatuses({ ...parent, allowed_statuses: [] }, statuses)).toEqual([]);
    expect(closingStatuses({ ...parent, allowed_statuses: [{ id: 5 }] }, [])).toEqual([]);
  });
});

describe('preferred closing status', () => {
  const choices = statuses.slice(1);

  it('selects a present preference, including a stored string ID', () => {
    expect(preferredClosingStatus(choices, 9)).toBe(9);
    expect(preferredClosingStatus(choices, '5')).toBe(5);
  });

  it('falls back to the sole choice when the preference is missing or unavailable', () => {
    expect(preferredClosingStatus([choices[0]])).toBe(5);
    expect(preferredClosingStatus([choices[0]], 99)).toBe(5);
  });

  it('requires a choice when multiple statuses remain without a valid preference', () => {
    expect(preferredClosingStatus(choices)).toBe('');
    expect(preferredClosingStatus(choices, 99)).toBe('');
    expect(preferredClosingStatus([], 5)).toBe('');
  });
});
