export class RedmineError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'RedmineError'; this.status = status; }
}

export class RedmineClient {
  constructor(key, base = '/redmine') {
    this.key = key;
    this.base = base.replace(/\/$/, '');
    this.controller = new AbortController();
  }
  dispose() { this.controller.abort(); this.key = ''; }
  async request(path, { method = 'GET', body, params = {}, signal } = {}) {
    const url = new URL(`${this.base}${path}`, window.location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    let response;
    try {
      response = await fetch(url, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'X-Redmine-API-Key': this.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (this.controller.signal.aborted) throw new RedmineError('Session ended.');
      throw new RedmineError('Cannot reach Redmine. Check the connection and proxy configuration.');
    }
    let data = null;
    const text = await response.text();
    if (text) { try { data = JSON.parse(text); } catch { /* Never display upstream HTML. */ } }
    if (!response.ok) {
      const defaults = { 401: 'Invalid or revoked API key.', 403: 'Redmine denied this action for your account.', 404: 'This resource is unavailable or no longer visible.' };
      const errors = Array.isArray(data?.errors) ? data.errors.filter(x => typeof x === 'string').join('; ') : '';
      const message = errors || defaults[response.status] || `Redmine request failed (${response.status}).`;
      throw new RedmineError(this.key ? message.split(this.key).join('[redacted]') : message, response.status);
    }
    if (method === 'GET' && !data) throw new RedmineError('Expected JSON from Redmine. Check that its REST API is enabled and the proxy URL is correct.');
    return data;
  }
  async page(path, collection, params = {}, options = {}) {
    const offset = Number(params.offset || 0);
    const data = await this.request(path, { ...options, params });
    const items = data[collection];
    if (!Array.isArray(items)) throw new RedmineError(`Invalid Redmine response: missing ${collection}.`);
    if (data.offset != null && Number(data.offset) !== offset) throw new RedmineError('Redmine returned an unexpected pagination offset.');
    const total = data.total_count == null ? null : Number(data.total_count);
    return { items, total, nextOffset: offset + items.length, hasMore: items.length > 0 && (total == null ? items.length === Number(params.limit) : offset + items.length < total) };
  }
  async list(path, collection, params = {}, options = {}) {
    const results = [];
    let offset = 0;
    while (true) {
      const data = await this.request(path, { ...options, params: { ...params, limit: 100, offset } });
      const page = data[collection];
      if (!Array.isArray(page)) throw new RedmineError(`Invalid Redmine response: missing ${collection}.`);
      results.push(...page);
      offset += page.length;
      if (!page.length || data.total_count == null || offset >= data.total_count) break;
      if (data.offset != null && Number(data.offset) !== offset - page.length) throw new RedmineError('Redmine returned an unexpected pagination offset.');
    }
    return results;
  }
  issue(id) { return this.request(`/issues/${Number(id)}.json`, { params: { include: 'allowed_statuses' } }).then(data => data.issue); }
  hierarchyIssue(id) { return this.request(`/issues/${Number(id)}.json`, { params: { include: 'children,allowed_statuses' } }).then(data => data.issue); }
  createIssue(fields) { return this.request('/issues.json', { method: 'POST', body: { issue: fields } }).then(data => data?.issue); }
  update(id, patch) { return this.request(`/issues/${Number(id)}.json`, { method: 'PUT', body: { issue: patch } }); }
  async projectCategories(id, options = {}) {
    // The standalone category endpoint requires Manage categories even for GET.
    // Project metadata exposes the same names/IDs with ordinary project-view access.
    const data = await this.request(`/projects/${Number(id)}.json`, { ...options, params: { include: 'issue_categories' } });
    if (!Array.isArray(data.project?.issue_categories)) throw new RedmineError('Invalid Redmine response: missing project issue_categories.');
    return data.project.issue_categories;
  }
  relations(id, options = {}) { return this.list(`/issues/${Number(id)}/relations.json`, 'relations', {}, options); }
  relate(id, otherId) { return this.request(`/issues/${Number(id)}/relations.json`, { method: 'POST', body: { relation: { issue_to_id: Number(otherId), relation_type: 'relates' } } }); }
  unrelate(id) { return this.request(`/relations/${Number(id)}.json`, { method: 'DELETE' }); }
}
