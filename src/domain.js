export function validateConfig(raw, statuses) {
  const backlogStatusId = Number(raw.backlogStatusId);
  const columnStatusIds = raw.columnStatusIds?.map(Number);
  if (!Number.isInteger(backlogStatusId) || backlogStatusId <= 0 || !Array.isArray(columnStatusIds) || !columnStatusIds.length || columnStatusIds.some(id => !Number.isInteger(id) || id <= 0) || new Set(columnStatusIds).size !== columnStatusIds.length) {
    throw new Error('Configure a positive backlogStatusId and a nonempty, unique columnStatusIds list in config.json.');
  }
  for (const id of [backlogStatusId, ...columnStatusIds]) {
    if (!statuses.some(status => status.id === id)) throw new Error(`Configured status ${id} is not available in Redmine.`);
  }
  if (statuses.find(s => s.id === backlogStatusId).is_closed) throw new Error('The backlog status must not be a closed status.');
  const publicUrl = new URL(raw.redminePublicUrl, window.location.origin);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error('redminePublicUrl must be an HTTP(S) URL without credentials, a query, or a fragment.');
  return { ...raw, backlogStatusId, columnStatusIds, redminePublicUrl: publicUrl.href.replace(/\/$/, ''), refreshSeconds: Math.max(15, Number(raw.refreshSeconds) || 60) };
}

// The Backlog is every OPEN unplanned issue, narrowed to the configured New status unless
// the Backlog Scope is widened. Closed unplanned issues are never shown.
export function isBacklog(issue, { backlogStatusId, allUnplanned = false, closedStatusIds = [] }) {
  if (issue.fixed_version) return false;
  return allUnplanned ? !closedStatusIds.includes(issue.status.id) : issue.status.id === backlogStatusId;
}
export function effort(issues) {
  return issues.reduce((total, issue) => ({ hours: total.hours + (Number(issue.estimated_hours) || 0), unestimated: total.unestimated + (issue.estimated_hours == null || issue.estimated_hours === '' ? 1 : 0), count: total.count + 1 }), { hours: 0, unestimated: 0, count: 0 });
}
export function movePatch(issue, target, sprint) {
  if (sprint?.status !== 'open') throw new Error('Select an open sprint before changing issues.');
  if (target === 'backlog') return issue.fixed_version ? { fixed_version_id: null } : {};
  const match = /^status-(\d+)$/.exec(target);
  if (!match) throw new Error('Unknown board column.');
  const patch = {};
  if (issue.fixed_version?.id !== sprint.id) patch.fixed_version_id = sprint.id;
  if (issue.status.id !== Number(match[1])) patch.status_id = Number(match[1]);
  return patch;
}
export function parseEstimate(value) {
  if (value.trim() === '') return null;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Estimated hours must be a nonnegative number, or blank for unestimated.');
  return hours;
}
export function assertTransition(issue, patch) {
  if (!patch.status_id || patch.status_id === issue.status.id) return;
  if (!Array.isArray(issue.allowed_statuses)) throw new Error('Redmine did not provide allowed statuses. Status changes require Redmine 5.0+ with workflow information.');
  if (!issue.allowed_statuses.some(status => status.id === patch.status_id)) throw new Error('Your Redmine workflow does not allow this status transition.');
}
export function matchesPatch(issue, patch) {
  const values = { fixed_version_id: issue.fixed_version?.id ?? null, status_id: issue.status.id, assigned_to_id: issue.assigned_to?.id ?? null, estimated_hours: issue.estimated_hours ?? null };
  return Object.entries(patch).every(([key, value]) => value == null ? values[key] == null : values[key] != null && Number(values[key]) === Number(value));
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
