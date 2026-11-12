import { assertTransition, matchesPatch, membershipPatch, sprintValues } from './domain.js';
import { isSwimlane } from './swimlanes.js';

// Limit network reads, not recursive visits: holding a slot while awaiting
// children would deadlock on a deep hierarchy. Background scans share a reader.
export function createHierarchyReader(api, { signal, cache = false } = {}) {
  let active = 0;
  const queue = [], reads = new Map();
  function drain() {
    while (active < 4 && queue.length) {
      const { id, resolve, reject } = queue.shift();
      if (signal?.aborted) { reject(signal.reason); continue; }
      active++;
      Promise.resolve().then(() => api.hierarchyIssue(id, { signal })).then(resolve, reject).finally(() => { active--; drain(); });
    }
  }
  return { hierarchyIssue(id) {
    if (cache && reads.has(id)) return reads.get(id);
    const read = new Promise((resolve, reject) => { queue.push({ id, resolve, reject }); drain(); });
    if (cache) reads.set(id, read);
    return read;
  } };
}

// Read each node, not just the abbreviated children embedded in Redmine responses.
export async function collectMissingSubtasks(api, parentId, scope) {
  const seen = new Set(), reader = createHierarchyReader(api);
  async function visit(id, parentId = null) {
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error('Invalid or cyclic issue hierarchy.');
    seen.add(id);
    const issue = await reader.hierarchyIssue(id);
    if (issue?.id !== id || !issue.project || !issue.tracker) throw new Error(`Unreadable hierarchy on #${id}.`);
    if (!scope.projectIds.includes(issue.project.id)) {
      if (parentId === null) throw new Error('Parent moved outside the product hierarchy.');
      return [];
    }
    if (parentId !== null && issue.parent?.id !== parentId) throw new Error(`Hierarchy changed on #${id}. Refresh before planning.`);
    const missing = [];
    if (parentId !== null && !isSwimlane(issue, scope.swimlaneTrackers)) {
      if (!sprintValues(issue, scope.sprintFieldId).includes(scope.sprintId)) {
        missing.push(issue);
      }
    }
    if (issue.children != null && !Array.isArray(issue.children)) throw new Error(`Unreadable children on #${id}.`);
    const descendants = await Promise.all((issue.children || []).map(child => visit(child.id, id)));
    return [...missing, ...descendants.flat()];
  }
  return visit(parentId);
}

// Preflight all reads before any writes. A failed/uncertain write ends the batch.
export async function planDescendants(api, parentId, scope, { includeParent = false, openedStatusId } = {}) {
  const report = { added: [], failed: [], notAttempted: [], error: null };
  let pending = [];
  const parents = new Map();
  const freshPatch = issue => {
    if (!scope.projectIds.includes(issue.project?.id)) throw new Error(`Issue #${issue.id} moved outside the product hierarchy.`);
    if (issue.id !== parentId && isSwimlane(issue, scope.swimlaneTrackers)) throw new Error(`Tracker changed on #${issue.id}. Refresh before planning.`);
    if (parents.has(issue.id) && issue.parent?.id !== parents.get(issue.id)) throw new Error(`Hierarchy changed on #${issue.id}. Refresh before planning.`);
    const patch = membershipPatch(issue, scope.sprintFieldId, scope.sprintId, true);
    if (includeParent && issue.id === parentId) {
      if (!isSwimlane(issue, scope.swimlaneTrackers)) throw new Error('The parent is no longer Swimlane-capable.');
      if (issue.status.id !== openedStatusId) patch.status_id = openedStatusId;
      assertTransition(issue, patch);
    }
    return Object.fromEntries(Object.entries(patch).filter(([key, value]) => !matchesPatch(issue, { [key]: value })));
  };
  const checkSprint = async () => {
    const { version } = await api.request(`/versions/${scope.sprintId}.json`);
    if (version?.status !== 'open') throw new Error('This Sprint is no longer open.');
  };
  try {
    await checkSprint();
    const descendants = await collectMissingSubtasks(api, parentId, scope);
    for (const issue of descendants) parents.set(issue.id, issue.parent.id);
    pending = [...(includeParent ? [parentId] : []), ...descendants.map(issue => issue.id)];
    for (const id of pending) freshPatch(await api.issue(id));
  } catch (error) {
    report.error = `Preflight failed: ${error.message}`; report.notAttempted = pending;
    return report;
  }
  for (const [index, id] of pending.entries()) {
    try {
      const fresh = await api.issue(id);
      const patch = freshPatch(fresh);
      await checkSprint();
      if (Object.keys(patch).length) {
        await api.update(id, patch);
        if (!matchesPatch(await api.issue(id), patch)) throw new Error('Redmine did not retain the requested changes.');
      }
      report.added.push(id);
    } catch (error) {
      report.failed.push(id); report.notAttempted = pending.slice(index + 1); report.error = error.message;
      break;
    }
  }
  return report;
}
