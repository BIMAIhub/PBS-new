import { useEffect, useState, type FormEvent } from 'react';
import { Check, ImagePlus, Monitor, Paintbrush, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { useBranding } from './Branding';
import { defaultBrandSettings, type Branding, type BrandSettings } from './branding-types';
import { api, messageFrom, send } from './api';
import { Button, Field, FormError, Input, Panel } from './ui';
import { InstitutionStampAdmin } from './InstitutionStamp';

function BrandImageEditor({ kind }: { kind: 'logo' | 'hero' }) {
  const { brand, apply } = useBranding();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const [inputVersion, setInputVersion] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const logo = kind === 'logo', limit = (logo ? 512 : 2048) * 1024;
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  async function publish(reset = false) {
    if (busy || (!reset && !file)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = reset ? await api<Branding>(`/admin/branding/assets/${kind}`, { method: 'DELETE' }) :
        await api<Branding>(`/admin/branding/assets/${kind}`, { method: 'POST', headers: { 'Content-Type': file!.type }, body: file });
      apply(updated); setFile(undefined); setInputVersion(current => current + 1); setNotice(reset ? 'Default image restored' : `${logo ? 'Logo' : 'Background'} published across the website`);
    } catch (problem) { setError(messageFrom(problem)); } finally { setBusy(false); }
  }
  return <Panel title={logo ? 'Academy logo' : 'Hero background'}>
    <div className={`pbs-brand-asset-preview ${logo ? 'pbs-logo-preview' : 'pbs-hero-preview'}`}>
      <img src={preview || (logo ? brand.logoUrl : brand.heroUrl)} alt={logo ? 'Academy logo preview' : 'Website background preview'} />
      {logo && <div><strong>{brand.academyName}</strong><span>{brand.tagline}</span></div>}
    </div>
    <p className="pbs-muted">{logo ? 'Use a square PNG with transparency, JPEG or WebP, up to 512 KB. The logo appears in navigation, documents, certificates and the browser tab.' : 'Use a wide PNG, JPEG or WebP, up to 2 MB. Choose a background with room for the headline. It appears on sign-in and course discovery.'}</p>
    <Field label={logo ? 'Choose a logo' : 'Choose a background'}><input key={inputVersion} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
      const selected = event.target.files?.[0]; setError(''); setNotice('');
      if (selected && (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > limit || selected.size < 16)) { setError(`Choose a PNG, JPEG or WebP up to ${logo ? '512 KB' : '2 MB'}.`); setFile(undefined); return; }
      setFile(selected);
    }} /></Field>
    <FormError error={error} />{notice && <p className="pbs-form-status" role="status"><Check size={16} />{notice}</p>}
    <div className="pbs-actions"><Button disabled={!file || busy} onClick={() => void publish()}><Upload size={17} />{busy ? 'Publishing…' : logo ? 'Publish logo' : 'Publish background'}</Button>
      {(logo ? brand.logoUploaded : brand.heroUploaded) && <Button quiet disabled={busy} onClick={() => void publish(true)}><RotateCcw size={16} />Restore default</Button>}</div>
  </Panel>;
}

