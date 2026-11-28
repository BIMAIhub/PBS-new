import express from 'express';
import {mountStudentErasure} from './student-erasure.js';
import { openDatabase } from './database.js';
import { provisionInitialAdministrator } from './administrators.js';
import { mountCertificateDocuments } from './certificate-documents.js';
import { mountAuth, requireAccount } from './auth.js';
import { mountAdmin } from './admin.js';
import { mountCourseContent } from './course-content.js';
import { mountStudent } from './student.js';
import { mountMedia } from './media.js';
import { mountAcademy } from './academy.js';
import { migrateMicrosoftRoles, mountMicrosoft } from './microsoft.js';
import { mountCommerce, provisionReferenceCatalog } from './commerce.js';
import { mountProfiles } from './profiles.js';
import { mountNotifications } from './notifications.js';
import { mountCurriculum } from './curriculum.js';
import { generateLearningText } from './ai.js';
import { mountBranding } from './branding.js';
import { migrateLegacyLiveClasses, mountLiveClasses } from './live-classes.js';
import { migratePendingAdmissions, mountAdmissions } from './admissions.js';
import { mountFeedback } from './feedback.js';
import { mountControls } from './control-routes.js';
import { mountPlayback } from './playback.js';
import { mountDocumentStamp } from './document-stamp.js';
import { mountMail, mountPublicMail } from './mail.js';
import { mountReferrals } from './referrals.js';
import { mountEngagementJobs } from './engagement-jobs.js';
import { mountBatches } from './batches.js';
import { mountLearningProgress } from './learning-progress.js';
import { mountDriveUploads } from './drive-uploads.js';
import { mountAcademyLife } from './academy-life.js';
import { mountReferralPayouts } from './referral-payouts.js';
import { mountLearningQuizzes } from './learning-quizzes.js';
import { mountLeads } from './leads.js';
import { mountHistoricalStudents } from './historical-students.js';
import { mountLearningFiles } from './learning-files.js';
import { mountLearningResources } from './learning-resources.js';
import { mountAcademyReset } from './academy-reset.js';
import { mountPush, runPushCycle, type PushSender } from './push.js';
import type { graph,sendMicrosoftMail } from './microsoft.js';
import { apiError, field, limitAttempts, RequestError, route } from './http.js';

export async function createPortalApp(hosted = false, dependencies: {microsoftGraph?:typeof graph; defer?:(task:Promise<unknown>)=>void;microsoftMail?:typeof sendMicrosoftMail; pushSender?:PushSender} = {}) {
  const app = express();
  const publicOrigin = process.env.PBS_PUBLIC_ORIGIN ? new URL(process.env.PBS_PUBLIC_ORIGIN).origin : '';
  const db = await openDatabase(hosted);
  app.locals.portalDatabase = db;
  app.locals.runPushCycle = () => runPushCycle(db, dependencies.pushSender);
  try {
    await provisionInitialAdministrator(db);
    await provisionReferenceCatalog(db);
    await migrateLegacyLiveClasses(db);
    await migratePendingAdmissions(db);
    await migrateMicrosoftRoles(db);
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
  // Token-only mailing preferences use a native HTML form, without portal cookies.
  app.use('/api/mail/unsubscribe', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  mountPublicMail(app, db);
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
  app.use('/api/admin/learning-quizzes',express.json({limit:'768kb'}));
  app.use('/api/admin/certificate-template',express.json({limit:'512kb'}));
  app.use('/api', express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    const change = !['GET','HEAD','OPTIONS'].includes(req.method) &&
      !/^\/(auth|push|notifications|jobs)(\/|$)/.test(req.path) && !/\/(watch|progress|playback)(\/|$)/.test(req.path);
    if (dependencies.defer && (change || req.path === '/notifications')) {
      const finished = new Promise<boolean>(resolve => {
        res.once('finish', () => resolve(res.statusCode < 400));
        res.once('close', () => resolve(false));
      });
      dependencies.defer(finished.then(ok => ok ? app.locals.runPushCycle() : undefined).catch(() => {
        // Provider errors are sanitized in the delivery log. Never log subscription addresses or keys.
        console.warn('PBS phone notification processing will retry on the next check.');
      }));
    }
    next();
  });
  app.get('/api/health', route(async (_req, res) => {
    await db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  }));
  mountAuth(app, db, hosted);
  mountBranding(app, db, hosted);
  mountDocumentStamp(app, db);
  mountLiveClasses(app, db, hosted);
  mountAdmin(app, db, hosted);
  mountCourseContent(app, db);
  mountControls(app, db, hosted);
  mountStudentErasure(app,db,{defer:dependencies.defer,request:dependencies.microsoftGraph});
  mountPlayback(app, db, hosted);
  mountAdmissions(app, db, hosted);
  mountFeedback(app, db, hosted);
  mountStudent(app, db, hosted);
  mountMedia(app, db, hosted);
  mountAcademy(app, db, hosted);
  mountMicrosoft(app, db, hosted);
  mountCommerce(app, db, hosted);
  mountProfiles(app, db, hosted);
  mountNotifications(app, db);
  mountPush(app, db, hosted, dependencies.pushSender);
  mountCurriculum(app, db, hosted);
  mountMail(app, db, hosted);
  mountReferrals(app, db);
  mountEngagementJobs(app, db);
  mountBatches(app,db);
  mountLearningProgress(app,db,hosted);
  mountDriveUploads(app,db,dependencies.microsoftGraph);
  mountAcademyLife(app,db);
  mountReferralPayouts(app,db);
  mountAcademyReset(app,db,hosted);
  mountLeads(app,db,hosted);
  mountHistoricalStudents(app,db);
  mountCertificateDocuments(app,db,hosted,dependencies.microsoftMail);
  mountLearningFiles(app,db,dependencies.microsoftGraph);
  mountLearningResources(app,db);
  mountLearningQuizzes(app,db);

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
