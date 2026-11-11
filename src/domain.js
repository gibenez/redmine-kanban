export function validateConfig(raw, statuses) {
  const backlogStatusId = Number(raw.backlogStatusId);
  const openedStatusId = Number(raw.openedStatusId);
  if (!Number.isSafeInteger(openedStatusId) || openedStatusId <= 0) throw new Error('Configure openedStatusId / OPENED_STATUS_ID with the opened status ID.');
  if (!statuses.some(status => status.id === openedStatusId && !status.is_closed)) throw new Error('The opened status must exist and must not be closed.');
  const columnStatusIds = raw.columnStatusIds?.map(Number);
  if (!Number.isInteger(backlogStatusId) || backlogStatusId <= 0 || !Array.isArray(columnStatusIds) || !columnStatusIds.length || columnStatusIds.some(id => !Number.isInteger(id) || id <= 0) || new Set(columnStatusIds).size !== columnStatusIds.length) {
    throw new Error('Configure a positive backlogStatusId and a nonempty, unique columnStatusIds list in config.json.');
  }
  for (const id of [backlogStatusId, ...columnStatusIds]) {
    if (!statuses.some(status => status.id === id)) throw new Error(`Configured status ${id} is not available in Redmine.`);
  }
  if (statuses.find(s => s.id === backlogStatusId).is_closed) throw new Error('The backlog status must not be a closed status.');
  if (raw.sprintSource && raw.sprintSource !== 'version') throw new Error('Build-based Sprints are no longer supported. Remove sprintSource/SPRINT_SOURCE and buildTrackerId/BUILD_TRACKER_ID from deployment configuration. Configure the Sprint Version custom field; existing Redmine data is not migrated.');
  const { sprintSource, buildTrackerId, ...current } = raw;
  const sprintFieldId = Number(raw.sprintFieldId);
  if (!Number.isSafeInteger(sprintFieldId) || sprintFieldId <= 0) throw new Error('Configure sprintFieldId / SPRINT_FIELD_ID with the ID of a Version custom field. Target version is not used for Sprint membership.');
  const swimlaneTrackers = raw.swimlaneTrackers ?? ['Feature', 'Bug', 'Improvement'];
  if (!Array.isArray(swimlaneTrackers) || swimlaneTrackers.some(name => typeof name !== 'string' || !name.trim())) throw new Error('swimlaneTrackers must be a list of nonempty tracker names.');
  const publicUrl = new URL(raw.redminePublicUrl, window.location.origin);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error('redminePublicUrl must be an HTTP(S) URL without credentials, a query, or a fragment.');
  return { ...current, openedStatusId, sprintFieldId, swimlaneTrackers: [...new Set(swimlaneTrackers.map(name => name.trim()))], backlogStatusId, columnStatusIds, redminePublicUrl: publicUrl.href.replace(/\/$/, ''), refreshSeconds: Math.max(15, Number(raw.refreshSeconds) || 60) };
}

export const hasSprintField = (issue, fieldId) => Boolean(issue.custom_fields?.some(field => Number(field.id) === Number(fieldId)));
export function sprintValue(issue, fieldId) {
  return sprintValues(issue, fieldId)[0] ?? null;
}
export function sprintValues(issue, fieldId) {
  const field = issue.custom_fields?.find(field => Number(field.id) === Number(fieldId));
  if (!field || !Object.hasOwn(field, 'value')) throw new Error(`Sprint field ${fieldId} is unavailable on #${issue.id}. Check field configuration and visibility.`);
  const values = Array.isArray(field.value) ? field.value : field.value == null || field.value === '' ? [] : [field.value];
  const ids = values.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(`Invalid Sprint value on #${issue.id}. Configure a Version custom field.`);
  return [...new Set(ids)].sort((a, b) => a - b);
}
export const sprintPatch = (fieldId, value) => ({ custom_fields: [{ id: fieldId, value: Array.isArray(value) ? value.map(String) : value == null ? '' : String(value) }] });
export function membershipPatch(issue, fieldId, sprintId, add) {
  const field = issue.custom_fields?.find(field => Number(field.id) === Number(fieldId));
  const current = sprintValues(issue, fieldId);
  const next = add ? [...new Set([...current, sprintId])] : current.filter(id => id !== sprintId);
  if (!field.multiple && !Array.isArray(field.value) && next.length > 1) throw new Error('Enable multiple values on the Sprint field before adding another Sprint.');
  return sprintPatch(fieldId, field.multiple || Array.isArray(field.value) ? next : next[0] ?? null);
}
export function projectScope(projects, rootId) {
  const ids = new Set([Number(rootId)]);
  let previous;
  do { previous = ids.size; for (const project of projects) if (ids.has(Number(project.parent?.id))) ids.add(Number(project.id)); } while (previous !== ids.size);
  return [...ids];
}

// Only Swimlane-capable issues with no Sprint are eligible for the Backlog.
export function isBacklog(issue, { sprintFieldId, swimlaneTrackers = [], showClosedParents = false, closedStatusIds = [] }) {
  if (!hasSprintField(issue, sprintFieldId)) return false;
  if (sprintValues(issue, sprintFieldId).length) return false;
  if (!swimlaneTrackers.includes(issue.tracker?.name)) return false;
  return showClosedParents || !closedStatusIds.includes(issue.status.id);
}
export function effort(issues) {
  return issues.reduce((total, issue) => ({ hours: total.hours + (Number(issue.estimated_hours) || 0), unestimated: total.unestimated + (issue.estimated_hours == null || issue.estimated_hours === '' ? 1 : 0), count: total.count + 1 }), { hours: 0, unestimated: 0, count: 0 });
}
export function movePatch(issue, target, sprint, fieldId) {
  if (sprint?.status !== 'open') throw new Error('Select an open sprint before changing issues.');
  if (target === 'backlog') return sprintValues(issue, fieldId).includes(sprint.id) ? membershipPatch(issue, fieldId, sprint.id, false) : {};
  const match = /^status-(\d+)$/.exec(target);
  if (!match) throw new Error('Unknown board column.');
  const patch = {};
  if (!sprintValues(issue, fieldId).includes(sprint.id)) Object.assign(patch, membershipPatch(issue, fieldId, sprint.id, true));
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
  const values = { status_id: issue.status.id, assigned_to_id: issue.assigned_to?.id ?? null, estimated_hours: issue.estimated_hours ?? null };
  return Object.entries(patch).every(([key, value]) => key === 'custom_fields'
    ? value.every(field => {
      const actual = sprintValues(issue, field.id);
      const expected = [...new Set((Array.isArray(field.value) ? field.value : field.value === '' ? [] : [field.value]).map(Number))].sort((a, b) => a - b);
      return JSON.stringify(actual) === JSON.stringify(expected);
    })
    : value == null ? values[key] == null : values[key] != null && Number(values[key]) === Number(value));
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
