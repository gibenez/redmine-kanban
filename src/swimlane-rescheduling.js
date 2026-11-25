import { matchesPatch, membershipPatch, sprintValues } from './domain.js';
import { createHierarchyReader } from './descendant-planning.js';
import { isSwimlane } from './swimlanes.js';

const created = version => version?.created_on ? Date.parse(version.created_on) : NaN;
const compareVersions = (a, b, direction = 1) => {
  const left = created(a), right = created(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return direction * (left - right || Number(a.id) - Number(b.id));
  if (Number.isFinite(left)) return -1;
  if (Number.isFinite(right)) return 1;
  return direction * (Number(a.id) - Number(b.id));
};

// Callers supply only product-owned/shared versions, just as for the Sprint selector.
export function reschedulingTargets(versions, sourceSprintId) {
  const source = versions.find(version => Number(version.id) === Number(sourceSprintId));
  const targets = versions.filter(version => version.status === 'open' && Number(version.id) !== Number(sourceSprintId)).sort(compareVersions);
  const selected = Number.isFinite(created(source))
    ? targets.find(version => Number.isFinite(created(version)) && compareVersions(version, source) > 0)
    : null;
  // Display newest first without changing the nearest chronological successor.
  targets.sort((a, b) => compareVersions(a, b, -1));
  return { targets, selectedId: selected?.id ?? '' };
}

async function checkVersion(api, id, scope) {
  const { version } = await api.request(`/versions/${id}.json`);
  if (version?.id !== id || version.status !== 'open') throw new Error('The source and target Sprints must still be open.');
  if (scope.projectId != null) {
    if (Number(version.project?.id) !== Number(scope.projectId)) throw new Error('Sprint is not owned by the Product Project.');
    if (version.sharing != null && !['descendants', 'hierarchy', 'tree', 'system'].includes(version.sharing)) {
      throw new Error('Sprint is not shared with the Product Project hierarchy.');
    }
  }
}

function validateIssue(issue, id, scope) {
  if (issue?.id !== id || !issue.project || !issue.tracker || !Number.isSafeInteger(issue.status?.id)) throw new Error(`Unreadable issue #${id}.`);
  if (!scope.projectIds.includes(issue.project.id)) throw new Error(`Issue #${id} moved outside the product hierarchy.`);
}

function validateRoot(issue, scope) {
  if (scope.closedStatusIds.includes(issue.status.id)) throw new Error('The parent is no longer open.');
  if (!isSwimlane(issue, scope.swimlaneTrackers)) throw new Error('The parent is no longer Swimlane-capable.');
  if (!sprintValues(issue, scope.sprintFieldId).includes(scope.sprintId)) throw new Error('The parent no longer belongs to the source Sprint.');
}

async function scan(api, parentId, scope) {
  const reader = createHierarchyReader(api), seen = new Set(), nodes = [];
  async function visit(id, parent = null) {
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error('Invalid or cyclic issue hierarchy.');
    seen.add(id);
    const issue = await reader.hierarchyIssue(id);
    if (issue?.id !== id || !issue.project) throw new Error(`Unreadable hierarchy on #${id}.`);
    if (!scope.projectIds.includes(issue.project.id) && parent !== null) return;
    validateIssue(issue, id, scope);
    if (parent !== null && issue.parent?.id !== parent) throw new Error(`Hierarchy changed on #${id}. Refresh before rescheduling.`);
    if (parent === null) validateRoot(issue, scope);
    if (issue.children != null && !Array.isArray(issue.children)) throw new Error(`Unreadable children on #${id}.`);
    nodes.push(issue);
    for (const child of issue.children || []) await visit(child.id, id);
  }
  await visit(parentId);
  return nodes;
}

export async function collectReschedulingIssues(api, parentId, scope) {
  await checkVersion(api, scope.sprintId, scope);
  return scan(api, parentId, scope);
}

const sameIds = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id));
const signature = nodes => JSON.stringify(nodes.map(issue => [issue.id, issue.parent?.id ?? null, issue.project.id, issue.tracker.name, issue.status.id]).sort((a, b) => a[0] - b[0]));

// All reads are preflighted. Never compensate or retry an uncertain write.
export async function rescheduleSwimlane(api, parentId, scope, targetSprintId, { expectedIds } = {}) {
  const report = { added: [], failed: [], notAttempted: [], error: null };
  let pending = expectedIds ? [...expectedIds] : [], nodes;
  const checkVersions = async () => {
    await checkVersion(api, scope.sprintId, scope);
    await checkVersion(api, targetSprintId, scope);
  };
  const freshPatch = (issue, original) => {
    validateIssue(issue, original.id, scope);
    if (issue.parent?.id !== original.parent?.id) throw new Error(`Hierarchy changed on #${issue.id}. Refresh before rescheduling.`);
    if (issue.id === parentId) validateRoot(issue, scope);
    return membershipPatch(issue, scope.sprintFieldId, targetSprintId, true, { replace: true });
  };
  try {
    if (!Number.isSafeInteger(targetSprintId) || targetSprintId <= 0 || targetSprintId === scope.sprintId) throw new Error('Select a different target Sprint.');
    await checkVersions();
    nodes = await scan(api, parentId, scope);
    const ids = nodes.map(issue => issue.id);
    if (expectedIds && !sameIds(ids, expectedIds)) throw new Error('Eligible issues changed. Refresh before rescheduling.');
    pending = ids;
    for (const issue of nodes) freshPatch(await api.issue(issue.id), issue);
    // Recheck the complete hierarchy for changes before the first write.
    if (signature(await scan(api, parentId, scope)) !== signature(nodes)) throw new Error('Hierarchy changed. Refresh before rescheduling.');
    await checkVersions();
  } catch (error) {
    report.error = `Preflight failed: ${error.message}`;
    report.notAttempted = pending;
    return report;
  }
  for (const [index, id] of pending.entries()) {
    try {
      const fresh = await api.issue(id);
      const patch = freshPatch(fresh, nodes.find(issue => issue.id === id));
      await checkVersions();
      if (!matchesPatch(fresh, patch)) {
        await api.update(id, patch);
        if (!matchesPatch(await api.issue(id), patch)) throw new Error('Redmine did not retain the requested changes.');
      }
      report.added.push(id);
    } catch (error) {
      report.failed.push(id);
      report.notAttempted = pending.slice(index + 1);
      report.error = error.message;
      break;
    }
  }
  return report;
}
