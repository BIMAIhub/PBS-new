import { createHash, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import type { WritableDatabase } from './database.js';
import { RequestError, route } from './http.js';
import { processMailQueue } from './mail.js';
import { portalOrigin } from './microsoft.js';
import { reconcileReferrals } from './referral-data.js';
import { notifyReferralCredits } from './referrals.js';

export function mountEngagementJobs(app: Express, db: WritableDatabase) {
  app.get('/api/jobs/academy', route(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new RequestError(503, 'Scheduled academy processing is not configured.');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(req.get('authorization') || ''), digest(`Bearer ${secret}`))) throw new RequestError(401, 'Scheduled request is unauthorized.');
    const rewards = await reconcileReferrals(db);
    await notifyReferralCredits(db, rewards, portalOrigin(req));
    const mail = await processMailQueue(db, undefined, 20);
    res.json({ credited: rewards.length, mail });
  }));
}
