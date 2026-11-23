// Build an isolated, deterministic authenticated preview for visual checks.
// Usage: npm run build && node tests/fixtures/board-preview.mjs
// Generated files stay outside the production build; no live API or credentials are used.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const output = path.resolve('.taste-skill/preview');
mkdirSync(output, { recursive: true });
cpSync(path.resolve('dist'), output, { recursive: true });

function installFixture() {
  const statuses = [{ id: 1, name: 'New' }, { id: 2, name: 'In progress' }, { id: 3, name: 'Review' }, { id: 5, name: 'Done', is_closed: true }];
  const trackers = [{ id: 1, name: 'Feature' }, { id: 2, name: 'Task' }];
  const project = { id: 1, name: 'Customer portal', trackers };
  const version = { id: 10, name: 'Sprint 24', status: 'open', due_date: '2026-11-06', sharing: 'descendants', project };
  const member = { id: 7, name: 'Alex Morgan' };
  const base = { project, tracker: trackers[1], priority: { id: 2, name: 'Normal' }, status: statuses[0], custom_fields: [{ id: 7, value: '10' }], allowed_statuses: statuses };
  const issues = [
    { ...base, id: 410, subject: 'Improve account security', tracker: trackers[0], due_date: '2026-11-06', tags: ['Account'], priority: { id: 3, name: 'High' } },
    { ...base, id: 411, subject: 'Add two-step verification to account settings', parent: { id: 410 }, assigned_to: member, estimated_hours: 8 },
    { ...base, id: 412, subject: 'Send a confirmation email when a password changes', parent: { id: 410 }, status: statuses[1], assigned_to: { id: 8, name: 'Sam Rivera' }, estimated_hours: 3 },
    { ...base, id: 413, subject: 'Review recovery code accessibility', parent: { id: 410 }, status: statuses[2], assigned_to: member, estimated_hours: 2 },
    { ...base, id: 420, subject: 'Make invoices easier to manage', tracker: trackers[0], tags: ['Billing'] },
    { ...base, id: 421, subject: 'Show invoice payment status in the billing history', parent: { id: 420 }, status: statuses[1], assigned_to: member, estimated_hours: 5 },
    { ...base, id: 422, subject: 'Export invoices as PDF files', parent: { id: 420 }, status: statuses[3], assigned_to: { id: 8, name: 'Sam Rivera' }, estimated_hours: 4 },
    { ...base, id: 430, subject: 'Update the support contact in account settings', estimated_hours: 1 },
    ...['Improve the mobile sign-in experience', 'Add shared notification preferences', 'Simplify the new customer setup', 'Support saved billing addresses', 'Improve search for archived invoices', 'Add account activity history'].map((subject, index) => ({
      ...base, id: 440 + index, subject, tracker: trackers[0], custom_fields: [{ id: 7, value: '' }],
      assigned_to: index % 2 ? member : undefined, estimated_hours: index % 2 ? 5 : null,
      priority: { id: index % 3 + 1, name: ['Low', 'Normal', 'High'][index % 3] },
    })),
  ];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const json = data => Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    if (url.pathname.endsWith('/config.json')) return json({ redminePublicUrl: 'https://redmine.example', backlogStatusId: 1, openedStatusId: 2, sprintFieldId: 7, columnStatusIds: [1, 2, 3, 5], swimlaneTrackers: ['Feature'], refreshSeconds: 60 });
    if (!url.pathname.includes('/redmine/')) return nativeFetch(input, init);
    if (init?.method && init.method !== 'GET') return new Response('{}', { status: 403 });
    const route = url.pathname.replace(/^.*\/redmine/, '');
    if (route === '/users/current.json') return json({ user: { id: 7, firstname: 'Alex', lastname: 'Morgan' } });
    if (route === '/issue_statuses.json') return json({ issue_statuses: statuses });
    if (route === '/projects.json') return json({ projects: [project] });
    if (route.endsWith('/memberships.json')) return json({ memberships: [{ user: member }, { user: { id: 8, name: 'Sam Rivera' } }] });
    if (route.endsWith('/versions.json')) return json({ versions: [version] });
    if (route === '/versions/10.json') return json({ version });
    if (route === '/issues.json') {
      let rows = issues.filter(issue => url.searchParams.get('cf_7') === '!*' ? !issue.custom_fields[0].value : issue.custom_fields[0].value === '10');
      if (url.searchParams.has('parent_id')) rows = issues.filter(issue => issue.parent?.id === Number(url.searchParams.get('parent_id')));
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
      return json({ issues: rows.slice(offset, offset + limit), total_count: rows.length, offset });
    }
    if (route.endsWith('/relations.json')) return json({ relations: [] });
    if (/^\/issues\/\d+\.json$/.test(route)) {
      const issue = issues.find(issue => issue.id === Number(route.match(/\d+/)[0]));
      return json({ issue: { ...issue, children: issues.filter(child => child.parent?.id === issue?.id).map(child => ({ id: child.id })) } });
    }
    return new Response('{}', { status: 404 });
  };
  localStorage.setItem('redmine-sprint-board.api-key', 'visual-fixture-only');
}

const html = readFileSync(path.join(output, 'index.html'), 'utf8');
writeFileSync(path.join(output, 'index.html'), html.replace('<head>', `<head><script>(${installFixture.toString()})();</script>`));
console.log(`Authenticated fixture: ${path.join(output, 'index.html')}`);
