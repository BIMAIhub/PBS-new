import { randomBytes } from 'node:crypto';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit, setting } from './academy-data.js';
import { badRequest } from './http.js';
import type { ReferralProgram } from '../src/live/engagement-types.js';

export const defaultReferralProgram: ReferralProgram = { enabled: true, autoCredit: true, bankPayoutsEnabled: true, rewardAmount: 100000, waitDays: 7, minimumFee: 100000,
  requireReferrerPaid: true, requireStudentPaid: true, friendDiscountPercent: 0, revision: '' };
export async function referralProgram(db: Database): Promise<ReferralProgram> { return { ...defaultReferralProgram, ...JSON.parse(await setting(db,'referral_program') || '{}') }; }
export async function ensureReferralCode(db: WritableDatabase, accountId: string) {
  const previous=await db.prepare('SELECT code FROM referral_codes WHERE account_id=?').get(accountId); if(previous) return String(previous.code);
  return transaction(db,async tx=>{ const current=await tx.prepare('SELECT code FROM referral_codes WHERE account_id=?').get(accountId);if(current)return String(current.code);
    const code=`PBS-${randomBytes(6).toString('hex').toUpperCase()}`; await tx.prepare('INSERT INTO referral_codes VALUES (?,?,?)').run(accountId,code,now());return code; });
}
export async function referralCodeOffer(db: Database, code: string, email: string, accountId: string) {
  const found=await db.prepare('SELECT c.account_id AS ownerId,a.email FROM referral_codes c JOIN accounts a ON a.id=c.account_id WHERE c.code=? COLLATE NOCASE').get(code);
  if(!found)return null;
  const program=await referralProgram(db);if(!program.enabled)throw badRequest('The referral program is currently paused.');
  if(found.ownerId===accountId || String(found.email).toLowerCase()===email.toLowerCase())throw badRequest('Use a referral code shared by another student.');
  const active=await db.prepare("SELECT 1 FROM accounts a WHERE a.id=? AND a.role='student' AND NOT EXISTS(SELECT 1 FROM account_controls c WHERE c.account_id=a.id AND c.status<>'active')").get(found.ownerId);
  if(!active)throw badRequest('This referral code is currently unavailable.');
  if(await db.prepare('SELECT 1 FROM referral_code_controls WHERE account_id=? AND enabled=0').get(found.ownerId))throw badRequest('This referral code has been paused by PBS.');
  return { ownerId:String(found.ownerId),percent:program.friendDiscountPercent,code };
}
export async function captureReferral(db: Database, enrollmentId: string, referrerId: string, code: string) {
  const program=await referralProgram(db);if(!program.enabled||!referrerId)return;
  const enrollment=await db.prepare('SELECT account_id,total FROM enrollments WHERE id=?').get(enrollmentId);if(!enrollment)return;
  if(enrollment.account_id===referrerId)throw badRequest('You cannot refer yourself.');
  if(await db.prepare('SELECT 1 FROM referrals WHERE referred_id=?').get(enrollment.account_id))return;
  if(await db.prepare("SELECT 1 FROM enrollments WHERE account_id=? AND id<>? AND status='approved'").get(enrollment.account_id,enrollmentId))return;
  const people=await db.prepare('SELECT id,email,phone FROM accounts WHERE id IN (?,?)').all(referrerId,enrollment.account_id);
  const owner=people.find(a=>a.id===referrerId),friend=people.find(a=>a.id===enrollment.account_id);
  if(!owner||!friend)return;
  const phone=(v:unknown)=>String(v||'').replace(/\D/g,'').slice(-10);
  if(String(owner.email).toLowerCase()===String(friend.email).toLowerCase() || phone(owner.phone).length>=8 && phone(owner.phone)===phone(friend.phone))throw badRequest('A referral must be for a different learner and contact number.');
  await db.prepare(`INSERT OR IGNORE INTO referrals (id,referrer_id,referred_id,enrollment_id,code,amount,wait_days,minimum_fee,require_referrer_paid,require_student_paid,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(makeId(),referrerId,enrollment.account_id,enrollmentId,code,program.rewardAmount,program.waitDays,program.minimumFee,Number(program.requireReferrerPaid),Number(program.requireStudentPaid),now());
}
async function paymentQualification(db: Database, accountId: string) {
  const row=await db.prepare(`SELECT a.created_at,COALESCE(c.status,'active') AS status,COALESCE(c.updated_at,a.created_at) AS activeAt FROM accounts a LEFT JOIN account_controls c ON c.account_id=a.id WHERE a.id=? AND a.role='student'`).get(accountId);
  const fees=await db.prepare(`SELECT e.total,e.approved_at,COALESCE(SUM(r.amount),0) AS paid,MAX(r.issued_at) AS paidAt FROM enrollments e LEFT JOIN receipts r ON r.enrollment_id=e.id WHERE e.account_id=? AND e.status='approved' GROUP BY e.id`).all(accountId);
  const legacy=fees.length?undefined:await db.prepare(`SELECT rc.verified_at AS updated_at FROM referral_code_controls rc WHERE rc.account_id=? AND rc.alumni_paid_verified=1 AND EXISTS(SELECT 1 FROM legacy_training h WHERE h.account_id=rc.account_id)`).get(accountId);
  const paid=fees.length>0?fees.every(e=>Number(e.paid)>=Number(e.total)):Boolean(legacy);
  const times=[String(row?.activeAt||''),String(legacy?.updated_at||''),...fees.map(e=>String(e.paidAt||e.approved_at))].map(Date.parse).filter(Number.isFinite);
  return {active:row?.status==='active',paid,at:times.length?Math.max(...times):0};
}
export async function reconcileReferrals(db: WritableDatabase, clock = new Date(), options: {ownerId?:string; onlyId?:string; allowCredit?:boolean} = {}) {
  const program=await referralProgram(db);const credited:{id:string;studentId:string;amount:number}[]=[];
  await transaction(db,async tx=>{
    const rows=await tx.prepare(`SELECT r.*,e.status AS enrollmentStatus,e.total FROM referrals r JOIN enrollments e ON e.id=r.enrollment_id WHERE r.status NOT IN ('credited','void') ${options.ownerId?'AND r.referrer_id=?':''} ${options.onlyId?'AND r.id=?':''} ORDER BY r.checked_at,r.created_at LIMIT 1000`).all(...(options.ownerId?[options.ownerId]:[]),...(options.onlyId?[options.onlyId]:[]));
    for(const row of rows){
      const owner=await paymentQualification(tx,String(row.referrer_id)),friend=await paymentQualification(tx,String(row.referred_id));
      const ownerPaid=!row.require_referrer_paid||owner.paid,friendPaid=!row.require_student_paid||friend.paid;
      const approved=row.enrollmentStatus==='approved';
      let reason=!owner.active||!friend.active?'An account is inactive.':!approved?'Waiting for enrollment approval.':Number(row.total)<Number(row.minimum_fee)?'The agreed fee does not meet the referral minimum.':!ownerPaid?'Waiting for the referrer’s verified fee payments.':!friendPaid?'Waiting for the new learner’s verified fee payments.':'';
      if(row.enrollmentStatus==='rejected'){await tx.prepare("UPDATE referrals SET status='void',reason='Enrollment was rejected.',checked_at=? WHERE id=?").run(clock.toISOString(),row.id);continue;}
      if(reason){await tx.prepare("UPDATE referrals SET status='pending',qualified_at='',eligible_at='',reason=?,checked_at=? WHERE id=?").run(reason,clock.toISOString(),row.id);continue;}
      const start=Math.max(Date.parse(String(row.created_at)),owner.at,friend.at,Date.parse(String(row.qualified_at))||0);
      const due=start+Number(row.wait_days)*86400000,eligible=clock.getTime()>=due;
      const qualifiedAt=new Date(start).toISOString(),eligibleAt=new Date(due).toISOString();
      const canCredit=eligible&&(program.autoCredit||options.allowCredit===true);
      if(canCredit){
        const entry=makeId();const result=await tx.prepare("INSERT OR IGNORE INTO referral_wallet (id,account_id,referral_id,amount,kind,note,created_at) VALUES (?,?,?,?,'referral','Qualified referral reward',?)").run(entry,row.referrer_id,row.id,row.amount,clock.toISOString());
        await tx.prepare("UPDATE referrals SET status='credited',qualified_at=?,eligible_at=?,credited_at=?,checked_at=?,reason='' WHERE id=?").run(qualifiedAt,eligibleAt,clock.toISOString(),clock.toISOString(),row.id);
        if(result.changes){credited.push({id:String(row.id),studentId:String(row.referrer_id),amount:Number(row.amount)});await audit(tx,'PBS','Referral wallet credited',String(row.id),`INR ${(Number(row.amount)/100).toFixed(2)}`);}
      }else await tx.prepare("UPDATE referrals SET status=?,qualified_at=?,eligible_at=?,checked_at=?,reason=? WHERE id=?").run(eligible?'eligible':'holding',qualifiedAt,eligibleAt,clock.toISOString(),eligible?'Eligible for admin credit.':'The payment conditions are complete; the waiting period is running.',row.id);
    }
  }); return credited;
}
export async function referralRows(db: Database, ownerId?: string) {
  const rows=await db.prepare(`SELECT r.*,a.name,c.title AS courseTitle,e.status AS enrollmentStatus FROM referrals r JOIN accounts a ON a.id=r.referred_id JOIN enrollments e ON e.id=r.enrollment_id JOIN courses c ON c.id=e.course_id ${ownerId?'WHERE r.referrer_id=?':''} ORDER BY r.created_at DESC LIMIT 250`).all(...(ownerId?[ownerId]:[]));
  const result=[];
  for(const r of rows){const owner=await paymentQualification(db,String(r.referrer_id)),friend=await paymentQualification(db,String(r.referred_id));result.push({id:String(r.id),name:String(r.name),courseTitle:String(r.courseTitle),status:r.status,amount:Number(r.amount),approved:r.enrollmentStatus==='approved',referrerPaid:owner.paid,studentPaid:friend.paid,waitDays:Number(r.wait_days),requireReferrerPaid:Boolean(r.require_referrer_paid),requireStudentPaid:Boolean(r.require_student_paid),qualifiedAt:String(r.qualified_at),eligibleAt:String(r.eligible_at),creditedAt:String(r.credited_at),createdAt:String(r.created_at),reason:String(r.reason),...(!ownerId?{referrerId:r.referrer_id,referredId:r.referred_id}: {})});}return result;
}
export async function walletBalance(db: Database, accountId: string){return Number((await db.prepare('SELECT COALESCE(SUM(amount),0) AS balance FROM referral_wallet WHERE account_id=?').get(accountId))?.balance||0);}
