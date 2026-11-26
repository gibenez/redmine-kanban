// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

// Keep the real entrypoint validation and jq pipeline, but capture stdout rather
// than writing into nginx's production directory.
const script = readFileSync(new URL('../docker/40-board-config.sh', import.meta.url), 'utf8')
  .replace(' > /usr/share/nginx/html/config.json', '');
const env = { PATH: process.env.PATH, REDMINE_URL: 'https://redmine.example.test', BACKLOG_STATUS_ID: '1', OPENED_STATUS_ID: '42', SPRINT_FIELD_ID: '7', COLUMN_STATUS_IDS: '1,2,5' };
const template = readFileSync(new URL('../docker/default.conf.template', import.meta.url), 'utf8');
// Exercise the method/path pairs in nginx's allowlist; the Docker smoke test
// checks the same boundary using the real nginx parser and proxy.
const apiMap = template.match(/map "\$request_method:\$uri" \$board_api_allowed\s*\{([^}]+)\}/)[1];
const allowedRoutes = [...apiMap.matchAll(/~(\S+)\s+1;/g)].map(([, pattern]) => new RegExp(pattern));

describe('proxy method/path allowlist', () => {
  it('denies unmatched requests before proxying', () => {
    expect(apiMap).toMatch(/default\s+0;/);
    expect(template).toContain('if ($board_api_allowed = 0) { return 404; }');
  });
  it.each([
    ['GET', '/redmine/users/current.json'],
    ['GET', '/redmine/issue_statuses.json'],
    ['GET', '/redmine/enumerations/issue_priorities.json'],
    ['GET', '/redmine/projects.json'],
    ['GET', '/redmine/projects/1/versions.json'],
    ['GET', '/redmine/projects/1/memberships.json'],
    ['GET', '/redmine/issues.json'],
    ['GET', '/redmine/issues/1.json'],
    ['GET', '/redmine/issues/1/relations.json'],
    ['GET', '/redmine/issues/123/relations.json'],
    ['GET', '/redmine/versions/1.json'],
    ['PUT', '/redmine/issues/1.json'],
    ['POST', '/redmine/issues.json'],
  ])('allows %s %s', (method, path) => {
    expect(allowedRoutes.some(rule => rule.test(`${method}:${path}`))).toBe(true);
  });
  it.each([
    ['PUT', '/redmine/issues.json'],
    ['PATCH', '/redmine/issues.json'],
    ['DELETE', '/redmine/issues.json'],
    ['HEAD', '/redmine/issues.json'],
    ['POST', '/redmine/issues/1.json'],
    ['POST', '/redmine/issues.json/'],
    ['POST', '/redmine/issues.json/extra'],
    ['POST', '/redmine/issuesXjson'],
    ['POST', '/redmine/issues/1/relations.json'],
    ['PUT', '/redmine/issues/1/relations.json'],
    ['PATCH', '/redmine/issues/1/relations.json'],
    ['DELETE', '/redmine/issues/1/relations.json'],
    ['HEAD', '/redmine/issues/1/relations.json'],
    ['GET', '/redmine/issues/abc/relations.json'],
    ['GET', '/redmine/issues/-1/relations.json'],
    ['GET', '/redmine/issues/1/relations.json/'],
    ['GET', '/redmine/issues/1/relations.json/extra'],
    ['GET', '/redmine/issues/1/relationsXjson'],
    ['GET', '/redmine/relations/1.json'],
    ['POST', '/redmine/relations.json'],
    ['DELETE', '/redmine/relations/1.json'],
    ['DELETE', '/redmine/issues/1.json'],
    ['POST', '/redmine/projects.json'],
    ['POST', '/redmine/projects/1.json'],
    ['POST', '/redmine/enumerations/issue_priorities.json'],
    ['PUT', '/redmine/enumerations/issue_priorities.json'],
    ['DELETE', '/redmine/enumerations/issue_priorities.json'],
    ['GET', '/redmine/users.json'],
    ['GET', '/redmine/projects/1/issue_categories.json'],
  ])('denies %s %s', (method, path) => {
    expect(allowedRoutes.some(rule => rule.test(`${method}:${path}`))).toBe(false);
  });
});

describe('container configuration', () => {
  it('allows bounded full-description HTML writes beyond the old planning-only limit', () => {
    expect(template).toMatch(/client_max_body_size\s+1m;/);
  });
  it('emits the explicitly configured opened status', () => {
    const result = spawnSync('sh', ['-c', script], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ openedStatusId: 42, sprintFieldId: 7, columnStatusIds: [1, 2, 5] });
  });
  it.each(['', '0', '-1', '1.5', 'not-a-number'])('rejects OPENED_STATUS_ID=%j', value => {
    expect(spawnSync('sh', ['-c', script], { env: { ...env, OPENED_STATUS_ID: value } }).status).not.toBe(0);
  });
});
