import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';

// Exercise Vite's actual startup validation, including Docker's default BASE_PATH=/.
afterEach(() => vi.unstubAllEnvs());

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
