import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Check, Copy, Download, ExternalLink as LinkIcon, LockKeyhole, Share2, ShieldCheck } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { api, messageFrom, send } from './api';
import type { AcademyData, CertificateRecord, CertificateTemplate } from './academy-types';
import type { Course, StudentWorkspaceData } from './types';
import { Button, dateLabel, DialogForm, Empty, Field, FormError, Input, Panel, Status, useApiResource, value } from './ui';
import { brandLogoData, useBranding } from './Branding';
import { type Branding } from './branding-types';
import { buildCertificatePdf } from './certificate-pdf';
import { PdfDocument } from './PdfDocument';
import { CertificateDesignPreview,CertificateEmail,CertificatePngField,ShareCertificatePdf,certificatePdfUrl,fetchCertificatePdf } from './CertificateTools';
import { InstitutionStampAdmin } from './InstitutionStamp';
import type { DocumentStamp } from './document-types';

const initialTemplate: CertificateTemplate = { courseId: '', title: 'Certificate of completion', issuer: 'Pragmatic BIM Solution', signer: 'Academic Director', signerRole: 'Authorized signatory', design: 'architectural', primaryColor: '#176BB7', accentColor: '#D4A94D' };
export type CertificateView = Pick<CertificateRecord, 'id' | 'studentName' | 'courseTitle' | 'issuedAt' | 'revokedAt' | 'template' | 'historical'>;
export const verificationUrl = (record: CertificateRecord) => `${location.origin}/verify/certificate/${encodeURIComponent(record.publicToken)}`;
export const linkedInShareUrl = (url: string) => `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`;

export function CertificateDialog({ record, onClose, celebrate = false }: { record: CertificateRecord; onClose: () => void; celebrate?: boolean }) {
  const { brand } = useBranding();
  const load=useCallback(()=>fetchCertificatePdf(certificatePdfUrl(record)),[record.id]);
  const celebrationCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!celebrate || !brand.motionEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let active = true, stop = () => {};
    void import('canvas-confetti').then(({ default: confetti }) => {
      if (!active || !celebrationCanvas.current) return;
      const fire = confetti.create(celebrationCanvas.current, { resize: true, useWorker: true });
      stop = () => fire.reset();
      void fire({ particleCount: 48, spread: 58, origin: { y: .4 }, colors: ['#176BB7', '#D4A94D', '#dce5ed'], disableForReducedMotion: true });
    });
    return () => { active = false; stop(); };
  }, [celebrate, brand.motionEnabled]);
  return <PortalDialog title="Your course certificate" className="pbs-dialog-wide pbs-certificate-dialog" onClose={onClose}>
    {celebrate && <canvas ref={celebrationCanvas} className="pbs-award-confetti" aria-hidden="true" />}
    {celebrate && <div className="pbs-certificate-earned"><Award size={34} /><div><h3>You earned your PBS credential</h3><p>Your course completion is recorded. Download your certificate, then enable public verification to share it on LinkedIn.</p></div></div>}
    <PdfDocument load={load} filename={`${record.id}.pdf`} label={`${record.studentName} — ${record.courseTitle}`}/><div className="pbs-actions"><ShareCertificatePdf record={record}/></div><CertificateEmail record={record}/>
    {record.historical?.hasOriginal&&!record.revokedAt&&<a className="pbs-button pbs-button-outline" href={`/api/certificates/${record.id}/original`} target="_blank" rel="noopener noreferrer">Download original certificate PDF</a>}
    <p className="pbs-muted">{record.studentName} · {record.courseTitle} · Issued {dateLabel(record.issuedAt)}{record.historical?` · ${record.historical.mode} training completed ${dateLabel(record.historical.completedAt+'T12:00:00Z')}`:''}</p>
  </PortalDialog>;
}

