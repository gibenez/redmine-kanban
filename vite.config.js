import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const redmineUrl = env.REDMINE_URL || 'http://localhost:3000';
  const defaults = JSON.parse(readFileSync(new URL('./public/config.json', import.meta.url), 'utf8'));
  const config = {
    ...defaults,
    redminePublicUrl: redmineUrl,
    backlogStatusId: env.BACKLOG_STATUS_ID ? Number(env.BACKLOG_STATUS_ID) : defaults.backlogStatusId,
    columnStatusIds: env.COLUMN_STATUS_IDS ? env.COLUMN_STATUS_IDS.split(',').map(Number) : defaults.columnStatusIds,
    refreshSeconds: env.REFRESH_SECONDS ? Number(env.REFRESH_SECONDS) : defaults.refreshSeconds,
    sprintSource: env.SPRINT_SOURCE || defaults.sprintSource,
    buildTrackerId: env.BUILD_TRACKER_ID ? Number(env.BUILD_TRACKER_ID) : defaults.buildTrackerId,
  };
  return {
    plugins: [{
      name: 'board-development-config',
      configureServer(server) {
        server.middlewares.use('/config.json', (request, response, next) => {
          if (request.method !== 'GET') return next();
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify(config));
        });
      },
    }],
    server: {
      proxy: {
        '/redmine': {
          target: redmineUrl,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/redmine/, ''),
          configure(proxy) {
            proxy.on('proxyReq', request => {
              request.removeHeader('cookie');
              request.removeHeader('authorization');
              request.removeHeader('x-redmine-switch-user');
            });
          },
        },
      },
    },
    test: { environment: 'jsdom', include: ['tests/**/*.test.js'], restoreMocks: true },
  };
});
