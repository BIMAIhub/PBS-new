import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Cloud, Folder, Link2, LockKeyhole, Mail, Settings, Video } from 'lucide-react';
import type { Course, Enrollment } from './types';
import type { IntegrationStatus } from './academy-types';
import { api, messageFrom, send } from './api';
import { AssignmentStorageSettings } from './AssignmentUploads';
import {MailConnectionSettings} from './MailConnectionSettings';
import { GrantAccessButton } from './AcademyAdmin';
import { Button, DialogForm, Empty, ExternalLink, Field, FormError, Input, Panel, PasswordInput, Status, useApiResource, value } from './ui';

type DriveItem = { id: string; name: string; folder?: unknown; video?: unknown; webUrl: string; parentReference: { driveId: string } };
export function Integrations({ courses, enrollments, onSaved }: { courses: Course[]; enrollments: Enrollment[]; onSaved: () => Promise<unknown> }) {
  const resource = useApiResource<IntegrationStatus>('/admin/integrations/microsoft'), data=resource.data;
  const [dialog,setDialog]=useState<'config'|'folder'|'reset'>(),[purpose,setPurpose]=useState<'storage'|'mail'>('storage');
  const [problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(() => new URLSearchParams(location.search).get('integration') || '');
  useEffect(()=>{if(notice)window.history.replaceState(null,'','/?page=integrations');},[]);
  async function saved(){await resource.refresh();await onSaved();setDialog(undefined);setProblem('');}
  const configured=data&&(purpose==='mail'?data.mail:data);
  return <div className="pbs-live-stack"><FormError error={resource.error||problem}/>
    {notice&&<p className="pbs-form-status" role="status">{notice==='connected'?'Microsoft account connected.':notice==='reset'?'Saved application and account connection cleared. Add a new application when ready.':'Microsoft connection did not finish. Check the redirect URL, app credentials and consent.'}<button type="button" className="pbs-text-button" onClick={()=>setNotice('')}>Dismiss</button></p>}
    <section className="pbs-integration-banner"><div className="pbs-integration-icon"><Cloud size={32}/></div><div><h2>Your storage. Your sending account.</h2><p>Keep your existing OneDrive capacity and send academy mail through your company’s Titan or Microsoft 365 mailbox.</p></div></section>
    <MailConnectionSettings/>
    {data&&<><div className="pbs-academy-grid">{(['storage','mail'] as const).map(role=>{const item=role==='mail'?data.mail:data;return <Panel key={role} title={role==='mail'?'Microsoft 365 email connection':'OneDrive storage account'} action={<Status value={item.connected?'Connected':'Not connected'}/>}>
      {item.connected?<div className="pbs-connection-identity"><span className="pbs-connection-mark"><CheckCircle2/></span><div><strong>{item.connected.name}</strong><p className="pbs-muted">{item.connected.email}</p></div></div>:<p className="pbs-muted">{role==='mail'?'Connect info@pragmaticbim.com or another Microsoft 365 / Outlook mailbox. No OneDrive subscription is needed for this connection.':'Connect the Microsoft account that owns your 5 TB OneDrive. It is used for course videos, sharing and assignment uploads.'}</p>}
      <p className="pbs-muted pbs-small">{role==='mail'?'Permissions: User.Read and Mail.Send.':'Permissions: User.Read and Files.ReadWrite. Sharing invitations are disabled.'}</p>
      <div className="pbs-actions"><Button disabled={!item.configured||!data.encryptionReady||busy} onClick={async()=>{setBusy(true);setProblem('');try{const result=await send<{url:string}>('/admin/integrations/microsoft/connect',{purpose:role});window.location.assign(result.url);}catch(e){setProblem(messageFrom(e));setBusy(false);}}}><Link2 size={16}/>{item.connected?'Replace account':'Connect account'}</Button><Button quiet onClick={()=>{setPurpose(role);setDialog('config');}}><Settings size={16}/>App settings</Button>
      {item.connected&&<Button quiet disabled={busy} onClick={async()=>{setBusy(true);try{await send(`/admin/integrations/microsoft?purpose=${role}`,undefined,'DELETE');await saved();}catch(e){setProblem(messageFrom(e));}finally{setBusy(false);}}}>Disconnect</Button>}
      <Button quiet onClick={()=>{setPurpose(role);setDialog('reset');}}>Clear saved setup</Button></div>
    </Panel>;})}</div>
    <Panel title="Microsoft application setup"><ol className="pbs-setup-steps"><li>Register a web app in Microsoft Entra. You may use separate app registrations for storage and email.</li><li>Register the redirect URL below for each app. Select the account types needed by your OneDrive and company mailbox.</li><li>Save the client ID and secret for each connection, then sign in with the correct account.</li></ol><Input label="Web redirect URL" value={data.redirectUri} readOnly autoComplete="off" onFocus={e=>e.target.select()}/>{!data.encryptionReady&&<p className="pbs-form-error">Configure PBS_INTEGRATION_KEY on the server before saving connections.</p>}<ExternalLink href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Open Microsoft Entra</ExternalLink></Panel>
    <Panel title="Course video folders" action={<Button disabled={!data.connected||!courses.length} onClick={()=>setDialog('folder')}><Folder size={16}/>Link course folder</Button>}>{!data.storage.length&&<Empty title="No course folders linked">Choose a folder from your storage account.</Empty>}{data.storage.map(item=><article className="pbs-record-row" key={item.courseId}><div><h3>{courses.find(c=>c.id===item.courseId)?.title}</h3><p className="pbs-muted">{item.itemName} · {item.automatic?'Silent access after approval':'Manual access'}</p><ExternalLink href={item.webUrl}>Manage folder in OneDrive</ExternalLink></div><Status value={item.connected?'Connected':'Reconnect storage account'}/></article>)}</Panel>
    <AssignmentStorageSettings connected={Boolean(data.connected)} />
    <Panel title="Student course permissions">{enrollments.filter(e=>e.status==='approved').map(e=><article className="pbs-record-row" key={e.id}><div><h3>{e.studentName}</h3><p className="pbs-muted">{e.email} · {e.courseTitle}</p></div><GrantAccessButton enrollment={e} onSaved={onSaved}/></article>)}<p className="pbs-muted pbs-small">PBS requests read access without sending a OneDrive invitation email. Microsoft may still require an existing guest identity under your tenant policy. Restricted module playback is controlled inside PBS.</p></Panel>
    </>}
    {dialog==='config'&&configured&&<DialogForm key={purpose} title={purpose==='mail'?'Email application settings':'OneDrive application settings'} submit="Save application" onClose={()=>setDialog(undefined)} onSubmit={async form=>{await send('/admin/integrations/microsoft/config',{purpose,clientId:value(form,'applicationId'),tenant:value(form,'directoryId'),secret:String(form.get('applicationSecret')||''),current:String(form.get('adminConfirm')||'')},'PUT');await saved();}}>
      <Input label="Application (client) ID" name="applicationId" defaultValue={configured.clientId} required autoComplete="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"/>
      <Input label="Directory (tenant) ID" name="directoryId" defaultValue={configured.tenant||'common'} required autoComplete="off" spellCheck={false} note="Use common for a multi-account app, consumers for personal accounts, or your Microsoft 365 tenant ID."/>
      <PasswordInput label={configured.secretSaved?'New client secret (blank keeps saved value)':'Client secret value'} name="applicationSecret" autoComplete="new-password" required={!configured.secretSaved}/><PasswordInput label="Confirm with your current PBS admin password" name="adminConfirm" autoComplete="off" required/>
      <p className="pbs-muted pbs-small">This changes only the selected connection. Your other Microsoft account and PBS admin credentials are preserved.</p></DialogForm>}
    {dialog==='reset'&&<DialogForm title={`Clear ${purpose==='mail'?'email':'OneDrive'} setup`} submit="Clear saved application & connection" onClose={()=>setDialog(undefined)} onSubmit={async form=>{await send('/admin/integrations/microsoft/reset',{purpose,current:String(form.get('adminConfirm')||'')});await saved();setNotice('reset');}}><p className="pbs-muted">Remove the saved application ID, tenant, encrypted app secret and connection for this service. Files in OneDrive and the other Microsoft connection are preserved. Reconnect after adding a new app.</p><PasswordInput label="Current PBS admin password" name="adminConfirm" autoComplete="off" required/></DialogForm>}
    {dialog==='folder'&&<FolderPicker courses={courses} onClose={()=>setDialog(undefined)} onSaved={saved}/>}</div>;
}

function FolderPicker({ courses, onClose, onSaved }: { courses: Course[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [path, setPath] = useState<DriveItem[]>([]);
  const [selected, setSelected] = useState<DriveItem>();
  const [items, setItems] = useState<DriveItem[]>([]);
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const folder = path.at(-1);
  async function load(skip = '') {
    const current = ++version.current;
    setLoading(true); setError('');
    try {
      const response = await api<{ items: DriveItem[]; next: string }>(`/admin/integrations/microsoft/items?${new URLSearchParams({ driveId: folder?.parentReference.driveId || '', itemId: folder?.id || '', skip })}`);
      if (current === version.current) { setItems(prior => skip ? [...prior, ...response.items] : response.items); setNext(response.next); }
    } catch (error) { if (current === version.current) setError(messageFrom(error)); } finally { if (current === version.current) setLoading(false); }
  }
  useEffect(() => { setSelected(undefined); void load(); return () => { version.current++; }; }, [folder?.id, folder?.parentReference.driveId]);
  return <DialogForm title="Link a OneDrive course folder" submit="Save course access" onClose={onClose} onSubmit={async form => {
    const item = selected || folder;
    if (!item) throw new Error('Select a folder or video first.');
    await send(`/admin/courses/${value(form, 'courseId')}/storage`, { driveId: item.parentReference.driveId, itemId: item.id, automatic: form.has('automatic') }, 'PUT'); await onSaved();
  }} wide><Field label="PBS course"><select name="courseId" required>{courses.map(course => <option value={course.id} key={course.id}>{course.title}</option>)}</select></Field>
    <div className="pbs-drive-browser"><div className="pbs-section-top"><strong>{folder?.name || 'My OneDrive'}</strong>{folder && <Button quiet onClick={() => setPath(current => current.slice(0, -1))}><ArrowLeft size={16} /> Back</Button>}</div>
      <FormError error={error} />{loading && <p className="pbs-muted" role="status">Loading OneDrive…</p>}
      {items.filter(item => item.folder || item.video).map(item => <div className="pbs-drive-item" key={item.id}><label><input type="radio" name="driveItem" checked={selected?.id === item.id} onChange={() => setSelected(item)} />{item.folder ? <Folder size={19} /> : <Video size={19} />}<span>{item.name}</span></label>{item.folder && <button type="button" className="pbs-text-button" onClick={() => setPath(current => [...current, item])}>Open <ArrowRight size={15} /></button>}</div>)}
      {!items.length && !loading && !error && <p className="pbs-muted">No files in this folder.</p>}{next && <Button quiet disabled={loading} onClick={() => void load(next)}>Load more</Button>}
    </div><p className="pbs-muted">Selected <strong>{selected?.name || folder?.name || 'Choose a course folder'}</strong></p>
    <label className="pbs-check"><input type="checkbox" name="automatic" defaultChecked /> Grant access silently after enrollment approval</label><p className="pbs-muted">New approvals grant access without invitation emails. Use Grant OneDrive access for students already enrolled. Files shared as read-only may still be downloadable under your Microsoft policy.</p>
  </DialogForm>;
}
