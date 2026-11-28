import {createHash} from 'node:crypto';
import type {Express} from 'express';
import {requireAccount} from './auth.js';
import {type Database,type WritableDatabase,transaction} from './database.js';
import {audit} from './academy-data.js';
import {verifyPassword} from './passwords.js';
import {badRequest,conflict,notFound,route} from './http.js';

export async function releaseExpiredMailLocks(db:Database){
  // Older workers did not create leases. Give them a full grace period before declaring uncertainty.
  await db.prepare("INSERT OR IGNORE INTO mail_delivery_locks(outbox_id,lease_token,expires_at) SELECT id,'legacy-worker',? FROM mail_outbox WHERE status='sending'").run(Date.now()+120000);
  await db.prepare("UPDATE mail_outbox SET status='unknown',error='The sending worker timed out. Check Microsoft Sent Items before resending.' WHERE status='sending' AND id IN (SELECT outbox_id FROM mail_delivery_locks WHERE expires_at<=?)").run(Date.now());
  await db.prepare('DELETE FROM mail_delivery_locks WHERE expires_at<=?').run(Date.now());
}
export async function campaignDeletionPreview(db:Database,id:string){
  await releaseExpiredMailLocks(db);
  const campaign=await db.prepare('SELECT id,title,revision,status FROM mail_campaigns WHERE id=?').get(id);if(!campaign)throw notFound('This campaign is unavailable.');
  const deliveries=await db.prepare('SELECT id,status,email FROM mail_outbox WHERE campaign_id=? ORDER BY id').all(id),recipients=await db.prepare('SELECT email FROM mail_campaign_recipients WHERE campaign_id=? ORDER BY email').all(id);
  const summary={id,title:String(campaign.title),recipients:recipients.length,deliveryRecords:deliveries.length,accepted:deliveries.filter(d=>d.status==='accepted').length,queued:deliveries.filter(d=>d.status==='pending').length,sending:deliveries.filter(d=>d.status==='sending').length};
  return {...summary,reviewToken:createHash('sha256').update(JSON.stringify({campaign,deliveries,recipients})).digest('hex')};
}
export function mountMailHistory(app:Express,db:WritableDatabase){
  app.get('/api/admin/mail/campaigns/:id/deletion-preview',route(async(req,res)=>{await requireAccount(db,req,'admin');res.json(await campaignDeletionPreview(db,req.params.id));}));
  app.delete('/api/admin/mail/campaigns/:id',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    if(req.body?.confirmation!=='DELETE CAMPAIGN')throw badRequest('Type DELETE CAMPAIGN to confirm.');
    const removed=await transaction(db,async tx=>{
      const latest=await requireAccount(tx,req,'admin');if(latest.passwordHash!==admin.passwordHash)throw conflict('Your sign-in changed. Sign in again.');
      const preview=await campaignDeletionPreview(tx,req.params.id);if(req.body?.reviewToken!==preview.reviewToken)throw conflict('Campaign delivery records changed. Review the latest counts.');
      if(preview.sending)throw conflict('An email is currently sending. Wait for its result before deleting this history.');
      await tx.prepare('DELETE FROM mail_delivery_locks WHERE outbox_id IN (SELECT id FROM mail_outbox WHERE campaign_id=?)').run(req.params.id);
      await tx.prepare('DELETE FROM mail_outbox WHERE campaign_id=?').run(req.params.id);
      await tx.prepare('DELETE FROM campaign_lead_links WHERE campaign_id=?').run(req.params.id);
      await tx.prepare('DELETE FROM mail_campaign_recipients WHERE campaign_id=?').run(req.params.id);
      await tx.prepare('DELETE FROM mail_campaigns WHERE id=?').run(req.params.id);
      await tx.prepare('DELETE FROM academy_events WHERE target_id=?').run(req.params.id);
      await audit(tx,admin.id,'Email campaign history permanently deleted','',`${preview.recipients} recipient snapshots and ${preview.deliveryRecords} delivery records removed.`);
      return {recipients:preview.recipients,deliveries:preview.deliveryRecords};
    });res.json({deleted:true,removed});
  }));
}
