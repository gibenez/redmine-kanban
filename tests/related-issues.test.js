import { describe, it, expect, vi } from 'vitest';
import { createRelatedIssues } from '../src/related-issues.js';

const issue = id => ({ id, subject: `Issue <${id}>`, status: { name: 'Closed' } });
function setup(relations = []) {
  const api = { relations: vi.fn().mockResolvedValue(relations), issue: vi.fn(async id => issue(id)) };
  const onChange = vi.fn();
  const related = createRelatedIssues({ getApi: () => api, linkToIssue: id => `https://redmine.test/issues/${id}`, onChange });
  related.setScope('product/sprint');
  const open = async (id = 1) => {
    related.toggle(id, true); related.loadOpen([id]);
    await new Promise(done => setTimeout(done, 0));
    await vi.waitFor(() => expect(related.markup(id)).not.toContain('Loading related issues'));
  };
  return { api, related, onChange, open };
}

describe('related issues disclosures', () => {
  it('checks relations up front, hides empty disclosures, and loads targets only on expansion', async () => {
    const { api, related, open } = setup();
    expect(related.markup(1)).toBe('');
    related.loadOpen([1]);
    await vi.waitFor(() => expect(api.relations).toHaveBeenCalledTimes(1));
    expect(related.markup(1)).toBe('');
    expect(api.issue).not.toHaveBeenCalled();
    api.relations.mockResolvedValue([{ issue_id: 1, issue_to_id: 2, relation_type: 'relates' }]);
    related.reset(); related.loadOpen([1]);
    await vi.waitFor(() => expect(related.markup(1)).toContain('1 related issues'));
    expect(api.issue).not.toHaveBeenCalled();
    await open();
    expect(related.markup(1)).toContain('#2');
    related.toggle(1, false); await open();
    expect(api.relations).toHaveBeenCalledTimes(2);
    expect(api.issue).toHaveBeenCalledTimes(1);
  });

  it('labels both directions, sorts stably, retains distinct relationships, and fetches targets once', async () => {
    const { api, related, open } = setup([
      { issue_id: 1, issue_to_id: 3, relation_type: 'relates' },
      { issue_id: 2, issue_to_id: 1, relation_type: 'blocks' },
      { issue_id: 1, issue_to_id: 3, relation_type: 'blocks' },
      { issue_id: 1, issue_to_id: 4, relation_type: 'precedes' },
    ]);
    await open();
    const host = document.createElement('div'); host.innerHTML = related.markup(1);
    const rows = [...host.querySelectorAll('li')].map(row => row.textContent);
    expect(rows).toEqual(['blocked by · #2 — Issue <2> · Closed', 'blocks · #3 — Issue <3> · Closed', 'precedes · #4 — Issue <4> · Closed', 'relates to · #3 — Issue <3> · Closed']);
    expect(api.issue).toHaveBeenCalledTimes(3);
    expect(host.querySelectorAll('a[target="_blank"][rel="noopener noreferrer"]')).toHaveLength(4);
    expect(related.markup(1)).toContain('Issue &lt;3&gt;');
  });

  it('distinguishes unavailable targets from failures, preserves successes, and retries only on request', async () => {
    const { api, related, open } = setup([2, 3, 4].map(id => ({ issue_id: 1, issue_to_id: id, relation_type: 'relates' })));
    api.issue.mockImplementation(async id => {
      if (id === 3) throw Object.assign(new Error('private subject'), { status: 403 });
      if (id === 4) throw new Error('network');
      return issue(id);
    });
    await open();
    expect(related.markup(1)).toContain('Issue unavailable');
    expect(related.markup(1)).toContain('Retry');
    expect(related.markup(1)).not.toContain('private subject');
    related.loadOpen([1]); expect(api.relations).toHaveBeenCalledTimes(1);
    api.issue.mockImplementation(async id => issue(id));
    related.retry(1);
    expect(related.markup(1)).toContain('#2');
    await vi.waitFor(() => expect(related.markup(1)).toContain('#4'));
    expect(related.markup(1)).not.toContain('Retry');
    expect(api.issue.mock.calls.filter(([id]) => id === 2)).toHaveLength(1);
    expect(related.markup(1)).toContain('#4');
  });

  it('does not automatically retry a failed relations request or mistake it for empty', async () => {
    const { api, related, open } = setup();
    api.relations.mockRejectedValue(new Error('network'));
    await open(); related.loadOpen([1]);
    expect(api.relations).toHaveBeenCalledTimes(1);
    expect(related.markup(1)).toContain('Retry');
    expect(related.markup(1)).not.toContain('No related issues');
    api.relations.mockResolvedValue([]); related.retry(1);
    await vi.waitFor(() => expect(related.markup(1)).toBe(''));
  });

  it('refreshes open disclosures and resets expansion when selection changes', async () => {
    const { api, related, open } = setup();
    await open();
    related.reset(undefined, true); related.loadOpen([1]);
    await vi.waitFor(() => expect(api.relations).toHaveBeenCalledTimes(2));
    related.setScope('other/sprint');
    expect(related.markup(1)).not.toContain(' open');
    related.loadOpen([1]); expect(api.relations).toHaveBeenCalledTimes(3);
    expect(api.issue).not.toHaveBeenCalled();
  });

  it('ignores stale responses after scope changes', async () => {
    const { api, related, onChange } = setup();
    let resolve;
    api.relations.mockImplementation(() => new Promise(done => { resolve = done; }));
    related.toggle(1, true); related.loadOpen([1]);
    related.setScope('other/sprint'); onChange.mockClear();
    resolve([{ issue_id: 1, issue_to_id: 2, relation_type: 'blocks' }]);
    await new Promise(done => setTimeout(done, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(related.markup(1)).not.toContain(' open');
  });
});
