import nodemailer,{type SendMailOptions} from 'nodemailer';
import type {Database} from './database.js';
import {publicBranding} from './branding.js';
import {brandedEmail} from './email-layout.js';
import {badRequest,conflict,RequestError} from './http.js';
import {checkMicrosoftMail,sendMicrosoftMail,unseal} from './microsoft.js';
import {connectedMailSender} from './mail-senders.js';

export type MailOptions=Parameters<typeof sendMicrosoftMail>[5];
export type MailTransport=typeof sendMicrosoftMail;
export type SmtpClient={verify:()=>Promise<unknown>;sendMail:(message:SendMailOptions)=>Promise<{accepted?:unknown[];rejected?:unknown[]}>;close:()=>void};
export type SmtpFactory=(auth:{email:string;password:string})=>SmtpClient;
export const titanSmtpFactory:SmtpFactory=({email,password})=>nodemailer.createTransport({
  host:'smtpout.secureserver.net',port:465,secure:true,
  auth:{user:email,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
  connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000,dnsTimeout:10000,
  logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
});
async function smtpOperation<T>(client:SmtpClient,operation:()=>Promise<T>) {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{client.close();reject(new Error('SMTP operation timed out.'));},20000);})]);}
  finally{if(timer)clearTimeout(timer);}
}

// Provider responses can contain credentials, recipients or message text. Return only fixed guidance.
export function smtpProblem(error:unknown,checking=false):RequestError {
  const data=error as {code?:string;responseCode?:number;command?:string};
  if(data?.code==='EAUTH')return conflict('Titan rejected the mailbox sign-in. Check the full company email address and mailbox password in OneDrive & email.');
  if(checking)return conflict('PBS could not verify the Titan SMTP connection. Check the mailbox credentials and that smtpout.secureserver.net:465 is available. No email was sent.');
  if(data?.responseCode&&data.responseCode>=400&&data.responseCode<600)return new RequestError(data.responseCode<500?429:422,`Titan rejected the email (SMTP ${data.responseCode}). Review the mailbox sending limits and recipient address before retrying.`);
  if(['EDNS','ECONNECTION','ESOCKET','ETIMEDOUT','ETLS'].includes(data?.code||'')&&['CONN','EHLO','STARTTLS','AUTH'].includes(data?.command||''))return conflict('The Titan SMTP connection failed before sending. Check the connection in OneDrive & email before retrying.');
  return new RequestError(502,'Email delivery is uncertain. Check with the mailbox provider or recipient before sending another copy. PBS will not resend automatically.');
}
export async function verifyTitan(auth:{email:string;password:string},factory:SmtpFactory=titanSmtpFactory) {
  let client:SmtpClient|undefined;
  try{client=factory(auth);await smtpOperation(client,()=>client!.verify());}catch(error){throw smtpProblem(error,true);}finally{client?.close();}
}
export async function smtpCredentials(db:Database,adminId:string) {
  const row=await db.prepare('SELECT email,password_sealed FROM smtp_mail_connections WHERE admin_id=?').get(adminId);
  if(!row)throw conflict('Reconnect the Titan mailing account in OneDrive & email.');
  let password:string;
  try{password=unseal(String(row.password_sealed));}catch{throw conflict('The saved Titan mailbox password could not be opened. Save the mailbox connection again.');}
  return {email:String(row.email),password};
}
export async function sendTitanMail(db:Database,adminId:string,email:string,subject:string,body:string,options:MailOptions={},factory:SmtpFactory=titanSmtpFactory) {
  const credentials=await smtpCredentials(db,adminId),brand=await publicBranding(db);
  if(options.unsubscribeUrl){const url=new URL(options.unsubscribeUrl);if(url.protocol!=='https:'||/[\r\n<>]/.test(options.unsubscribeUrl))throw badRequest('Choose a secure unsubscribe link.');}
  let client:SmtpClient|undefined;
  try{
    client=factory(credentials);
    const result=await smtpOperation(client,()=>client!.sendMail({from:{name:brand.academyName,address:credentials.email},to:{address:email,name:''},subject,
      text:`${body}\n\n${brand.academyName}${options.unsubscribeUrl?`\nUnsubscribe from offers and updates: ${options.unsubscribeUrl}`:''}\nSupport: ${brand.supportEmail}`,
      html:brandedEmail(brand,subject,body,options.unsubscribeUrl),
      ...(options.unsubscribeUrl?{headers:{'List-Unsubscribe':`<${options.unsubscribeUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}:{}),
      attachments:options.attachments?.map(file=>({filename:file.name,contentType:file.contentType,content:Buffer.from(file.contentBytes,'base64')})),
      disableFileAccess:true,disableUrlAccess:true}));
    if(!result.accepted?.length||result.rejected?.length)throw new RequestError(422,'Titan did not accept this recipient. Check the email address before retrying.');
  }catch(error){if(error instanceof RequestError)throw error;throw smtpProblem(error);}finally{client?.close();}
}
export async function sendPortalMail(db:Database,adminId:string,email:string,subject:string,body:string,options:MailOptions={},factory?:SmtpFactory){
  const sender=await connectedMailSender(db,adminId);if(!sender)throw conflict('Connect the selected PBS mailing account in OneDrive & email.');
  if(sender.provider==='titan')return sendTitanMail(db,adminId,email,subject,body,options,factory);
  return sendMicrosoftMail(db,adminId,email,subject,body,options);
}
export async function checkPortalMail(db:Database,adminId:string,factory:SmtpFactory=titanSmtpFactory) {
  const sender=await connectedMailSender(db,adminId);if(!sender)throw conflict('Connect the selected PBS mailing account in OneDrive & email.');
  if(sender.provider==='microsoft')return {...await checkMicrosoftMail(db,adminId),provider:sender.provider};
  await verifyTitan(await smtpCredentials(db,adminId),factory);
  return {email:sender.email,provider:sender.provider,checkedAt:new Date().toISOString(),status:'ready'};
}
