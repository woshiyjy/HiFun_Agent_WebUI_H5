import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import express from 'express';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { createResponder } from './responder.js';
import { loadConfig } from './config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// Only this subproject's .env is loaded, never the container credentials by default.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const mode = process.env.APP_MODE || 'demo';
const config = await loadConfig();
if (!['demo', 'live'].includes(mode)) throw new Error('APP_MODE must be demo or live');
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('This local MVP binds only to loopback; deployment requires a separate review.');
const port = Number(process.env.PORT || 1842);
const production = process.env.NODE_ENV === 'production';
if (production && process.env.PUBLIC_ORIGIN !== 'https://www.wehifun.cn') throw new Error('Production requires the approved HTTPS origin.');
const store = await createStore(path.join(root, '.runtime'), { tokenLimit: Number(process.env.SESSION_TOKEN_LIMIT || 10000000) });
// Image input remains available to the main vision model. The independent
// diagnosis capsule is intentionally not wired into this public build;
// it will return later through a separately reviewed MCP service.
const app = createApp({ store, responder: createResponder({ mode, env: config }), mode, origin: production ? process.env.PUBLIC_ORIGIN : `http://${host}:${port}`, production });
let vite;
if (!production) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: {
    middlewareMode: true, ws: { host: '127.0.0.1' },
    fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/.runtime/**', '**/server/**', '**/knowledge/**', '**/skills/**', '**/*.md', '**/package-lock.json'] },
    watch: { usePolling: true, interval: 800, ignored: ['**/.runtime/**'] },
  }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, 'dist'), { index: 'index.html' }));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
}
const server = app.listen(port, host, () => console.log(`Tomato H5 (${mode}) Local: http://${host}:${port}`));
const sweep = setInterval(() => store.sweep().catch(() => console.error('Temporary data cleanup failed')), 60000);
async function stop() { clearInterval(sweep); await vite?.close(); server.close(() => process.exit(0)); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