export function StudentCertificates({ data, academy, onSaved, onFeedback }: { data: StudentWorkspaceData; academy: AcademyData; onSaved: () => Promise<unknown>; onFeedback?: () => void }) {
  const [selected, setSelected] = useState<CertificateRecord>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const completed = new Set(data.completions.map(item => item.lessonId));
  return <div className="pbs-live-stack">
    <section className="pbs-achievement-banner"><span className="pbs-achievement-icon"><Award size={39} /></span><div><p className="pbs-eyebrow">Your work, recognized</p><h2>Turn your learning into a credential.</h2><p>Complete your lessons, pass the assessment, and share what you have earned.</p></div><strong>{academy.certificates.filter(item => !item.revokedAt).length}<small>certificates earned</small></strong></section>
    <FormError error={error} />
    {onFeedback && academy.certificates.some(item => !item.revokedAt) && <div className="pbs-actions"><Button quiet onClick={onFeedback}><Share2 size={16} />Share your course feedback</Button></div>}
    {!data.courses.length && !academy.certificates.length && <Panel title="Course achievements"><Empty title="Your next achievement starts here">Enroll in a course to begin working toward a PBS certificate.</Empty></Panel>}
    <div className="pbs-certificate-grid">{data.courses.filter(course=>!academy.certificates.some(r=>r.courseId===course.id&&r.historical)).map(course => {
      const record = academy.certificates.find(item => item.courseId === course.id);
      const lessons = course.modules.flatMap(module => module.lessons);
      const done = lessons.filter(lesson => completed.has(lesson.id)).length;
      const passed = data.assessmentResults.find(item => item.courseId === course.id)?.passed;
      const eligible = lessons.length > 0 && done === lessons.length && passed;
      return <Panel key={course.id} title={course.title} className="pbs-achievement-card">
        <span className="pbs-achievement-card-icon"><Award size={32} /></span>
        <Status value={record?.revokedAt ? 'Revoked' : record ? 'Earned' : eligible ? 'Ready to claim' : 'In progress'} />
        <p className="pbs-muted">{done} of {lessons.length} lessons complete · {passed ? 'Assessment passed' : 'Assessment required'}</p>
        <ol className="pbs-certificate-milestones"><li className={done === lessons.length && lessons.length ? 'pbs-milestone-done' : ''}><span>{done === lessons.length && lessons.length ? <Check size={15} /> : '1'}</span><div><strong>Complete the lessons</strong><small>{done} / {lessons.length} complete</small></div></li><li className={passed ? 'pbs-milestone-done' : ''}><span>{passed ? <Check size={15} /> : '2'}</span><div><strong>Pass the assessment</strong><small>{passed ? 'Assessment passed' : 'Available after every lesson'}</small></div></li><li className={record && !record.revokedAt ? 'pbs-milestone-done' : eligible ? 'pbs-milestone-ready' : ''}><span>{record && !record.revokedAt ? <Check size={15} /> : <Award size={15} />}</span><div><strong>{record ? 'Credential recorded' : eligible ? 'Your certificate is ready' : 'Earn your course credential'}</strong><small>{record ? 'Download and choose how to share' : eligible ? 'Claim your permanent certificate' : 'Your progress is saved as you learn'}</small></div></li></ol>
        <progress max={Math.max(lessons.length, 1)} value={done} aria-label={`${course.title} certificate progress`} />
        {record && !record.revokedAt ? <>
          <p className="pbs-reference">{record.id}</p><div className="pbs-actions"><Button onClick={() => { setCelebrate(false); setSelected(record); }}><Download size={16} /> View & download</Button></div>
          <label className="pbs-check"><input type="checkbox" checked={record.published} disabled={busy === record.id} onChange={async event => {
            const published = event.target.checked; setBusy(record.id); setError('');
            try { await send(`/student/certificates/${record.id}`, { published }, 'PATCH'); await onSaved(); } catch (error) { setError(messageFrom(error)); } finally { setBusy(''); }
          }} /> Enable public verification</label><p className="pbs-muted pbs-small">Publishes your name, course and credential details. Your email and payment records stay private.</p>
          {record.published && <div className="pbs-actions"><ShareCertificatePdf record={record}/><a className="pbs-text-button" href={`https://www.linkedin.com/profile/add?${new URLSearchParams({ startTask: 'CERTIFICATION_NAME', name: course.title, organizationName: record.template.issuer, issueYear: String(new Date(record.issuedAt).getFullYear()), issueMonth: String(new Date(record.issuedAt).getMonth() + 1), certId: record.historical?.originalNumber||record.id, certUrl: certificatePdfUrl(record,true) })}`} target="_blank" rel="noopener noreferrer">Add credential <LinkIcon size={15} /></a><Button quiet onClick={async () => { try { await navigator.clipboard.writeText(verificationUrl(record)); setCopied(record.id); } catch { setError('Copy the verification URL from View certificate.'); } }}>{copied === record.id ? <Check size={16} /> : <Copy size={16} />} {copied === record.id ? 'Copied' : 'Copy link'}</Button><a className="pbs-text-button" href={verificationUrl(record)} target="_blank" rel="noreferrer">Verify <LinkIcon size={15} /></a></div>}
        </> : <Button disabled={!eligible || Boolean(record?.revokedAt) || busy === course.id} onClick={async () => {
          setBusy(course.id); setError('');
          try { const record = await send<CertificateRecord>(`/student/courses/${course.id}/certificate`); await onSaved(); setCelebrate(true); setSelected(record); }
          catch (error) { setError(messageFrom(error)); } finally { setBusy(''); }
        }}>{eligible ? <Award size={16} /> : <LockKeyhole size={16} />} {busy === course.id ? 'Issuing…' : 'Claim certificate'}</Button>}
      </Panel>;
    })}{academy.certificates.filter(r=>r.historical||!data.courses.some(c=>c.id===r.courseId)).map(record=><Panel key={record.id} title={record.courseTitle} className="pbs-achievement-card">
      <Status value={record.revokedAt?'Revoked':record.historical?'Verified past training':'Earned'}/><p>{record.studentName}</p><p className="pbs-muted">{record.historical?`${record.historical.mode} · Completed ${dateLabel(record.historical.completedAt+'T12:00:00Z')}`:`Issued ${dateLabel(record.issuedAt)}`}</p>
      <p className="pbs-reference">{record.historical?.originalNumber||record.id}</p><Button onClick={()=>{setCelebrate(false);setSelected(record);}}>View & download certificate</Button>
      {!record.revokedAt&&<><label className="pbs-check"><input type="checkbox" checked={record.published} disabled={busy===record.id} onChange={async e=>{setBusy(record.id);setError('');try{await send(`/student/certificates/${record.id}`,{published:e.target.checked},'PATCH');await onSaved();}catch(e){setError(messageFrom(e));}finally{setBusy('');}}}/>Enable public verification</label><p className="pbs-muted pbs-small">Publishes your name, training and credential reference so you can share it.</p>{record.published&&<div className="pbs-actions"><ShareCertificatePdf record={record}/><a className="pbs-text-button" href={`https://www.linkedin.com/profile/add?${new URLSearchParams({startTask:'CERTIFICATION_NAME',name:record.courseTitle,organizationName:record.template.issuer,issueYear:record.issuedAt.slice(0,4),issueMonth:String(new Date(record.issuedAt).getUTCMonth()+1),certId:record.historical?.originalNumber||record.id,certUrl:certificatePdfUrl(record,true)})}`} target="_blank" rel="noopener noreferrer">Add credential to profile</a><Button quiet onClick={async()=>{try{await navigator.clipboard.writeText(verificationUrl(record));setCopied(record.id);}catch{setError('Open the verification link and copy its address.');}}}>{copied===record.id?'Copied':'Copy verification link'}</Button></div>}</>}
    </Panel>)}</div>
    {selected && <CertificateDialog record={selected} celebrate={celebrate} onClose={() => setSelected(undefined)} />}
  </div>;
}

