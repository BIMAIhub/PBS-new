import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPortalApp } from '../server/app.js';

export const config = { helpers: false };

let application: ReturnType<typeof createPortalApp> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!application) {
    application = createPortalApp(true).catch(error => {
      application = undefined;
      throw error;
    });
  }

  const url = new URL(req.url || '/', 'https://pbs.local');
  const path = url.searchParams.get('__pbs_route');
  if (url.pathname === '/api/pbs' && path) url.pathname = `/api/${path}`;
  url.searchParams.delete('__pbs_route');
  req.url = url.pathname + url.search;

  try {
    const app = await application;
    app(req, res);
  } catch (error) {
    console.error('PBS backend startup failed:', error instanceof Error ? error.message : 'unknown error');
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'The PBS server is unavailable. Contact the site administrator.' }));
  }
}
