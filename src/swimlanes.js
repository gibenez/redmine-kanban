export const isSwimlane = (issue, trackers) => trackers.includes(issue.tracker?.name);

// Ancestors connect planned descendants to planned Swimlane parents; loading
// context never grants membership to an ancestor or descendant.
export async function loadAncestors(api, members) {
  const index = new Map(members.map(issue => [issue.id, issue]));
  for (const issue of members) {
    let current = issue;
    const seen = new Set([issue.id]);
    while (current.parent?.id && !seen.has(current.parent.id)) {
      const id = current.parent.id; seen.add(id);
      if (!index.has(id)) index.set(id, await api.issue(id));
      current = index.get(id);
    }
  }
  return [...index.values()];
}

export function groupSwimlanes(members, visible, trackers, ancestors = members) {
  const index = new Map([...ancestors, ...members].map(issue => [issue.id, issue]));
  const roots = new Map(members.filter(issue => isSwimlane(issue, trackers)).map(issue => [issue.id, issue]));
  const lanes = [...roots.values()].sort((a, b) => a.id - b.id)
    .map(parent => ({ id: String(parent.id), parent, all: [], visible: [] }));
  const byId = new Map(lanes.map(lane => [lane.parent.id, lane]));
  const ungrouped = { id: 'ungrouped', all: [], visible: [] };
  const visibleIds = new Set(visible.map(issue => issue.id));
  for (const issue of members) {
    if (roots.has(issue.id)) continue;
    let current = issue, lane = ungrouped;
    const seen = new Set([issue.id]);
    while (current.parent?.id && !seen.has(current.parent.id)) {
      seen.add(current.parent.id); current = index.get(current.parent.id);
      if (!current) break;
      if (byId.has(current.id)) { lane = byId.get(current.id); break; }
    }
    lane.all.push(issue);
    if (visibleIds.has(issue.id)) lane.visible.push(issue);
  }
  return ungrouped.all.length ? [...lanes, ungrouped] : lanes;
}
