import { projectScope, sprintValues, sprintPatch, matchesPatch } from './domain.js';
import { isSwimlane } from './swimlanes.js';

export function cardTrackers(project, swimlaneTrackers) {
  return (project?.trackers || []).filter(tracker => !swimlaneTrackers.includes(tracker.name));
}

export function subtaskProjects(projects, scope) {
  const ids = projectScope(projects, scope.projectId);
  return projects.filter(project => ids.includes(project.id) && cardTrackers(project, scope.swimlaneTrackers).length);
}

export function assertSubtaskContext(parent, version, projects, scope) {
  if (version?.id !== scope.sprintId || version.status !== 'open') throw new Error('This Sprint is no longer open.');
  if (!projectScope(projects, scope.projectId).includes(parent.project?.id)) throw new Error('The parent moved outside the product hierarchy.');
  if (!isSwimlane(parent, scope.swimlaneTrackers)) throw new Error('The parent is no longer a Swimlane-capable issue.');
  if (scope.closedStatusIds.includes(parent.status?.id)) throw new Error('The parent is now closed.');
  if (!sprintValues(parent, scope.sprintFieldId).includes(scope.sprintId)) throw new Error('The parent no longer belongs to the selected Sprint.');
}

export function subtaskPatch(parent, projects, scope, values) {
  const project = subtaskProjects(projects, scope).find(project => project.id === Number(values.projectId));
  if (!project) throw new Error('Choose a Project within this Product Project hierarchy with an ordinary Card tracker.');
  const tracker = cardTrackers(project, scope.swimlaneTrackers).find(tracker => tracker.id === Number(values.trackerId));
  if (!tracker) throw new Error('Choose an ordinary Card tracker enabled in the selected Project.');
  if (!values.subject.trim()) throw new Error('Title cannot be blank.');
  const field = parent.custom_fields.find(field => Number(field.id) === scope.sprintFieldId);
  return {
    project_id: project.id, tracker_id: tracker.id, parent_issue_id: parent.id,
    status_id: scope.newStatusId, subject: values.subject, description: values.description,
    assigned_to_id: values.assigneeId ? Number(values.assigneeId) : null,
    ...sprintPatch(scope.sprintFieldId, field.multiple || Array.isArray(field.value) ? [scope.sprintId] : scope.sprintId),
  };
}

export function matchesSubtask(issue, patch) {
  const { project_id, tracker_id, parent_issue_id, ...attributes } = patch;
  return issue.project?.id === project_id && issue.tracker?.id === tracker_id && issue.parent?.id === parent_issue_id && matchesPatch(issue, attributes);
}
