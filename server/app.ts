import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { openDatabase } from './database';
import { provisionInitialAdministrator } from './administrators';
import { mountAuth, requireAccount } from './auth';
import { mountAdmin } from './admin';
import { mountStudent } from './student';
import { mountMedia } from './media';
import { apiError, field, limitAttempts, RequestError, route } from './http';

export async function createPortalApp(hosted = false) {
  const app = express();
  const publicOrigin = process.env.PBS_PUBLIC_ORIGIN ? new URL(process.env.PBS_PUBLIC_ORIGIN).origin : '';
  const db = await openDatabase(hosted);
  try {
    await provisionInitialAdministrator(db);
  } catch (error) {
    db.close();
    throw error;
  }
  app.disable('x-powered-by');
  if (hosted || process.env.PBS_TRUST_PROXY === '1') app.set('trust proxy', 1);
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
      const expected = publicOrigin || `${hosted ? 'https' : req.protocol}://${req.get('host')}`;
      if (req.get('x-pbs-request') !== '1' || (origin && origin !== expected)) {
        return next(new RequestError(403, 'Use the PBS portal to submit this request.'));
      }
    }
    next();
  });
  app.use('/api', express.json({ limit: '256kb' }));
  app.get('/api/health', route(async (_req, res) => {
    await db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  }));
  mountAuth(app, db, hosted);
  mountAdmin(app, db, hosted);
  mountStudent(app, db, hosted);
  mountMedia(app, db, hosted);

  app.post('/api/ask-pbs', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    await requireAccount(db, req);
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
  return app;
}