export function CertificateStudio({ courses, records, onSaved }: { courses: Course[]; records: CertificateRecord[]; onSaved: () => Promise<unknown> }) {
  const [courseId, setCourseId] = useState('');
  const [draft, setDraft] = useState<CertificateTemplate>(initialTemplate);
  const [loading, setLoading] = useState(false),[assetLoads,setAssetLoads]=useState(0);
  const assetBusy=(busy:boolean)=>setAssetLoads(n=>Math.max(0,n+(busy?1:-1)));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const [selected, setSelected] = useState<CertificateRecord>();
  const [revoking, setRevoking] = useState<CertificateRecord>();
  async function load(id: string) {
    const version = ++requestVersion.current; setCourseId(id); setLoading(true); setError(''); setNotice('');
    try { const result = await api<CertificateTemplate>(`/admin/certificate-template?courseId=${encodeURIComponent(id)}`); if (version === requestVersion.current) setDraft({ ...result, courseId: id }); }
    catch (error) { if (version === requestVersion.current) setError(messageFrom(error)); } finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => { void load(''); }, []);
  return <div className="pbs-live-stack">
    <div className="pbs-studio-intro"><span className="pbs-eyebrow">PBS credential studio</span><h2>Make every achievement feel earned.</h2><p className="pbs-muted">Set your academy style, or customize a certificate for a specific course.</p></div>
    <div className="pbs-certificate-editor">
      <Panel title="Design settings"><form className="pbs-live-form" onSubmit={async event => {
        event.preventDefault(); if (loading||assetLoads) return; setLoading(true); setError(''); setNotice('');
        try { await send('/admin/certificate-template', { ...draft, courseId }, 'PUT'); await onSaved(); setNotice('Certificate design saved.'); }
        catch (error) { setError(messageFrom(error)); } finally { setLoading(false); }
      }}><Field label="Apply design to"><select value={courseId} onChange={event => void load(event.target.value)}><option value="">All courses (default)</option>{courses.map(course => <option value={course.id} key={course.id}>{course.title}</option>)}</select></Field>
        <Field label="Certificate design"><select value={draft.design} onChange={event => setDraft(current => ({ ...current, design: event.target.value as CertificateTemplate['design'] }))}><option value="architectural">Architectural</option><option value="classic">Classic frame</option><option value="minimal">Minimal</option></select></Field>
        <Input label="Certificate title" value={draft.title} maxLength={120} required onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
        <Input label="Issuer" value={draft.issuer} maxLength={120} required onChange={event => setDraft(current => ({ ...current, issuer: event.target.value }))} />
        <div className="pbs-form-grid"><Input label="Primary color" type="color" value={draft.primaryColor} onChange={event => setDraft(current => ({ ...current, primaryColor: event.target.value }))} /><Input label="Accent color" type="color" value={draft.accentColor} onChange={event => setDraft(current => ({ ...current, accentColor: event.target.value }))} /></div>
        <Input label="Signatory name" value={draft.signer} maxLength={120} required onChange={event => setDraft(current => ({ ...current, signer: event.target.value }))} />
        <Input label="Signatory role" value={draft.signerRole} maxLength={120} required onChange={event => setDraft(current => ({ ...current, signerRole: event.target.value }))} />
        <CertificatePngField onBusy={assetBusy} label="Certificate logo PNG (optional)" data={draft.logoImage||''} onChange={logoImage=>setDraft(d=>({...d,logoImage}))}/><CertificatePngField onBusy={assetBusy} label="Authorized signature PNG (optional)" data={draft.signatureImage||''} onChange={signatureImage=>setDraft(d=>({...d,signatureImage}))}/><Input label="Program duration printed on certificate (optional)" value={draft.durationLabel||''} maxLength={100} onChange={e=>setDraft(d=>({...d,durationLabel:e.target.value}))}/><Field label="Certificate details / learning summary"><textarea value={draft.detailText||''} rows={4} maxLength={320} onChange={e=>setDraft(d=>({...d,detailText:e.target.value}))}/></Field>
        <p className="pbs-muted pbs-small">Every certificate uses A4 landscape, 297 × 210 mm. Fixed logo, stamp and signature slots keep images proportional across downloads, public verification and email attachments.</p><FormError error={error} />{notice && <p className="pbs-form-status" role="status">{notice}</p>}<button className="pbs-button pbs-button-primary" disabled={loading||assetLoads>0}>{loading ? 'Saving…' : 'Save design'}</button>
      </form></Panel>
      <div className="pbs-certificate-preview"><p className="pbs-eyebrow">Live preview</p><CertificateDesignPreview template={draft} courseTitle={courses.find(item=>item.id===courseId)?.title||'Course title'}/><p className="pbs-muted pbs-small">Recipient details and credential IDs come from actual completed enrollments. Design changes also update certificate downloads.</p></div>
    </div>
    <InstitutionStampAdmin />
    <Panel title="Issued credentials">{!records.length && <Empty title="No credentials issued yet">Students earn certificates by completing every lesson and passing the assessment.</Empty>}{records.map(record => <article className="pbs-record-row" key={record.id}><div><h3>{record.studentName}</h3><p className="pbs-muted">{record.courseTitle} · {dateLabel(record.issuedAt)}</p><p className="pbs-reference">{record.id}</p></div><div className="pbs-actions"><Status value={record.revokedAt ? 'Revoked' : 'Earned'} /><Button quiet onClick={() => setSelected(record)}>View credential</Button>{!record.revokedAt && <Button quiet onClick={() => setRevoking(record)}>Revoke</Button>}</div></article>)}</Panel>
    {selected && <CertificateDialog record={selected} onClose={() => setSelected(undefined)} />}
    {revoking && <DialogForm title="Revoke this credential" detail={`${revoking.studentName} · ${revoking.courseTitle}`} submit="Revoke credential" onClose={() => setRevoking(undefined)} onSubmit={async form => {
      await send(`/admin/certificates/${revoking.id}/revoke`, { reason: value(form, 'reason') }); setRevoking(undefined); await onSaved();
    }}><p className="pbs-muted">This permanently marks the credential as revoked and updates its public verification page.</p><Field label="Reason for revocation"><textarea name="reason" rows={3} maxLength={1000} required /></Field></DialogForm>}
  </div>;
}

