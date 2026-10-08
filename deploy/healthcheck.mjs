import { get } from 'node:http';

// Minimal container-local readiness request; preserve the application's canonical
// Host guard without logging the public origin, credentials, response or errors.
try {
  const host = new URL(process.env.PUBLIC_URL).host;
  const request = get({ hostname: '127.0.0.1', port: Number(process.env.PORT ?? 3030), path: '/health/ready', headers: { host, accept: 'application/json' }, timeout: 3000 }, response => {
    let body = '', bytes = 0;
    response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024) { response.destroy(); process.exitCode = 1; } else body += chunk; });
    response.on('end', () => { try { process.exitCode = response.statusCode === 200 && JSON.parse(body).status === 'ready' ? 0 : 1; } catch { process.exitCode = 1; } });
    response.on('error', () => { process.exitCode = 1; });
  });
  request.on('timeout', () => { request.destroy(); process.exitCode = 1; });
  request.on('error', () => { process.exitCode = 1; });
} catch { process.exitCode = 1; }
