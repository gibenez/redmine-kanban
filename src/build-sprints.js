import { assertTransition, matchesPatch } from './domain.js';

export function buildTracker(project, configuredId) {
  const tracker = configuredId ? project.trackers?.find(t => t.id === configuredId) : project.trackers?.find(t => t.name === 'Build');
  if (!tracker) throw new Error(`Build tracker${configuredId ? ` #${configuredId}` : ' named "Build"'} is not available in project "${project.name}". Configure buildTrackerId with an enabled tracker ID.`);
  return tracker.id;
}
export function asBuildSprint(issue, closedStatusIds) {
  return { ...issue, source: 'build', name: `${issue.subject} (#${issue.id})`, status: closedStatusIds.includes(issue.status.id) ? 'closed' : 'open' };
}
// Relates is symmetric; never interpret blocks, duplicates, precedes, etc. as membership.
export function relatedId(relation, buildId) {
  if (relation.relation_type !== 'relates') return null;
  // REST serializes the source as issue_id, not the model's issue_from_id.
  if (relation.issue_id === buildId) return relation.issue_to_id;
  if (relation.issue_to_id === buildId) return relation.issue_id;
  return null;
}
export function sprintRelations(relations, issueId, sprintId) {
  return relations.filter(relation => relatedId(relation, sprintId) === issueId);
}

// Redmine has no transaction spanning issue fields and relations. Verify both and report
// observed state even when a response is lost. Never roll back somebody else's concurrent edit.
export async function saveBuildIssue(api, id, sprint, patch, { closedStatusIds, trackerId }) {
  const { sprint_member: membership, ...fields } = patch;
  if ('fixed_version_id' in fields) throw new Error('Build planning must not modify target versions.');
  let failure;
  try {
    const [fresh, build] = await Promise.all([api.issue(id), api.issue(sprint.id)]);
    if (closedStatusIds.includes(build.status.id)) throw new Error('This sprint is no longer open. Refresh before planning.');
    if (build.tracker.id !== trackerId || build.project.id !== sprint.project.id || build.project.id !== fresh.project.id || build.category?.id !== sprint.category?.id || fresh.tracker.id === trackerId) throw new Error('The sprint or issue is no longer valid for this project. Refresh before planning.');
    assertTransition(fresh, fields);
    if (membership !== undefined) {
      const relations = sprintRelations(await api.relations(sprint.id), id, sprint.id);
      if (membership && !relations.length) await api.relate(sprint.id, id);
      if (!membership) for (const relation of relations) await api.unrelate(relation.id);
    }
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => !matchesPatch(fresh, { [key]: value })));
    if (Object.keys(changed).length) await api.update(id, changed);
  } catch (error) { failure = error; }
  let confirmed, relations;
  try { [confirmed, relations] = await Promise.all([api.issue(id), api.relations(sprint.id)]); }
  catch (error) { throw new Error(`${failure?.message || 'Write attempted.'} Current state could not be verified: ${error.message} Refresh before retrying; changes may already have succeeded.`); }
  const present = sprintRelations(relations, id, sprint.id).length > 0;
  const fieldsMatch = matchesPatch(confirmed, fields);
  if (failure || !fieldsMatch || (membership !== undefined && membership !== present)) {
    throw new Error(`${failure?.message || 'Redmine did not retain all requested changes.'} Observed sprint membership: ${present ? 'present' : 'absent'}. Requested field values: ${fieldsMatch ? 'confirmed' : 'not retained'}. No rollback was attempted.`);
  }
  return confirmed;
}