export function PublicCertificate({token}:{token:string}) {return <VerifiedCertificate key={token} token={token}/>;}
function VerifiedCertificate({token}:{token:string}) {
  const {brand}=useBranding(),{data,error}=useApiResource<CertificateView>(`/certificates/verify/${encodeURIComponent(token)}`);
  const load=useCallback(()=>fetchCertificatePdf(`/api/certificates/verify/${encodeURIComponent(token)}/pdf`),[token]);
  return <main className="pbs-public-certificate"><a href="/" className="pbs-text-button"><img src={brand.logoUrl} width="32" height="32" alt={brand.shortName}/>{brand.academyName}</a><FormError error={error}/>{!data&&!error&&<p role="status" className="pbs-muted">Verifying credential…</p>}{data&&<><div className={`pbs-verification-status ${data.revokedAt?'pbs-is-revoked':''}`}><ShieldCheck size={24}/><div><h1>{data.revokedAt?'Credential revoked':'Verified PBS credential'}</h1><p>{data.studentName} · {data.courseTitle}</p><p>Issued {dateLabel(data.issuedAt)} · {data.historical?.originalNumber||data.id}</p></div></div><PdfDocument key={data.id} load={load} filename={`${data.id}.pdf`} label={`${data.studentName} — ${data.courseTitle}`}/></>}</main>;
}
