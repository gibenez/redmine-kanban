import { describe, it, expect, vi, afterEach } from 'vitest';
import { RedmineClient } from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

describe('Redmine REST boundary', () => {
  it('sends the key only in a header, omits cookies, and disables caching and redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ user: { id: 1 } })); vi.stubGlobal('fetch', fetch);
    await new RedmineClient('personal-secret').request('/users/current.json');
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).not.toContain('personal-secret');
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'X-Redmine-API-Key': 'personal-secret' } });
  });
  it('fetches a single bounded page without draining the collection', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ issues: [{ id: 6 }], total_count: 20, offset: 5 })); vi.stubGlobal('fetch', fetch);
    expect(await new RedmineClient('key').page('/issues.json', 'issues', { limit: 5, offset: 5 })).toEqual({ items: [{ id: 6 }], total: 20, nextOffset: 6, hasMore: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].searchParams.get('limit')).toBe('5');
  });
  it('propagates query cancellation instead of reporting a connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); })));
    const controller = new AbortController();
    const pending = new RedmineClient('key').page('/issues.json', 'issues', { limit: 5 }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('fetches every page, even when Redmine caps pages below our requested limit', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ issues: [{ id: 1 }], total_count: 2, offset: 0 })).mockResolvedValueOnce(json({ issues: [{ id: 2 }], total_count: 2, offset: 1 }));
    vi.stubGlobal('fetch', fetch);
    expect(await new RedmineClient('key').list('/issues.json', 'issues', { status_id: '*', subproject_id: '!*' })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetch.mock.calls[1][0].searchParams.get('offset')).toBe('1');
    expect(fetch.mock.calls[0][0].searchParams.get('status_id')).toBe('*');
  });
  it('supports unpaginated enumeration endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ issue_statuses: [{ id: 1 }] })));
    expect(await new RedmineClient('key').list('/issue_statuses.json', 'issue_statuses')).toEqual([{ id: 1 }]);
  });
  it('supports empty successful PUT responses and JSON issue payloads', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
    await new RedmineClient('key').update(8, { fixed_version_id: null });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"issue":{"fixed_version_id":null}}' });
  });
  it('reads categories through contributor-accessible project metadata, without pagination', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ project: { id: 1, issue_categories: [{ id: 4, name: 'Web' }] } }));
    vi.stubGlobal('fetch', fetch);
    expect(await new RedmineClient('key').projectCategories(1)).toEqual([{ id: 4, name: 'Web' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = fetch.mock.calls[0][0];
    expect(url.pathname).toBe('/redmine/projects/1.json');
    expect([...url.searchParams.entries()]).toEqual([['include', 'issue_categories']]);
  });
  it('rejects missing category metadata rather than treating it as an empty project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ project: { id: 1 } })));
    await expect(new RedmineClient('key').projectCategories(1)).rejects.toThrow('missing project issue_categories');
  });
  it('reads and writes only symmetric relates payloads through dedicated endpoints', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ relations: [{ id: 3, relation_type: 'relates', issue_id: 8, issue_to_id: 9 }] }))
      .mockResolvedValueOnce(json({ relation: { id: 4 } }, 201)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const client = new RedmineClient('key');
    expect(await client.relations(8)).toHaveLength(1);
    await client.relate(8, 9); await client.unrelate(4);
    expect(fetch.mock.calls[0][0].pathname).toBe('/redmine/issues/8/relations.json');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"relation":{"issue_to_id":9,"relation_type":"relates"}}' });
    expect(fetch.mock.calls[2][0].pathname).toBe('/redmine/relations/4.json');
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
  });
  it('reports permissions and redacts keys echoed by upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({ errors: ['bad personal-secret'] }, 422)));
    const client = new RedmineClient('personal-secret');
    await expect(client.issue(8)).rejects.toMatchObject({ status: 403, message: 'Redmine denied this action for your account.' });
    await expect(client.issue(8)).rejects.toThrow('bad [redacted]');
  });
  it('does not expose raw HTML error pages or connection exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<script>secret</script>', { status: 502 })).mockRejectedValueOnce(new Error('personal-secret')));
    const client = new RedmineClient('personal-secret');
    await expect(client.issue(8)).rejects.toThrow('Redmine request failed (502)');
    await expect(client.issue(8)).rejects.toThrow('Cannot reach Redmine');
  });
  it('clears credentials and aborts outstanding work on sign out', () => {
    const client = new RedmineClient('secret'); client.dispose();
    expect(client.key).toBe(''); expect(client.controller.signal.aborted).toBe(true);
  });
});
