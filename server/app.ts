import express from 'express';
import { openDatabase } from './database.js';
import { provisionInitialAdministrator } from './administrators.js';
import { mountAuth, requireAccount } from './auth.js';
import { mountAdmin } from './admin.js';
import { mountStudent } from './student.js';
import { mountMedia } from './media.js';
import { mountAcademy } from './academy.js';
import { mountMicrosoft } from './microsoft.js';
import { mountCommerce, provisionReferenceCatalog } from './commerce.js';
import { mountProfiles } from './profiles.js';
import { mountNotifications } from './notifications.js';
import { mountCurriculum } from './curriculum.js';
import { generateLearningText } from './ai.js';
import { apiError, field, limitAttempts, RequestError, route } from './http.js';

export async function createPortalApp(hosted = false) {
  const app = express();
  const publicOrigin = process.env.PBS_PUBLIC_ORIGIN ? new URL(process.env.PBS_PUBLIC_ORIGIN).origin : '';
  const db = await openDatabase(hosted);
  app.locals.portalDatabase = db;
  try {
    await provisionInitialAdministrator(db);
    await provisionReferenceCatalog(db);
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
  mountAcademy(app, db, hosted);
  mountMicrosoft(app, db, hosted);
  mountCommerce(app, db, hosted);
  mountProfiles(app, db, hosted);
  mountNotifications(app, db);
  mountCurriculum(app, db, hosted);

  app.post('/api/ask-pbs', limitAttempts(12, hosted ? db : undefined), route(async (req, res) => {
    await requireAccount(db, req);
    const question = field(req.body?.question, 'BIM question', 1500);
    const response = await generateLearningText('You are the Pragmatic BIM Solution learning assistant. Explain BIM and Revit workflows clearly and concisely. Do not invent PBS course schedules, prices, instructor details or student records.', question);
    res.json({ reply: response.text || 'Ask a more specific BIM question.' });
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'This PBS endpoint is unavailable.' }));
  app.use('/api', apiError);
  return app;
}
