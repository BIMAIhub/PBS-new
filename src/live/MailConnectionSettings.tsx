import {useState} from 'react';
import {Mail} from 'lucide-react';
import {send} from './api';
import {Button,DialogForm,Input,Panel,PasswordInput,Status,FormError,useApiResource,value} from './ui';

type MailConnection={provider:'titan'|'microsoft';revision:string;encryptionReady:boolean;
  smtp:{email:string;connectedAt:string;passwordSaved:boolean}|null;microsoft:{email:string;name:string}|null;
  companySender:{id:string;email:string;provider:'titan'|'microsoft'}|null};
export function MailConnectionSettings({onSaved}:{onSaved?:()=>Promise<unknown>}) {
  const resource=useApiResource<MailConnection>('/admin/integrations/mail'),data=resource.data;
  const [dialog,setDialog]=useState<'titan'|'microsoft'|'disconnect'>(),[notice,setNotice]=useState('');
  async function saved(message:string){setDialog(undefined);setNotice(message);await resource.refresh();await onSaved?.();}
  return <Panel title="Company mailing provider" action={<Status value={data?.companySender?'Connected':'Not connected'}/>}>
    <FormError error={resource.error}/>
    <p className="pbs-muted">Use GoDaddy Professional Email / Titan for your company mailbox, or Microsoft 365 for an Exchange Online mailbox. OneDrive storage is connected separately.</p>
    {data?.companySender&&<p><strong>{data.companySender.email}</strong> · {data.companySender.provider==='titan'?'Titan SMTP':'Microsoft 365'} · Selected for PBS mail</p>}
    {notice&&<p className="pbs-form-status" role="status">{notice}</p>}
    {data&&<><div className="pbs-inset"><h3>GoDaddy Professional Email / Titan</h3><p className="pbs-muted">{data.smtp?`Saved mailbox: ${data.smtp.email}`:'Connect info@pragmaticbim.com using its Titan mailbox password.'}</p><p className="pbs-muted pbs-small">smtpout.secureserver.net · Port 465 · SSL/TLS</p><div className="pbs-actions"><Button disabled={!data.encryptionReady} onClick={()=>setDialog('titan')}><Mail size={16}/>{data.smtp?'Edit Titan connection':'Connect Titan SMTP'}</Button>{data.smtp&&<Button quiet onClick={()=>setDialog('disconnect')}>Remove saved Titan connection</Button>}</div></div>
      {data.microsoft&&<div className="pbs-inset"><h3>Microsoft 365 mailbox</h3><p className="pbs-muted">{data.microsoft.email}</p><Button quiet onClick={()=>setDialog('microsoft')}>Use this Microsoft mailbox for PBS mail</Button></div>}
      {!data.encryptionReady&&<p className="pbs-form-error">The server integration encryption key must be configured before connecting a mailbox.</p>}
      <p className="pbs-muted pbs-small">Saving Titan checks the connection without sending an email. Campaigns, account messages, reminders and certificate emails use the selected provider. SMTP emails may not appear in your mailbox’s Sent folder.</p>
    </>}
    {data&&dialog==='titan'&&<DialogForm title="Connect Titan company email" submit="Verify & use Titan for PBS mail" onClose={()=>setDialog(undefined)} onSubmit={async form=>{
      await send('/admin/integrations/mail/titan',{revision:data.revision,email:value(form,'mailboxEmail'),password:String(form.get('mailboxSecret')||''),current:String(form.get('pbsAdminConfirm')||'')},'PUT');
      await saved('Titan sign-in verified and selected for PBS mail. No email was sent.');
    }}><p className="pbs-muted">Enter the password for your GoDaddy Professional Email / Titan mailbox. PBS encrypts it on the server. Your PBS sign-in password stays unchanged.</p>
      <Input label="Company mailbox email" name="mailboxEmail" type="email" required defaultValue={data.smtp?.email||'info@pragmaticbim.com'} autoComplete="off" spellCheck={false}/>
      <PasswordInput label={data.smtp?'Mailbox password (blank keeps the saved value for the same address)':'Titan mailbox password'} name="mailboxSecret" required={!data.smtp} autoComplete="new-password"/>
      <PasswordInput label="Confirm with your current PBS administrator password" name="pbsAdminConfirm" autoComplete="off" required/>
    </DialogForm>}
    {data&&dialog==='microsoft'&&<DialogForm title="Use Microsoft 365 for PBS mail" submit="Select Microsoft mailbox" onClose={()=>setDialog(undefined)} onSubmit={async form=>{
      await send('/admin/integrations/mail/provider',{provider:'microsoft',revision:data.revision,current:String(form.get('pbsAdminConfirm')||'')});await saved('Microsoft 365 selected for PBS mail.');
    }}><p className="pbs-muted">Use {data.microsoft?.email} for PBS emails. A Titan mailbox needs the Titan SMTP connection.</p><PasswordInput label="Current PBS administrator password" name="pbsAdminConfirm" autoComplete="off" required/></DialogForm>}
    {data&&dialog==='disconnect'&&<DialogForm title="Remove saved Titan connection" submit="Remove Titan connection" onClose={()=>setDialog(undefined)} onSubmit={async form=>{
      await send('/admin/integrations/mail/titan',{revision:data.revision,current:String(form.get('pbsAdminConfirm')||'')},'DELETE');await saved('Saved Titan credentials removed. Select or reconnect a mailing provider before sending.');
    }}><p className="pbs-muted">Remove the encrypted Titan mailbox password from PBS. Existing email history and OneDrive access are preserved. If Titan is selected, sending pauses until you reconnect or select another mailbox.</p><PasswordInput label="Current PBS administrator password" name="pbsAdminConfirm" autoComplete="off" required/></DialogForm>}
  </Panel>;
}
