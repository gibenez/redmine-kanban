import { matchesPatch } from './domain.js';
import { saveBuildIssue, sprintRelations } from './build-sprints.js';

export const isSwimlane = (issue, trackers) => trackers.includes(issue.tracker?.name);

// Ancestors are presentation context, never implicit Sprint members. This also keeps
// grandchildren grouped when an intermediate issue is independently removed.
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
  const owner = issue => {
    let root = roots.get(issue.id), current = issue;
    const seen = new Set([issue.id]);
    while (current.parent?.id && !seen.has(current.parent.id)) {
      seen.add(current.parent.id); current = index.get(current.parent.id);
      if (!current) break;
      if (roots.has(current.id)) root = current;
    }
    return root;
  };
  const lanes = [...roots.values()].filter(issue => owner(issue)?.id === issue.id)
    .sort((a, b) => a.id - b.id).map(parent => ({ id: String(parent.id), parent, all: [], visible: [] }));
  const byId = new Map(lanes.map(lane => [lane.parent.id, lane]));
  const ungrouped = { id: 'ungrouped', all: [], visible: [] };
  const visibleIds = new Set(visible.map(issue => issue.id));
  for (const issue of members) {
    const root = owner(issue);
    if (root?.id === issue.id) continue;
    const lane = byId.get(root?.id) || ungrouped;
    lane.all.push(issue);
    if (visibleIds.has(issue.id)) lane.visible.push(issue);
  }
  return [...lanes, ungrouped];
}

// Read the complete visible hierarchy before any write. A denied child aborts the
// operation rather than silently treating an incomplete hierarchy as complete.
export async function collectHierarchy(api, rootId, projectId) {
  const issues = [], excluded = [], seen = new Set(), queue = [rootId];
  while (queue.length) {
    const id = Number(queue.shift());
    if (seen.has(id)) continue;
    seen.add(id);
    const issue = await api.hierarchyIssue(id);
    if (!issue || !Array.isArray(issue.children || [])) throw new Error(`Cannot read the hierarchy of #${id}.`);
    (issue.project.id === Number(projectId) ? issues : excluded).push(issue);
    queue.push(...(issue.children || []).map(child => child.id));
  }
  return { issues, excluded };
}

export async function groupPlan(api, rootId, sprint, projectId, add, options) {
  if (sprint.status !== 'open') throw new Error('Closed sprints are read only.');
  const hierarchy = await collectHierarchy(api, rootId, projectId);
  const root = hierarchy.issues.find(issue => issue.id === rootId);
  if (!root || !isSwimlane(root, options.trackers)) throw new Error('The Swimlane parent has changed. Refresh before retrying.');
  let selected;
  if (sprint.source === 'build') {
    const build = await api.issue(sprint.id);
    if (options.closedStatusIds.includes(build.status.id) || build.tracker.id !== options.trackerId || build.project.id !== Number(projectId) || build.category?.id !== sprint.category?.id) throw new Error('The Sprint has changed. Refresh before planning.');
    selected = new Set((await api.relations(sprint.id)).flatMap(relation => {
      const id = relation.issue_id === sprint.id ? relation.issue_to_id : relation.issue_id;
      return sprintRelations([relation], id, sprint.id).length ? [id] : [];
    }));
  } else {
    const { version } = await api.request(`/versions/${sprint.id}.json`);
    if (version.status !== 'open') throw new Error('This Sprint is no longer open. Refresh before planning.');
    selected = new Set(hierarchy.issues.filter(issue => issue.fixed_version?.id === sprint.id).map(issue => issue.id));
  }
  if (sprint.source === 'build' && hierarchy.issues.some(issue => issue.tracker.id === options.trackerId)) throw new Error('A Build Sprint cannot itself be planned as a member.');
  const targets = hierarchy.issues.filter(issue => add ? !selected.has(issue.id) : selected.has(issue.id));
  const replacements = sprint.source === 'build' || !add ? [] : targets.filter(issue => issue.fixed_version && issue.fixed_version.id !== sprint.id);
  return { ...hierarchy, targets, replacements, root, add };
}

// Independent writes are verified, including after a lost response. Never retry or
// roll back automatically: another user's changes must not be overwritten.
export async function executeGroup(api, plan, sprint, options) {
  const succeeded = [], failed = [];
  for (const issue of plan.targets) {
    if (options.active && !options.active()) break;
    try {
      if (sprint.source === 'build') {
        await saveBuildIssue(api, issue.id, sprint, { sprint_member: plan.add }, options);
      } else {
        const fresh = await api.issue(issue.id);
        if (fresh.project.id !== plan.root.project.id) throw new Error('Issue moved to another project.');
        // Removal must never clear membership that changed to a different Sprint.
        if (!plan.add && fresh.fixed_version?.id !== sprint.id) throw new Error('Sprint membership changed; removal skipped.');
        if (plan.add && fresh.fixed_version?.id !== issue.fixed_version?.id) throw new Error('Sprint membership changed; refresh and confirm again.');
        const { version } = await api.request(`/versions/${sprint.id}.json`);
        if (version.status !== 'open') throw new Error('Sprint is no longer open.');
        const patch = { fixed_version_id: plan.add ? sprint.id : null };
        let failure;
        try { await api.update(issue.id, patch); } catch (error) { failure = error; }
        const confirmed = await api.issue(issue.id);
        if (failure || !matchesPatch(confirmed, patch)) throw new Error(`${failure?.message || 'Membership not retained.'} Observed Sprint: ${confirmed.fixed_version?.id || 'none'}.`);
      }
      succeeded.push(issue.id);
    } catch (error) { failed.push({ id: issue.id, message: error.message }); }
  }
  return { succeeded, failed };
}
