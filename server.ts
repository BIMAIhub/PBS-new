import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { dataDirectory } from './server/database.js';
import { createPortalApp } from './server/app.js';

async function startServer() {
  const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
  if (production) process.env.NODE_ENV = 'production';
  const port = Number(process.env.PORT || '3000');
  const host = process.env.PBS_HOST || '127.0.0.1';
  const app = await createPortalApp();
  if (production) {
    const dist = path.resolve('dist');
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.get(['/pbs-logo.svg', '/favicon.svg', '/bim-study-model.webp'], (req, res) => res.sendFile(req.path.slice(1), { root: dist }));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: dist }));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.sqlite*', '**/server/**', '**/scripts/**', path.resolve('server.ts'), `${dataDirectory.replaceAll('\\', '/')}/**`] } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(port, host, () => console.log(`PBS is listening on ${host}:${port}`));
  server.requestTimeout = 15 * 60 * 1000;
}

startServer().catch(error => {
  console.error('PBS could not start:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
