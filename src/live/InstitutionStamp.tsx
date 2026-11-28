import { useEffect, useState } from 'react';
import { CertificatePngField } from './CertificateTools';
import { Save, Stamp } from 'lucide-react';
import type { DocumentStamp } from './document-types';
import { send, messageFrom } from './api';
import { Button, Field, FormError, Input, Panel, useApiResource } from './ui';

export function InstitutionSeal({ stamp }: { stamp: DocumentStamp }) {
  if (!stamp.enabled) return null;
  if (stamp.imageData) return <img className="pbs-institution-seal" src={stamp.imageData} alt={`${stamp.institution} institutional stamp`} />;
  const words = stamp.institution.split(/\s+/); let top = '', bottom = '';
  for (const word of words) { if (top.length < stamp.institution.length / 2) top += `${top ? ' ' : ''}${word}`; else bottom += `${bottom ? ' ' : ''}${word}`; }
  return <svg className="pbs-institution-seal" viewBox="0 0 160 160" role="img" aria-label={`${stamp.institution} institutional stamp`}>
    {stamp.design === 'round' ? <><circle cx="80" cy="80" r="75" fill="none" stroke={stamp.color} strokeWidth="3" /><circle cx="80" cy="80" r="67" fill="none" stroke={stamp.accent} strokeWidth="1.5" /></> : <><rect x="5" y="5" width="150" height="150" rx="6" fill="none" stroke={stamp.color} strokeWidth="3" /><rect x="13" y="13" width="134" height="134" rx="3" fill="none" stroke={stamp.accent} strokeWidth="1.5" /></>}
    <g fill={stamp.color} textAnchor="middle" fontFamily="Arial, sans-serif"><text x="80" y="39" fontSize="10" fontWeight="700">{top}</text><text x="80" y="52" fontSize="10" fontWeight="700">{bottom}</text><text x="80" y="88" fontSize="26" fontWeight="700">{stamp.center}</text><text x="80" y="111" fontSize="9">{stamp.caption}</text><text x="80" y="126" fontSize="8">{stamp.location}</text></g>
    <circle cx="25" cy="80" r="3" fill={stamp.accent} /><circle cx="135" cy="80" r="3" fill={stamp.accent} />
  </svg>;
}

export function DocumentSeal() {
  const { data } = useApiResource<DocumentStamp>('/document-stamp');
  return data?.enabled ? <div className="pbs-document-stamp"><InstitutionSeal stamp={data} /></div> : null;
}

export function InstitutionStampAdmin() {
  const resource = useApiResource<DocumentStamp>('/document-stamp');
  const [draft, setDraft] = useState<DocumentStamp>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''),[imageBusy,setImageBusy]=useState(false);
  useEffect(() => { if (resource.data) setDraft(resource.data); }, [resource.data]);
  const edit = <K extends keyof DocumentStamp>(key: K, v: DocumentStamp[K]) => setDraft(current => current ? { ...current, [key]: v } : current);
  return <Panel title="Other document stamp"><p className="pbs-muted pbs-small">For receipts, brochures, fee statements, student IDs and bonafide letters. Certificates retain their fixed gold PBS seal.</p><FormError error={error || resource.error} />{draft && <form className="pbs-stamp-editor" onSubmit={async event => {
    event.preventDefault(); if(imageBusy)return;setBusy(true); setError(''); setNotice('');
    try { const saved = await send<DocumentStamp>('/admin/document-stamp', draft, 'PUT'); setDraft(saved); await resource.refresh(); setNotice('Stamp saved for receipts, brochures, fee statements, student IDs and bonafide letters.'); }
    catch (problem) { setError(messageFrom(problem)); } finally { setBusy(false); }
  }}><div className="pbs-live-form"><label className="pbs-check"><input type="checkbox" checked={draft.enabled} onChange={e => edit('enabled', e.target.checked)} /> Apply the institution stamp to other documents</label>
    <div className="pbs-form-grid"><Field label="Seal design"><select value={draft.design} onChange={e => edit('design', e.target.value as DocumentStamp['design'])}><option value="round">Double-ring seal</option><option value="square">Square seal</option></select></Field><Input label="Center text" value={draft.center} required maxLength={16} onChange={e => edit('center', e.target.value)} /></div>
    <Input label="Institution name" value={draft.institution} required maxLength={70} onChange={e => edit('institution', e.target.value)} /><Input label="Stamp caption" value={draft.caption} required maxLength={60} onChange={e => edit('caption', e.target.value)} /><Input label="Location or office (optional)" value={draft.location} maxLength={50} onChange={e => edit('location', e.target.value)} />
    <div className="pbs-form-grid"><Input label="Seal color" type="color" value={draft.color} onChange={e => edit('color', e.target.value)} /><Input label="Accent color" type="color" value={draft.accent} onChange={e => edit('accent', e.target.value)} /></div>
    <CertificatePngField onBusy={setImageBusy} label="Institution stamp PNG" data={draft.imageData} onChange={data=>edit('imageData',data)}/>
    <p className="pbs-muted pbs-small"><a href="/brand-assets/PBS-Institution-Stamp.png" download>Download small PBS stamp PNG</a> · <a href="/brand-assets/PBS-Website-Logo.png" download>Download website logo PNG</a></p>
    {draft.imageData && <Button quiet onClick={() => edit('imageData', '')}>Use generated seal instead</Button>}
    {notice && <p className="pbs-form-status" role="status">{notice}</p>}<button className="pbs-button pbs-button-primary" disabled={busy||imageBusy}><Save size={16} />{busy ? 'Saving…' : 'Save institution stamp'}</button>
  </div><div className="pbs-stamp-preview"><Stamp size={24} /><InstitutionSeal stamp={draft} /><p>Used on newly downloaded receipts, brochures and other administrative documents. Certificates keep their fixed gold seal.</p></div></form>}</Panel>;
}