export function BrandingAdmin() {
  const { brand, apply } = useBranding();
  const [draft, setDraft] = useState<BrandSettings>(brand), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { let active = true; api<Branding>('/branding').then(current => { if (active) { setDraft(current); setLoaded(true); } }).catch(problem => { if (active) setError(messageFrom(problem)); }); return () => { active = false; }; }, []);
  const update = <K extends keyof BrandSettings>(key: K, value: BrandSettings[K]) => { setDraft(current => ({ ...current, [key]: value })); setNotice(''); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try { const updated = await send<Branding>('/admin/branding', draft, 'PUT'); apply(updated); setDraft(updated); setNotice('Branding saved across public pages and workspaces'); }
    catch (problem) { setError(messageFrom(problem)); } finally { setBusy(false); }
  }
  return <div className="pbs-live-stack">
    <section className="pbs-branding-intro"><Paintbrush size={32} /><div><h2>Make every touchpoint yours</h2><p>Manage the PBS identity, website copy and appearance from one place. Updates reach other open tabs automatically.</p></div><span><ShieldCheck size={16} />Admin controls</span></section>
    <div className="pbs-branding-assets"><BrandImageEditor kind="logo" /><BrandImageEditor kind="hero" /></div>
    <div className="pbs-branding-layout"><Panel title="Brand details & appearance">
      <form className="pbs-live-form" onSubmit={save}>
        <FormError error={error} />{notice && <p className="pbs-form-status" role="status">{notice}</p>}
        <div className="pbs-form-grid"><Input label="Academy name" value={draft.academyName} required maxLength={100} onChange={event => update('academyName', event.target.value)} /><Input label="Short name" value={draft.shortName} required maxLength={12} onChange={event => update('shortName', event.target.value)} /></div>
        <Input label="Brand tagline" value={draft.tagline} required maxLength={100} onChange={event => update('tagline', event.target.value)} />
        <Input label="Support email" type="email" value={draft.supportEmail} required maxLength={254} onChange={event => update('supportEmail', event.target.value)} />
        <div className="pbs-branding-divider"><Monitor size={18} /><h3>Website introduction</h3></div>
        <Input label="Hero label" value={draft.heroEyebrow} required maxLength={80} onChange={event => update('heroEyebrow', event.target.value)} />
        <Field label="Hero headline" note="A line break sets the headline rhythm on larger screens."><textarea value={draft.heroTitle} rows={2} required maxLength={100} onChange={event => update('heroTitle', event.target.value)} /></Field>
        <Field label="Hero description"><textarea value={draft.heroDescription} rows={3} required maxLength={500} onChange={event => update('heroDescription', event.target.value)} /></Field>
        <div className="pbs-branding-divider"><Paintbrush size={18} /><h3>Theme colours</h3><button type="button" className="pbs-text-button" onClick={() => setDraft(current => ({ ...current, primaryColor: '#176BB7', accentColor: '#D4A94D', backgroundColor: '#F4F7FA' }))}>Use PBS colours</button></div>
        <div className="pbs-brand-colors">{[{ key: 'primaryColor', label: 'Primary blue' }, { key: 'accentColor', label: 'Accent gold' }, { key: 'backgroundColor', label: 'Reading surface' }].map(({ key, label }) => <Field key={key} label={label}><span><input type="color" aria-label={label} value={draft[key as keyof BrandSettings] as string} onChange={event => update(key as 'primaryColor', event.target.value)} /><code>{draft[key as keyof BrandSettings]}</code></span></Field>)}</div>
        <label className="pbs-appearance-toggle"><span><strong>Glass surfaces</strong><small>Translucent panels and layered blue backgrounds</small></span><input type="checkbox" checked={draft.glassEnabled} onChange={event => update('glassEnabled', event.target.checked)} /></label>
        <label className="pbs-appearance-toggle"><span><strong>Interface animation</strong><small>Page transitions, dialog entrances and interaction feedback. Device motion preferences always take priority.</small></span><input type="checkbox" checked={draft.motionEnabled} onChange={event => update('motionEnabled', event.target.checked)} /></label>
        <p className="pbs-muted">Payment payee details and previously issued certificate records keep their saved values. Manage the two certificate signatories in Certificates. The approved certificate artwork stays fixed.</p>
        <div className="pbs-actions"><button className="pbs-button pbs-button-primary" disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save branding'}</button><Button quiet disabled={busy} onClick={() => setDraft(defaultBrandSettings)}>Reset form to PBS defaults</Button></div>
      </form>
    </Panel><aside className="pbs-branding-preview"><div className="pbs-brand-preview-scene" style={{ backgroundImage: `linear-gradient(110deg, rgba(5,23,41,.94), rgba(8,35,60,.55)), url("${brand.heroUrl}")` }}>
      <div className="pbs-brand-preview-name"><img src={brand.logoUrl} width="44" height="44" alt="" /><span>{draft.academyName}<small>{draft.tagline}</small></span></div>
      <p>{draft.heroEyebrow}</p><h2 className="pbs-pre-wrap">{draft.heroTitle}</h2><span>{draft.heroDescription}</span>
      <div className="pbs-brand-preview-glass"><strong>Your next chapter in BIM</strong><span>Preview of your colour palette</span><div style={{ background: draft.primaryColor, color: '#fff' }}>Continue learning</div><i style={{ background: draft.accentColor }} /></div>
    </div><p className="pbs-muted"><ImagePlus size={15} />Preview only. Save details or publish an image to update the website.</p></aside></div>
    <InstitutionStampAdmin/>
  </div>;
}
