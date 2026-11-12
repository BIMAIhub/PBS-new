import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { dataDirectory, openDatabase } from './server/database';
import { provisionInitialAdministrator } from './server/administrators';
import { mountAuth, requireAccount } from './server/auth';
import { mountAdmin } from './server/admin';
import { mountStudent } from './server/student';
import { mountMedia } from './server/media';
import { apiError, field, limitAttempts, RequestError, route } from './server/http';

async function startServer() {
  const app = express();
  const db = openDatabase();
  const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
  if (production) process.env.NODE_ENV = 'production';
  const port = Number(process.env.PORT || '3000');
  const host = process.env.PBS_HOST || '127.0.0.1';
  const publicOrigin = process.env.PBS_PUBLIC_ORIGIN ? new URL(process.env.PBS_PUBLIC_ORIGIN).origin : '';
  await provisionInitialAdministrator(db);
  app.disable('x-powered-by');
  if (process.env.PBS_TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = publicOrigin || `${req.protocol}://${req.get('host')}`;
      if (req.get('x-pbs-request') !== '1' || (origin && origin !== expected)) {
        return next(new RequestError(403, 'Use the PBS portal to submit this request.'));
      }
    }
    next();
  });
  app.use('/api', express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  mountAuth(app, db);
  mountAdmin(app, db);
  mountStudent(app, db);
  mountMedia(app, db);

  app.post('/api/ask-pbs', limitAttempts(12), route(async (req, res) => {
    requireAccount(db, req);
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new RequestError(503, 'The BIM assistant is unavailable. You can message PBS from your workspace.');
    const question = field(req.body?.question, 'BIM question', 1500);
    const client = new GoogleGenAI({ apiKey: key });
    const response = await client.models.generateContent({
      model: process.env.PBS_GEMINI_MODEL || 'gemini-2.5-flash',
      contents: question,
      config: { systemInstruction: 'You are the Pragmatic BIM Solution learning assistant. Explain BIM and Revit workflows clearly and concisely.' },
    });
    res.json({ reply: response.text || 'Ask a more specific BIM question.' });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'This PBS endpoint is unavailable.' }));
  app.use('/api', apiError);
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
