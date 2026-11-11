import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';

// Exercise Vite's actual startup validation, including Docker's default BASE_PATH=/.
afterEach(() => vi.unstubAllEnvs());

describe('legacy Sprint configuration', () => {
  it('rejects an explicitly configured Build source during startup', async () => {
    vi.stubEnv('SPRINT_SOURCE', 'build');
    await expect(resolveConfig({ configFile: 'vite.config.js' }, 'serve')).rejects.toThrow('Build-based Sprints are no longer supported');
  });
  it('does not emit obsolete configuration for the version source', async () => {
    vi.stubEnv('SPRINT_SOURCE', 'version');
    vi.stubEnv('BUILD_TRACKER_ID', '9');
    const config = await resolveConfig({ configFile: 'vite.config.js' }, 'serve');
    const use = vi.fn();
    config.plugins.find(plugin => plugin.name === 'board-development-config').configureServer({ middlewares: { use } });
    const response = { setHeader: vi.fn(), end: vi.fn() };
    use.mock.calls[0][1]({ method: 'GET' }, response, vi.fn());
    const generated = JSON.parse(response.end.mock.calls[0][0]);
    expect(generated).not.toHaveProperty('sprintSource');
    expect(generated).not.toHaveProperty('buildTrackerId');
  });
});

describe('Vite Swimlane configuration', () => {
  it('serves the explicit Sprint custom-field ID without inferring it from other IDs', async () => {
    vi.stubEnv('SPRINT_FIELD_ID', '42');
    vi.stubEnv('OPENED_STATUS_ID', '3');
    const config = await resolveConfig({ configFile: 'vite.config.js' }, 'serve');
    const use = vi.fn();
    config.plugins.find(plugin => plugin.name === 'board-development-config').configureServer({ middlewares: { use } });
    const response = { setHeader: vi.fn(), end: vi.fn() };
    use.mock.calls[0][1]({ method: 'GET' }, response, vi.fn());
    expect(JSON.parse(response.end.mock.calls[0][0]).sprintFieldId).toBe(42);
    expect(JSON.parse(response.end.mock.calls[0][0]).openedStatusId).toBe(3);
  });
  it.each([
    [' Feature, Bug ,Improvement ', ['Feature', 'Bug', 'Improvement']],
    ['', []],
    ['Story', ['Story']],
  ])('serves SWIMLANE_TRACKERS=%j through development config', async (value, expected) => {
    vi.stubEnv('SWIMLANE_TRACKERS', value);
    const config = await resolveConfig({ configFile: 'vite.config.js' }, 'serve');
    const use = vi.fn();
    config.plugins.find(plugin => plugin.name === 'board-development-config').configureServer({ middlewares: { use } });
    const middleware = use.mock.calls[0][1];
    const response = { setHeader: vi.fn(), end: vi.fn() };
    middleware({ method: 'GET' }, response, vi.fn());
    expect(JSON.parse(response.end.mock.calls[0][0]).swimlaneTrackers).toEqual(expected);
  });
});

describe('Vite deployment base', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['///', '/'],
    ['redmine-kanban', '/redmine-kanban/'],
    ['/redmine-kanban/', '/redmine-kanban/'],
  ])('starts with BASE_PATH=%j', async (basePath, expected) => {
    vi.stubEnv('BASE_PATH', basePath);
    vi.stubEnv('REDMINE_URL', 'http://localhost:3000');
    const config = await resolveConfig({ configFile: 'vite.config.js' }, 'serve');
    expect(config.base).toBe(expected);
  });
});
