import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type WritableDatabase,makeId,now,transaction } from './database.js';
import { audit } from './academy-data.js';
import { badRequest,conflict,field,integer,notFound,route } from './http.js';
import { seal,unseal,portalOrigin } from './microsoft.js';
import { referralProgram,walletBalance } from './referral-data.js';
import { verifyPassword } from './passwords.js';
import { queueAutomation } from './mail.js';
import type { BankDetails } from '../src/live/learning-types.js';

const masked=(bank:BankDetails)=>({...bank,account:`•••• ${bank.account.slice(-4)}`});
export function mountReferralPayouts(app:Express,db:WritableDatabase){
  app.get('/api/student/referral-payouts',route(async(req,res)=>{
    const a=await requireAccount(db,req,'student'),row=await db.prepare('SELECT sealed_details,revision FROM referral_bank_details WHERE account_id=?').get(a.id);
    res.json({payoutsEnabled:(await referralProgram(db)).bankPayoutsEnabled,bank:row?{...masked(JSON.parse(unseal(String(row.sealed_details)))),revision:row.revision}:null,payouts:await db.prepare('SELECT id,amount,status,reference,note,created_at AS createdAt,paid_at AS paidAt FROM referral_payouts WHERE account_id=? ORDER BY created_at DESC LIMIT 100').all(a.id),balance:await walletBalance(db,a.id)});
  }));
  app.put('/api/student/referral-bank',route(async(req,res)=>{
    const a=await requireAccount(db,req,'student');await transaction(db,async tx=>{const prior=await tx.prepare('SELECT sealed_details,revision FROM referral_bank_details WHERE account_id=?').get(a.id);if(String(prior?.revision||'')!==String(req.body?.revision||''))throw conflict('Your bank details changed. Refresh and try again.');
      const old=prior?JSON.parse(unseal(String(prior.sealed_details))):undefined;
      const bank:BankDetails={holder:field(req.body?.holder,'account holder name',120),bank:field(req.body?.bank,'bank name',100),account:field(req.body?.account,'bank account',24,false)||old?.account||'',ifsc:field(req.body?.ifsc,'IFSC',11).toUpperCase(),upi:field(req.body?.upi,'UPI ID',100,false),revision:makeId()};
      if(!/^\d{8,18}$/.test(bank.account)||!/^([A-Z]{4})0[A-Z0-9]{6}$/.test(bank.ifsc)||bank.upi&&!/^[\w.+-]+@[\w.-]+$/.test(bank.upi))throw badRequest('Enter a valid bank account number, IFSC and optional UPI ID.');
      await tx.prepare('INSERT INTO referral_bank_details VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET sealed_details=excluded.sealed_details,revision=excluded.revision,updated_at=excluded.updated_at').run(a.id,seal(JSON.stringify(bank)),bank.revision,now());await audit(tx,a.id,'Referral payout details updated',a.id,'Encrypted bank details saved.');
    });res.status(204).end();
  }));
  app.post('/api/student/referral-payouts',route(async(req,res)=>{
    const a=await requireAccount(db,req,'student'),amount=integer(req.body?.amount,'payout amount',100,10000000),requestKey=field(req.body?.requestKey,'payout request',80);
    const result=await transaction(db,async tx=>{
      const existing=await tx.prepare('SELECT id,account_id,amount FROM referral_payouts WHERE request_key=?').get(requestKey);if(existing){if(existing.account_id!==a.id||Number(existing.amount)!==amount)throw conflict('This request belongs to another payout.');return{id:existing.id,alreadyRequested:true};}
      if(!(await referralProgram(tx)).bankPayoutsEnabled)throw conflict('New bank payout requests are currently paused by PBS.');
      const bank=await tx.prepare('SELECT sealed_details FROM referral_bank_details WHERE account_id=?').get(a.id);if(!bank)throw badRequest('Save your bank details first.');
      if(amount>await walletBalance(tx,a.id))throw conflict('The available earned reward is insufficient.');
      const id=makeId();await tx.prepare('INSERT INTO referral_payouts (id,account_id,amount,bank_snapshot,request_key,created_at) VALUES (?,?,?,?,?,?)').run(id,a.id,amount,bank.sealed_details,requestKey,now());
      await tx.prepare("INSERT INTO referral_wallet (id,account_id,amount,kind,note,request_key,created_at) VALUES (?,?,?,'payout_reserved',?,?,?)").run(makeId(),a.id,-amount,id,`payout-reserve:${id}`,now());
      await audit(tx,a.id,'Referral payout requested',id,`INR ${(amount/100).toFixed(2)}`);return{id,alreadyRequested:false};
    });res.json(result);
  }));
  app.get('/api/admin/referral-payouts',route(async(req,res)=>{
    await requireAccount(db,req,'admin');res.json({payouts:await db.prepare('SELECT p.id,p.account_id AS studentId,a.name AS studentName,a.email,p.amount,p.status,p.reference,p.note,p.created_at AS createdAt,p.paid_at AS paidAt FROM referral_payouts p JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT 250').all()});
  }));
  app.post('/api/admin/referral-payouts/:id/bank',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    const row=await db.prepare('SELECT bank_snapshot FROM referral_payouts WHERE id=?').get(req.params.id);if(!row)throw notFound('This payout request is unavailable.');await audit(db,admin.id,'Payout bank details viewed',req.params.id,'');res.json(JSON.parse(unseal(String(row.bank_snapshot))));
  }));
  app.post('/api/admin/referral-payouts/:id/decision',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin');if(!await verifyPassword(String(req.body?.current||''),admin.passwordHash))throw badRequest('The current admin password is incorrect.');
    const status=field(req.body?.status,'payout decision',20),reference=field(req.body?.reference,'transfer reference',80,false),note=field(req.body?.note,'payout note',1000,false);
    if(!['processing','paid','rejected'].includes(status)||status==='paid'&&(req.body?.transferConfirmed!==true||reference.length<4))throw badRequest('Confirm the completed transfer and enter its bank reference before marking a payout paid.');
    const result=await transaction(db,async tx=>{
      const p=await tx.prepare('SELECT * FROM referral_payouts WHERE id=?').get(req.params.id);if(!p)throw notFound('This payout is unavailable.');
      if(p.status===status){if(status==='paid'&&p.reference!==reference)throw conflict('The recorded transfer reference differs.');return{changed:false,accountId:String(p.account_id),amount:Number(p.amount)};}
      if(p.status==='paid'||p.status==='rejected')throw conflict('This payout has already been finalized.');
      await tx.prepare('UPDATE referral_payouts SET status=?,reference=?,note=?,paid_at=?,paid_by=? WHERE id=?').run(status,reference,note,status==='paid'?now():'',admin.id,p.id);
      if(status==='rejected')await tx.prepare("INSERT INTO referral_wallet (id,account_id,amount,kind,note,request_key,created_at) VALUES (?,?,?,'payout_refund',?,?,?)").run(makeId(),p.account_id,p.amount,p.id,`payout-refund:${p.id}`,now());
      await audit(tx,admin.id,`Referral payout ${status}`,String(p.id),`INR ${(Number(p.amount)/100).toFixed(2)}; ${reference}`);return{changed:true,accountId:String(p.account_id),amount:Number(p.amount)};
    });
    const email=result.changed&&status==='paid'?await queueAutomation(db,'payout_paid',`payout:${req.params.id}`,result.accountId,portalOrigin(req),{reward:`INR ${(result.amount/100).toFixed(2)}`,message:`Transfer reference: ${reference}\n${note}`}):undefined;
    res.json({saved:true,emailQueued:email?.queued===true});
  }));
}
