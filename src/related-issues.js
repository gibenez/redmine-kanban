import { escapeHtml as e } from './domain.js';

const labels = {
  relates: ['relates to', 'relates to'],
  duplicates: ['duplicates', 'duplicated by'],
  duplicated: ['duplicated by', 'duplicates'],
  blocks: ['blocks', 'blocked by'],
  blocked: ['blocked by', 'blocks'],
  precedes: ['precedes', 'follows'],
  follows: ['follows', 'precedes'],
  copied_to: ['copied to', 'copied from'],
  copied_from: ['copied from', 'copied to'],
};

// This cache belongs to one selected Product Project/Sprint, not to membership
// or Card filtering. Abort and identity checks prevent stale requests leaking in.
export function createRelatedIssues({ getApi, linkToIssue, onChange }) {
  let states = new Map(), controller = new AbortController(), scope;
  function state(id) {
    if (!states.has(id)) states.set(id, { open: false });
    return states.get(id);
  }
  function reset(nextScope = scope, preserveOpen = false) {
    controller.abort(); controller = new AbortController();
    states = new Map(preserveOpen ? [...states].map(([id, value]) => [id, { open: value.open }]) : []);
    scope = nextScope;
  }
  function setScope(nextScope) { if (nextScope !== scope) reset(nextScope); }
  function discover(id) {
    const value = state(id);
    if (value.discovery) return value.discovery;
    const signal = controller.signal;
    value.discovery = (async () => {
      try {
        const relations = await getApi().relations(id, { signal });
        if (!signal.aborted) value.relations = relations;
      } catch {
        if (!signal.aborted) value.error = true;
      }
      if (!signal.aborted) onChange();
    })();
    return value.discovery;
  }
  async function load(id) {
    const value = state(id);
    if (value.pending || value.attempted) return;
    value.pending = true; value.attempted = true; value.error = false;
    const signal = controller.signal, api = getApi();
    try {
      const relations = value.relations;
      const rows = relations.map(relation => {
        const outgoing = Number(relation.issue_id) === id;
        return {
          id: Number(outgoing ? relation.issue_to_id : relation.issue_id),
          label: labels[relation.relation_type]?.[outgoing ? 0 : 1] || relation.relation_type,
        };
      });
      const results = new Map((value.rows || []).filter(row => row.issue).map(row => [row.id, { issue: row.issue }]));
      const targets = [...new Set(rows.map(row => row.id))].filter(target => !results.has(target));
      // Bound fan-out for headings with many relations; fetch each target once.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (cursor < targets.length && !signal.aborted) {
          const target = targets[cursor++];
          try { results.set(target, { issue: await api.issue(target, { signal }) }); }
          catch (error) { results.set(target, { unavailable: [403, 404].includes(error.status), failed: ![403, 404].includes(error.status) }); }
        }
      }));
      if (signal.aborted) return;
      value.rows = rows.map(row => ({ ...row, ...results.get(row.id) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.id - b.id);
      value.error = value.rows.some(row => row.failed);
      value.loaded = true;
    } catch {
      if (signal.aborted) return;
      value.error = true;
    } finally {
      if (!signal.aborted) { value.pending = false; onChange(); }
    }
  }
  function markup(id) {
    const value = state(id), rows = value.rows || [];
    // Do not flash an empty disclosure while checking the heading's relations.
    // Failed checks remain visible so users can distinguish them from no relations.
    if (!value.relations?.length && !value.error) return '';
    const summary = value.relations ? `${value.relations.length} related issues` : 'Related issues';
    const items = rows.map(row => `<li>${e(row.label)} · ${row.issue
      ? `<a href="${e(linkToIssue(row.id))}" target="_blank" rel="noopener noreferrer">#${row.id} — ${e(row.issue.subject)}</a> · ${e(row.issue.status?.name || '')}`
      : row.failed ? 'Issue could not be loaded' : 'Issue unavailable'}</li>`).join('');
    const content = `${items ? `<ul>${items}</ul>` : ''}${value.pending || (!value.loaded && !value.error) ? '<p role="status">Loading related issues…</p>' : ''}${value.loaded && !rows.length ? '<p>No related issues.</p>' : ''}${value.error ? `<p role="status">Some related issues could not be loaded. <button type="button" data-retry-related="${id}"${value.pending ? ' disabled' : ''}>Retry</button></p>` : ''}`;
    return `<details class="unmapped-notice related-notice" data-related="${id}"${value.open ? ' open' : ''}><summary>${summary}</summary>${value.open ? content : ''}</details>`;
  }
  return {
    markup, reset, setScope,
    toggle(id, open) { const value = state(id); if (value.open === open) return; value.open = open; onChange(); },
    loadOpen(ids) {
      for (const id of ids) {
        const value = state(id);
        void discover(id).then(() => { if (states.get(id) === value && value.open && value.relations?.length) void load(id); });
      }
    },
    retry(id) {
      const value = state(id);
      if (value.pending) return;
      value.attempted = false; value.error = false;
      if (!value.relations) value.discovery = null;
      void discover(id).then(() => { if (states.get(id) === value && value.relations?.length) void load(id); });
      onChange();
    },
  };
}
