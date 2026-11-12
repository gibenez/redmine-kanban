import { groupSwimlanes, isSwimlane } from './swimlanes.js';

export const emptySprintFilters = () => ({ query: '', project: [], assignee: [], priority: [], tag: [] });
export const sprintFiltersActive = filters => Boolean(filters.query.trim() || ['project', 'assignee', 'priority', 'tag'].some(key => filters[key]?.length));

export function matchesSprintFilters(issue, filters) {
  const query = filters.query.trim().toLowerCase();
  const searchMatch = /^#\d+$/.test(query) ? Number(query.slice(1)) === issue.id
    : !query || (/^\d+$/.test(query) && Number(query) === issue.id) || String(issue.subject || '').toLowerCase().includes(query);
  return searchMatch && ['project', 'assignee', 'priority'].every(key => {
    const value = key === 'assignee' ? issue.assigned_to?.id ?? 'none' : issue[key]?.id;
    return !filters[key].length || filters[key].includes(String(value));
  });
}

export function filteredSprint(members, trackers, ancestors, filters) {
  const cards = members.filter(issue => !isSwimlane(issue, trackers));
  const matching = cards.filter(issue => matchesSprintFilters(issue, filters));
  const grouped = trackers.length ? groupSwimlanes(members, matching, trackers, ancestors) : null;
  const tagChoices = [...new Set((grouped || []).flatMap(lane => lane.parent?.tags || []))].sort((a, b) => a.localeCompare(b)).map(tag => [tag, tag]);
  const tagFiltered = Boolean(filters.tag?.length);
  const lanes = grouped?.filter(lane => !tagFiltered || lane.parent?.tags?.some(tag => filters.tag.includes(tag)))
    .filter(lane => !sprintFiltersActive(filters) || lane.visible.length) ?? null;
  const visible = tagFiltered ? (lanes || []).flatMap(lane => lane.visible) : matching;
  return { cards, visible, lanes, tagChoices };
}

export function sprintFilterChoices(cards, key) {
  const choices = new Map();
  for (const issue of cards) {
    const field = key === 'assignee' ? issue.assigned_to : issue[key];
    if (field) choices.set(String(field.id), field.name || `${key} #${field.id}`);
    else if (key === 'assignee') choices.set('none', 'Unassigned');
  }
  return [...choices].sort((a, b) => a[1].localeCompare(b[1]));
}

export function createSprintFilterPreferences(server, userId, storage = () => localStorage) {
  const prefix = `redmine-sprint-board.card-filters:${JSON.stringify([server.replace(/\/+$/, ''), String(userId)])}:`;
  const memory = new Map();
  function normalize(value) {
    const result = emptySprintFilters();
    if (typeof value?.query === 'string') result.query = value.query;
    for (const key of ['project', 'assignee', 'priority']) {
      if (Array.isArray(value?.[key])) result[key] = [...new Set(value[key].filter(id => typeof id === 'string' && (/^[1-9]\d*$/.test(id) || (key === 'assignee' && id === 'none'))))];
    }
    if (Array.isArray(value?.tag)) result.tag = [...new Set(value.tag.filter(tag => typeof tag === 'string' && tag.length))];
    return result;
  }
  return {
    read(projectId) {
      try {
        const raw = storage().getItem(prefix + projectId);
        if (raw) memory.set(String(projectId), normalize(JSON.parse(raw)));
      } catch { /* Retain this tab's preferences if storage is unavailable. */ }
      return normalize(memory.get(String(projectId)));
    },
    write(projectId, filters) {
      const value = normalize(filters);
      memory.set(String(projectId), value);
      try { storage().setItem(prefix + projectId, JSON.stringify(value)); } catch { /* Optional preference. */ }
    },
  };
}
