import { groupSwimlanes } from './swimlanes.js';

export function completedLane(members, ancestors, trackers, statuses, cardId) {
  const closedIds = new Set(statuses.filter(status => status.is_closed === true).map(status => status.id));
  const lane = groupSwimlanes(members, members, trackers, ancestors)
    .find(lane => lane.all.some(card => card.id === cardId));
  return lane?.parent && lane.all.length &&
    !closedIds.has(lane.parent.status?.id) &&
    lane.all.every(card => closedIds.has(card.status?.id)) ? lane : null;
}

export function closingStatuses(parent, statuses) {
  const allowedIds = new Set((parent.allowed_statuses || []).map(status => status.id));
  return statuses.filter(status => status.is_closed === true &&
    allowedIds.has(status.id) && status.id !== parent.status?.id);
}

export function preferredClosingStatus(choices, preferredId) {
  const preferred = choices.find(status => String(status.id) === String(preferredId));
  return preferred ? preferred.id : choices.length === 1 ? choices[0].id : '';
}
