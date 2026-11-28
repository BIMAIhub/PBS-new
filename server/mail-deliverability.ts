import type {Express} from 'express';
import {requireAccount} from './auth.js';
import type {WritableDatabase} from './database.js';
import {manualMailSender} from './mail.js';
import {conflict,route} from './http.js';
import {mailDomainReport} from './mail-domain.js';
import {connectedMailSender} from './mail-senders.js';
export function mountMailDeliverability(app:Express,db:WritableDatabase){
  app.get('/api/admin/mail/deliverability',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),sender=await manualMailSender(db,admin.id);if(!sender)throw conflict('Connect the company mailing account in OneDrive & email first.');
    const account=await connectedMailSender(db,sender);if(!account)throw conflict('Select the connected mailing account.');
    res.json({email:account.email,provider:account.provider,...await mailDomainReport(account.email,undefined,account.provider)});
  }));
}
