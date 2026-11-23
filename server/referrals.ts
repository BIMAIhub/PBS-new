import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, saveSetting } from './academy-data.js';
import { badRequest, conflict, field, integer, notFound, route } from './http.js';
import { enrollmentById, hasCourseAccess, issueReceipt } from './records.js';
import { portalOrigin } from './microsoft.js';
import { queueAutomation, processMailQueue } from './mail.js';
import { ensureReferralCode, reconcileReferrals, referralProgram, referralRows, walletBalance } from './referral-data.js';
import type { ReferralProgram } from '../src/live/engagement-types.js';

export async function notifyReferralCredits(db: WritableDatabase, credits: Awaited<ReturnType<typeof reconcileReferrals>>, origin: string) {
  for(const reward of credits)await queueAutomation(db,'referral_credit',`referral:${reward.id}`,reward.studentId,origin,{reward:`INR ${(reward.amount/100).toLocaleString('en-IN',{minimumFractionDigits:2})}`});
}
export function mountReferrals(app: Express, db: WritableDatabase) {
  app.get('/api/student/referral-dashboard',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'); const credits=await reconcileReferrals(db,new Date(),{ownerId:account.id});await notifyReferralCredits(db,credits,portalOrigin(req));
    const code=await ensureReferralCode(db,account.id),stats=await db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='credited' THEN amount ELSE 0 END),0) AS earned,COALESCE(SUM(CASE WHEN status='credited' THEN 1 ELSE 0 END),0) AS credited FROM referrals WHERE referrer_id=?`).get(account.id);
    res.json({program:await referralProgram(db),code,referrals:await referralRows(db,account.id),balance:await walletBalance(db,account.id),earned:Number(stats?.earned||0),total:Number(stats?.total||0),credited:Number(stats?.credited||0),waiting:Number(stats?.total||0)-Number(stats?.credited||0),entries:await db.prepare('SELECT id,amount,kind,note,created_at AS createdAt FROM referral_wallet WHERE account_id=? ORDER BY created_at DESC LIMIT 100').all(account.id)});
  }));
  app.get('/api/admin/referrals',route(async(req,res)=>{
    await requireAccount(db,req,'admin');const credits=await reconcileReferrals(db);await notifyReferralCredits(db,credits,portalOrigin(req));
    res.json({program:await referralProgram(db),referrals:await referralRows(db),leaders:await db.prepare(`SELECT a.id,a.name,a.email,COUNT(r.id) AS referrals,COALESCE(SUM(CASE WHEN r.status='credited' THEN 1 ELSE 0 END),0) AS credited,COALESCE(SUM(CASE WHEN r.status='credited' THEN r.amount ELSE 0 END),0) AS earned FROM accounts a JOIN referrals r ON r.referrer_id=a.id GROUP BY a.id ORDER BY credited DESC,referrals DESC,a.name LIMIT 100`).all()});
  }));
  app.put('/api/admin/referral-program',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');const current=await referralProgram(db);
    if(String(req.body?.revision||'')!==current.revision)throw conflict('The program changed. Refresh before saving.');
    for(const key of ['enabled','autoCredit','requireReferrerPaid','requireStudentPaid'])if(typeof req.body?.[key]!=='boolean')throw badRequest('Choose valid referral conditions.');
    const next:ReferralProgram={enabled:req.body.enabled,autoCredit:req.body.autoCredit,requireReferrerPaid:req.body.requireReferrerPaid,requireStudentPaid:req.body.requireStudentPaid,rewardAmount:integer(req.body?.rewardAmount,'reward amount',0,10000000),waitDays:integer(req.body?.waitDays,'waiting days',0,90),minimumFee:integer(req.body?.minimumFee,'minimum course fee',0,100000000),friendDiscountPercent:integer(req.body?.friendDiscountPercent,'friend discount',0,90),revision:makeId()};
    await transaction(db,async tx=>{if((await referralProgram(tx)).revision!==current.revision)throw conflict('The program changed. Refresh before saving.');await saveSetting(tx,'referral_program',JSON.stringify(next));await audit(tx,admin.id,'Referral program updated','',`Reward INR ${next.rewardAmount/100}; ${next.waitDays} day wait. Existing captured terms preserved.`);});res.json(next);
  }));
  app.post('/api/admin/referrals/:id/credit',route(async(req,res)=>{
    await requireAccount(db,req,'admin');const credits=await reconcileReferrals(db,new Date(),{onlyId:req.params.id,allowCredit:true});await notifyReferralCredits(db,credits,portalOrigin(req));
    const row=await db.prepare('SELECT status,referrer_id,amount FROM referrals WHERE id=?').get(req.params.id);if(!row)throw notFound('This referral is unavailable.');if(row.status!=='credited')throw conflict('The payment conditions and waiting period must finish before crediting.');res.json({credited:true});
  }));
  app.post('/api/admin/referrals/:id/email',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');const row=await db.prepare("SELECT referrer_id,amount FROM referrals WHERE id=? AND status='credited'").get(req.params.id);if(!row)throw conflict('Credit the eligible reward before sending a confirmation.');
    const eventKey=`referral:${req.params.id}`,prior=await db.prepare('SELECT status,admin_id FROM mail_outbox WHERE event_key=?').get(eventKey);
    if(prior?.status==='accepted'){res.json({accepted:0,alreadySent:true});return;}
    if(prior&&prior.status!=='pending')throw conflict('Review this confirmation in Email campaigns before trying delivery again.');
    if(prior&&prior.admin_id!==admin.id)throw conflict('This confirmation is queued for the configured automatic sender. Use that account or the daily job to send it.');
    const queued=await queueAutomation(db,'referral_credit',eventKey,String(row.referrer_id),portalOrigin(req),{reward:`INR ${(Number(row.amount)/100).toFixed(2)}`},admin.id);
    if(!queued.queued)throw conflict(queued.reason||'Configure email automation first.');res.json(await processMailQueue(db,admin.id));
  }));
  app.post('/api/student/wallet/pay',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'),enrollmentId=field(req.body?.enrollmentId,'enrollment',80),requestKey=field(req.body?.requestKey,'payment request',80),amount=integer(req.body?.amount,'wallet amount',1,100000000);
    const result=await transaction(db,async tx=>{
      const previous=await tx.prepare('SELECT account_id,amount,note FROM referral_wallet WHERE request_key=?').get(requestKey);
      if(previous){if(previous.account_id!==account.id||Number(previous.amount)!==-amount||previous.note!==enrollmentId)throw conflict('This wallet request belongs to another payment.');return{alreadyApplied:true};}
      const e=await enrollmentById(tx,enrollmentId);if(e.studentId!==account.id||!await hasCourseAccess(tx,account,e.courseId))throw notFound('This enrollment is unavailable.');
      if(amount>await walletBalance(tx,account.id))throw conflict('The wallet balance is insufficient.');
      const receipt=await issueReceipt(tx,enrollmentId,amount,'PBS wallet',`PBS-WALLET-${requestKey}`,null);
      await tx.prepare("INSERT INTO referral_wallet (id,account_id,amount,kind,note,request_key,created_at) VALUES (?,?,?,'course_payment',?,?,?)").run(makeId(),account.id,-amount,enrollmentId,requestKey,now());
      return{receipt,alreadyApplied:false};
    });res.json(result);
  }));
}
