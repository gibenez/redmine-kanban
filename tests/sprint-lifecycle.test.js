import { describe, it, expect, vi } from 'vitest';
import { sprintTransitions, changeBuildSprintState, asBuildSprint } from '../src/build-sprints.js';

const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'Open' }, { id: 5, name: 'Done', is_closed: true }, { id: 6, name: 'Rejected', is_closed: true }];
function setup() {
  const issue = { id: 100, subject: 'Release', project: { id: 1 }, category: { id: 4 }, tracker: { id: 9 }, status: statuses[0], allowed_statuses: statuses };
  const sprint = asBuildSprint(structuredClone(issue), [5, 6]);
  const api = { issue: vi.fn(async () => issue), update: vi.fn(async (id, patch) => { issue.status = statuses.find(s => s.id === patch.status_id); }) };
  return { issue, sprint, api };
}

describe('Build Sprint lifecycle', () => {
  it('uses only permitted transitions, classifies by metadata and fails closed without workflow information', () => {
    const { issue } = setup();
    expect(sprintTransitions(issue, statuses, true).map(s => s.id)).toEqual([5, 6]);
    expect(sprintTransitions(issue, statuses, false).map(s => s.id)).toEqual([2]);
    expect(sprintTransitions({ ...issue, allowed_statuses: undefined }, statuses, true)).toEqual([]);
    expect(sprintTransitions({ ...issue, allowed_statuses: [{ id: 77 }] }, statuses, false)).toEqual([]);
  });
  it('updates only the Build status and verifies the result', async () => {
    const { issue, sprint, api } = setup();
    await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).resolves.toBe(issue);
    expect(api.update).toHaveBeenCalledExactlyOnceWith(100, { status_id: 5 });
    expect(api.issue).toHaveBeenCalledTimes(2);
  });
  it('reopens using a permitted open status', async () => {
    const { issue, sprint, api } = setup(); issue.status = statuses[2]; sprint.status = 'closed';
    await changeBuildSprintState(api, sprint, 2, statuses, 9);
    expect(issue.status.id).toBe(2);
  });
  it('rejects a newly closed, moved or recategorized Build before writing', async () => {
    for (const patch of [{ status: statuses[2] }, { project: { id: 2 } }, { tracker: { id: 8 } }, { category: { id: 5 } }]) {
      const { issue, sprint, api } = setup(); Object.assign(issue, patch);
      await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).rejects.toThrow('has changed');
      expect(api.update).not.toHaveBeenCalled();
    }
  });
  it('rechecks workflow and rejects a status in the wrong state group', async () => {
    const { issue, sprint, api } = setup();
    await expect(changeBuildSprintState(api, sprint, 2, statuses, 9)).rejects.toThrow('workflow');
    issue.allowed_statuses = [statuses[0]];
    await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).rejects.toThrow('workflow');
    expect(api.update).not.toHaveBeenCalled();
  });
  it('reports ignored updates and observed state after a lost response without retrying', async () => {
    const { issue, sprint, api } = setup(); api.update.mockResolvedValue(null);
    await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).rejects.toThrow('Observed sprint status: New');
    api.update.mockImplementation(async () => { issue.status = statuses[2]; throw new Error('Connection lost'); });
    await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).rejects.toThrow('Observed sprint status: Done');
    expect(api.update).toHaveBeenCalledTimes(2);
  });
  it('warns when a write cannot be verified', async () => {
    const { issue, sprint, api } = setup(); api.issue.mockResolvedValueOnce(issue).mockRejectedValue(new Error('Connection lost'));
    await expect(changeBuildSprintState(api, sprint, 5, statuses, 9)).rejects.toThrow('may already have succeeded');
    expect(api.update).toHaveBeenCalledTimes(1);
  });
});
