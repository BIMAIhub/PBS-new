import { useRef, useState, type FormEvent } from 'react';
import { Download, FileText, MapPin, Save, Upload, UserRound } from 'lucide-react';
import type { Account } from './types';
import type { StudentProfile } from './experience-types';
import { api, messageFrom, send } from './api';
import { Button, Field, FormError, Input, Panel, useApiResource, value } from './ui';

export function ProfilePage({ account, onAccount }: { account: Account; onAccount: (account: Account) => void }) {
  const { data, error, refresh } = useApiResource<StudentProfile>('/student/profile/details');
  const [problem, setProblem] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [file, setFile] = useState<File>();
  const input = useRef<HTMLInputElement>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setProblem(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await send<{ account: Account; profile: StudentProfile }>('/student/profile/details', { name: value(form, 'name'), phone: value(form, 'phone'), headline: value(form, 'headline'), location: value(form, 'location'), about: value(form, 'about'), skills: value(form, 'skills').split(',').map(item => item.trim()).filter(Boolean), showCv: form.has('showCv') }, 'PATCH');
      onAccount(result.account); await refresh(); setNotice('Your profile is saved.');
    } catch (error) { setProblem(messageFrom(error)); } finally { setBusy(false); }
  }
  return <div className="pbs-live-stack"><div className="pbs-profile-intro"><span className="pbs-profile-portrait">{account.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span><div><h2>{account.name}</h2><p>{account.email}</p><span>Student profile & professional details</span></div></div><FormError error={problem || error} />{notice && <p className="pbs-form-status" role="status">{notice}</p>}
    {data && <div className="pbs-profile-layout"><Panel title="Profile details"><form className="pbs-live-form" onSubmit={save}>
      <div className="pbs-form-grid"><Input label="Full name" name="name" defaultValue={data.name} maxLength={120} required /><Input label="Phone" name="phone" defaultValue={data.phone} type="tel" /></div>
      <Input label="Professional headline" name="headline" defaultValue={data.headline} maxLength={160} placeholder="Your role and BIM specialism" /><Input label="Location" name="location" defaultValue={data.location} maxLength={120} placeholder="City or region" />
      <Field label="About your work"><textarea name="about" rows={5} maxLength={3000} defaultValue={data.about} /></Field><Input label="Skills" name="skills" defaultValue={data.skills.join(', ')} maxLength={1200} note="Separate up to 20 skills with commas." placeholder="Revit MEP, coordination, documentation" />
      <label className="pbs-check"><input type="checkbox" name="showCv" defaultChecked={data.showCv} /> Allow CV downloads on my published portfolio</label><p className="pbs-muted pbs-small">Your professional details appear on your portfolio when you publish it. Your email and phone stay private.</p>
      <button className="pbs-button pbs-button-primary" disabled={busy}><Save size={17} />{busy ? 'Saving…' : 'Save profile'}</button></form></Panel>
      <div className="pbs-live-stack"><Panel title="Your CV"><div className="pbs-cv-file"><FileText size={32} /><div><strong>{data.cvName || 'Add your professional CV'}</strong><p>{data.cvSize ? `${Math.ceil(data.cvSize / 1024)} KB · PDF` : 'PDF · up to 3 MB'}</p></div></div>
        <label className="pbs-cv-upload"><Upload size={22} /><strong>{file?.name || 'Choose a PDF CV'}</strong><span>Stored privately until you enable sharing</span><input ref={input} type="file" accept="application/pdf,.pdf" aria-label="Choose PDF CV" onChange={event => { const selected = event.target.files?.[0]; if (selected && selected.size > 3 * 1024 * 1024) { setProblem('Choose a PDF smaller than 3 MB.'); return; } setFile(selected); setProblem(''); }} /></label>
        <div className="pbs-actions"><Button disabled={!file || busy} onClick={async () => { if (!file) return; setBusy(true); setProblem(''); setNotice(''); try { await api(`/student/profile/cv?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }); setFile(undefined); if (input.current) input.current.value = ''; await refresh(); setNotice('CV uploaded privately. Enable portfolio sharing when you are ready.'); } catch (error) { setProblem(messageFrom(error)); } finally { setBusy(false); } }}><Upload size={16} />{busy ? 'Working…' : 'Upload CV'}</Button>
          {data.cvName && <a className="pbs-button pbs-button-outline" href="/api/student/profile/cv"><Download size={16} /> Download</a>}
          {data.cvName && <Button quiet disabled={busy} onClick={async () => { setBusy(true); setProblem(''); try { await send('/student/profile/cv', undefined, 'DELETE'); await refresh(); setNotice('CV removed and public downloads disabled.'); } catch (error) { setProblem(messageFrom(error)); } finally { setBusy(false); } }}>Remove CV</Button>}
        </div></Panel><Panel title="Portfolio visibility"><p className="pbs-muted">Publish selected projects, experience, education and credentials from My portfolio. Your CV has its own sharing control.</p></Panel></div>
    </div>}
  </div>;
}
