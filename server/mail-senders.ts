import type {Database} from './database.js';
import {setting} from './academy-data.js';

export type MailProvider='microsoft'|'titan';
export type MailSender={id:string;email:string;name:string;provider:MailProvider};

export async function connectedMailSenders(db:Database):Promise<MailSender[]> {
  return await db.prepare(`SELECT a.id,
    CASE WHEN p.provider='titan' THEN s.email ELSE m.profile_email END AS email,
    CASE WHEN p.provider='titan' THEN a.name ELSE m.profile_name END AS name,
    COALESCE(p.provider,'microsoft') AS provider
    FROM accounts a LEFT JOIN mail_sender_preferences p ON p.admin_id=a.id
    LEFT JOIN smtp_mail_connections s ON s.admin_id=a.id
    LEFT JOIN microsoft_mail_connections m ON m.admin_id=a.id
    WHERE a.role='admin' AND ((p.provider='titan' AND s.admin_id IS NOT NULL)
      OR (COALESCE(p.provider,'microsoft')='microsoft' AND m.admin_id IS NOT NULL))`).all() as MailSender[];
}
export async function connectedMailSender(db:Database,id:string) {
  return (await connectedMailSenders(db)).find(sender=>sender.id===id);
}
export async function manualMailSender(db:Database,preferred='') {
  const options=JSON.parse(await setting(db,'mail_automation')||'{}') as {senderId?:string};
  const connections=await connectedMailSenders(db);
  // An explicitly selected, disconnected company mailbox must never silently fall back.
  if(options.senderId)return connections.some(s=>s.id===options.senderId)?options.senderId:'';
  if(preferred&&connections.some(s=>s.id===preferred))return preferred;
  return connections.length===1?connections[0].id:'';
}
