import { describe, it, expect } from 'vitest';
import { cardTrackers, subtaskProjects, assertSubtaskContext, subtaskPatch, matchesSubtask } from '../src/subtask-creation.js';

const task = { id: 2, name: 'Task' }, feature = { id: 1, name: 'Feature' };
const projects = [{ id: 1, trackers: [feature] }, { id: 2, parent: { id: 1 }, trackers: [feature, task] }, { id: 3, trackers: [task] }];
const scope = { projectId: '1', sprintId: 100, sprintFieldId: 7, swimlaneTrackers: ['Feature'], closedStatusIds: [5], newStatusId: 1 };
const parent = () => ({ id: 10, project: { id: 1 }, tracker: feature, status: { id: 2 }, custom_fields: [{ id: 7, multiple: true, value: ['99', '100'] }] });
const version = { id: 100, status: 'open' };
const values = { projectId: '2', trackerId: '2', subject: 'New child', description: '<p>Work</p>', assigneeId: '' };

describe('subtask creation', () => {
  it('offers only in-scope Projects with ordinary Card trackers', () => {
    expect(cardTrackers(projects[1], scope.swimlaneTrackers)).toEqual([task]);
    expect(subtaskProjects(projects, scope).map(project => project.id)).toEqual([2]);
    expect(cardTrackers(undefined, scope.swimlaneTrackers)).toEqual([]);
  });
  it('accepts an open planned parent and Sprint', () => {
    expect(() => assertSubtaskContext(parent(), version, projects, scope)).not.toThrow();
  });
  it.each([
    ['closed Sprint', issue => issue, { ...version, status: 'closed' }],
    ['different Sprint', issue => issue, { ...version, id: 99 }],
    ['outside parent', issue => ({ ...issue, project: { id: 3 } }), version],
    ['ordinary parent', issue => ({ ...issue, tracker: task }), version],
    ['closed parent', issue => ({ ...issue, status: { id: 5 } }), version],
    ['unplanned parent', issue => ({ ...issue, custom_fields: [{ id: 7, value: '' }] }), version],
    ['missing Sprint field', issue => ({ ...issue, custom_fields: [] }), version],
  ])('rejects stale context: %s', (_name, change, selected) => {
    expect(() => assertSubtaskContext(change(parent()), selected, projects, scope)).toThrow();
  });
  it('sets only the selected Sprint, New and fixed parent, without inherited metadata', () => {
    expect(subtaskPatch(parent(), projects, scope, values)).toEqual({
      project_id: 2, tracker_id: 2, parent_issue_id: 10, status_id: 1,
      subject: 'New child', description: '<p>Work</p>', assigned_to_id: null,
      custom_fields: [{ id: 7, value: ['100'] }],
    });
  });
  it('supports a single-valued Sprint field and explicit assignee', () => {
    const issue = parent(); issue.custom_fields = [{ id: 7, value: '100' }];
    const patch = subtaskPatch(issue, projects, scope, { ...values, assigneeId: '8' });
    expect(patch.custom_fields).toEqual([{ id: 7, value: '100' }]);
    expect(patch.assigned_to_id).toBe(8);
  });
  it.each([{ projectId: '' }, { projectId: '3' }, { trackerId: '1' }, { trackerId: '' }, { subject: '  ' }])('rejects invalid choices %j', change => {
    expect(() => subtaskPatch(parent(), projects, scope, { ...values, ...change })).toThrow();
  });
  it('verifies server-retained parent, Project, tracker and ordinary attributes', () => {
    const patch = subtaskPatch(parent(), projects, scope, values);
    const issue = { id: 20, parent: { id: 10 }, project: { id: 2 }, tracker: task,
      status: { id: 1 }, subject: values.subject, description: values.description,
      custom_fields: [{ id: 7, value: ['100'] }] };
    expect(matchesSubtask(issue, patch)).toBe(true);
    for (const change of [{ parent: { id: 11 } }, { project: { id: 1 } }, { tracker: feature }, { status: { id: 2 } }, { custom_fields: [{ id: 7, value: [] }] }]) {
      expect(matchesSubtask({ ...issue, ...change }, patch)).toBe(false);
    }
  });
});
