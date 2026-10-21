import http from 'node:http';

http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Set-Cookie', 'upstream-session=must-not-reach-browser');
  response.end(JSON.stringify({
    path: request.url,
    method: request.method,
    keyForwarded: request.headers['x-redmine-api-key'] === 'smoke-key',
    cookieForwarded: Boolean(request.headers.cookie),
    authForwarded: Boolean(request.headers.authorization),
    switchUserForwarded: Boolean(request.headers['x-redmine-switch-user']),
  }));
}).listen(3000, '0.0.0.0');
