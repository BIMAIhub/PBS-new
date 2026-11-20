import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Cloud, Folder, Link2, LockKeyhole, Mail, Settings, Video } from 'lucide-react';
import type { Course, Enrollment } from './types';
import type { IntegrationStatus } from './academy-types';
import { api, messageFrom, send } from './api';
import { GrantAccessButton } from './AcademyAdmin';
import { Button, DialogForm, Empty, ExternalLink, Field, FormError, Input, Panel, PasswordInput, Status, useApiResource, value } from './ui';

type DriveItem = { id: string; name: string; folder?: unknown; video?: unknown; webUrl: string; parentReference: { driveId: string } };
export function Integrations({ courses, enrollments, onSaved }: { courses: Course[]; enrollments: Enrollment[]; onSaved: () => Promise<unknown> }) {
  const { data, error, refresh } = useApiResource<IntegrationStatus>('/admin/integrations/microsoft');
  const [dialog, setDialog] = useState<'config' | 'folder'>();
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(() => new URLSearchParams(location.search).get('integration'));
  useEffect(() => {
    if (result) window.history.replaceState(null, '', '/');
  }, []);
  async function saved() { await refresh(); await onSaved(); setDialog(undefined); }
  return <div className="pbs-live-stack">
    <FormError error={error || problem} />
    {result && <p className={result === 'connected' ? 'pbs-form-status' : 'pbs-form-error'} role="status">{result === 'connected' ? 'Microsoft connected. You can now map course folders and send reminders.' : result === 'declined' ? 'Microsoft connection cancelled. You can reconnect when ready.' : 'Microsoft could not connect. Check the app credentials, registered redirect URL and consent, then try again.'}<button className="pbs-text-button" onClick={() => setResult(null)}>Dismiss</button></p>}
    <section className="pbs-integration-banner"><div className="pbs-integration-icon"><Cloud size={32} /></div><div><p className="pbs-eyebrow">Connected learning</p><h2>OneDrive, connected to enrollment.</h2><p>Approve a student in PBS and grant their email read access to the right course folder.</p></div><span className="pbs-integration-lock"><LockKeyhole size={19} /> Encrypted credentials</span></section>
    {data && <>
      <div className="pbs-academy-grid">
        <Panel title="Microsoft account" action={<Status value={data.connected ? 'Connected' : 'Not connected'} />}>
          {data.connected ? <div className="pbs-connection-identity"><span className="pbs-connection-mark"><CheckCircle2 /></span><div><strong>{data.connected.name}</strong><p className="pbs-muted">{data.connected.email}</p></div></div> : <p className="pbs-muted">Connect the Microsoft account that owns your course folders. PBS requests file sharing and email permissions.</p>}
          <div className="pbs-actions"><Button disabled={!data.configured || !data.encryptionReady || busy} onClick={async () => {
            setBusy(true); setProblem('');
            try { const response = await send<{ url: string }>('/admin/integrations/microsoft/connect'); window.location.assign(response.url); }
            catch (problem) { setProblem(messageFrom(problem)); setBusy(false); }
          }}><Link2 size={17} /> {data.connected ? 'Reconnect Microsoft' : 'Connect Microsoft'}</Button>
            {data.connected && <Button quiet disabled={busy} onClick={async () => {
              setBusy(true); setProblem('');
              try { await send('/admin/integrations/microsoft', undefined, 'DELETE'); await refresh(); }
              catch (error) { setProblem(messageFrom(error)); } finally { setBusy(false); }
            }}>Disconnect</Button>}
          </div><p className="pbs-muted pbs-small">Disconnecting stops future actions. Existing permissions remain in OneDrive.</p>
        </Panel>
        <Panel title="Application setup" action={<Button quiet onClick={() => setDialog('config')}><Settings size={16} /> Configure app</Button>}>
          <ol className="pbs-setup-steps"><li>Register a web application in Microsoft Entra.</li><li>Add the redirect URL below and delegated permissions <code>User.Read</code>, <code>Files.ReadWrite</code>, <code>Mail.Send</code>.</li><li>Save the application ID and secret, then connect your account.</li></ol>
          <label className="pbs-live-field"><span>Web redirect URL</span><input readOnly value={data.redirectUri} onFocus={event => event.target.select()} /></label>
          {!data.encryptionReady && <p className="pbs-form-error">Configure PBS_INTEGRATION_KEY on the server to protect saved credentials.</p>}
          <ExternalLink href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade">Open Microsoft Entra</ExternalLink>
        </Panel>
      </div>
      <Panel title="Course folders" action={<Button disabled={!data.connected || !courses.length} onClick={() => setDialog('folder')}><Folder size={17} /> Link a course folder</Button>}>
        {!data.storage.length && <Empty title="No course folders linked">Choose a OneDrive folder and turn on access after enrollment approval.</Empty>}
        {data.storage.map(item => <article className="pbs-record-row" key={item.courseId}><div><h3>{courses.find(course => course.id === item.courseId)?.title || 'Course'}</h3><p className="pbs-muted"><Folder size={15} /> {item.itemName} · {item.automatic ? 'Automatic on approval' : 'Manual access'}</p><ExternalLink href={item.webUrl}>Manage permissions in OneDrive</ExternalLink></div><Status value={item.connected ? 'Connected' : 'Reconnect owner'} /></article>)}
      </Panel>
      <Panel title="Grant access to enrolled students">
        {!enrollments.some(item => item.status === 'approved') && <Empty title="No approved enrollments">After approval, grant course access here or from the student's payment record.</Empty>}
        {enrollments.filter(item => item.status === 'approved').map(item => <article className="pbs-record-row" key={item.id}><div><h3>{item.studentName}</h3><p className="pbs-muted">{item.email} · {item.courseTitle}</p></div><GrantAccessButton enrollment={item} onSaved={onSaved} /></article>)}
      </Panel>
      <div className="pbs-inset pbs-integration-notes"><LockKeyhole size={22} /><div><h3>Video access and download policy</h3><p>Invitations require the student's email to sign in and grant read access. OneDrive read access may allow downloads. Set download restrictions in Microsoft 365 for those files, or upload private video lessons directly to PBS for enrollment-protected playback. Screen recording cannot be fully prevented.</p></div><Mail size={22} /><div><h3>Reminder delivery</h3><p>Microsoft email reminders are sent only when an admin chooses Send reminder. Every reminder also appears in the student's portal, with its delivery status recorded.</p></div></div>
    </>}
    {dialog === 'config' && data && <DialogForm title="Microsoft application settings" submit="Save application" onClose={() => setDialog(undefined)} onSubmit={async form => {
      await send('/admin/integrations/microsoft/config', { clientId: value(form, 'clientId'), tenant: value(form, 'tenant'), secret: String(form.get('secret') || ''), current: String(form.get('current') || '') }, 'PUT'); await saved();
    }}><Input label="Application (client) ID" name="clientId" defaultValue={data.clientId} required /><Input label="Directory (tenant) ID" name="tenant" defaultValue={data.tenant || 'common'} required note="Use your tenant ID for a work or school account, or common for a multi-account app." />
      <PasswordInput label={data.secretSaved ? 'New client secret (leave blank to keep saved)' : 'Client secret value'} name="secret" autoComplete="new-password" required={!data.secretSaved} />
      <PasswordInput label="Confirm with your PBS admin password" name="current" autoComplete="current-password" required /><p className="pbs-muted">Credentials and Microsoft token caches are encrypted on the server. App and tenant changes disconnect existing accounts.</p></DialogForm>}
    {dialog === 'folder' && <FolderPicker courses={courses} onClose={() => setDialog(undefined)} onSaved={saved} />}
  </div>;
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
    <label className="pbs-check"><input type="checkbox" name="automatic" defaultChecked /> Automatically invite the student's email after enrollment approval</label><p className="pbs-muted">New approvals trigger invitations. Use Grant OneDrive access for students already enrolled. Files shared as read-only may still be downloadable under your Microsoft policy.</p>
  </DialogForm>;
}
