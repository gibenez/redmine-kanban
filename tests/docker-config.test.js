// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

// Keep the real entrypoint validation and jq pipeline, but capture stdout rather
// than writing into nginx's production directory.
const script = readFileSync(new URL('../docker/40-board-config.sh', import.meta.url), 'utf8')
  .replace(' > /usr/share/nginx/html/config.json', '');
const env = { PATH: process.env.PATH, REDMINE_URL: 'https://redmine.example.test', BACKLOG_STATUS_ID: '1', OPENED_STATUS_ID: '42', SPRINT_FIELD_ID: '7', COLUMN_STATUS_IDS: '1,2,5' };
describe('container configuration', () => {
  it('emits the explicitly configured opened status', () => {
    const result = spawnSync('sh', ['-c', script], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ openedStatusId: 42, sprintFieldId: 7, columnStatusIds: [1, 2, 5] });
  });
  it.each(['', '0', '-1', '1.5', 'not-a-number'])('rejects OPENED_STATUS_ID=%j', value => {
    expect(spawnSync('sh', ['-c', script], { env: { ...env, OPENED_STATUS_ID: value } }).status).not.toBe(0);
  });
});
