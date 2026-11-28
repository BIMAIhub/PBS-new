import type {Express} from 'express';
import {requireAccount} from './auth.js';
import type {WritableDatabase} from './database.js';
import {manualMailSender} from './mail.js';
import {conflict,route} from './http.js';
import {mailDomainReport} from './mail-domain.js';
export function mountMailDeliverability(app:Express,db:WritableDatabase){
  app.get('/api/admin/mail/deliverability',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),sender=await manualMailSender(db,admin.id);if(!sender)throw conflict('Connect the company Microsoft 365 mailing account first.');
    const account=await db.prepare('SELECT profile_email FROM microsoft_mail_connections WHERE admin_id=?').get(sender);if(!account)throw conflict('Select the connected mailing account.');
    const email=String(account.profile_email);res.json({email,...await mailDomainReport(email)});
  }));
}
