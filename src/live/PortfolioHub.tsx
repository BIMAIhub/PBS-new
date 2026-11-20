import { useState } from 'react';
import { ArrowUpRight, BriefcaseBusiness, Check, Copy, ExternalLink, Globe, Layers, Linkedin, Pencil, Share2 } from 'lucide-react';
import type { Account, StudentWorkspaceData } from './types';
import { linkedInShareUrl } from './Certificates';
import { Button, FormError, Panel, Status } from './ui';

export function PortfolioHub({ account, data, onEdit }: { account: Account; data: StudentWorkspaceData; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const profile = data.portfolio;
  const url = `${location.origin}/portfolio/${encodeURIComponent(account.id)}`;
  const initials = account.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <div className="pbs-live-stack">
    <section className="pbs-portfolio-hero"><span className="pbs-portfolio-avatar">{initials}</span><div><p className="pbs-eyebrow">YOUR PROFESSIONAL PROFILE</p><h2>{account.name}</h2><p>{profile.headline || 'Build a portfolio that shows your BIM skills.'}</p></div><Button onClick={onEdit}><Pencil size={16} /> Edit portfolio</Button></section>
    <FormError error={error} />
    <div className="pbs-academy-grid">
      <Panel title="About your work" action={<Status value={profile.published ? 'Published' : 'Private'} />}><p className="pbs-pre-wrap pbs-portfolio-bio">{profile.bio || 'Add a short introduction, the BIM workflows you use, and the kind of projects you want to work on.'}</p>
        {profile.projectUrl && <a className="pbs-portfolio-project" href={profile.projectUrl} target="_blank" rel="noopener noreferrer"><Layers size={26} /><span><strong>Featured BIM project</strong><small>Open project files and case study</small></span><ArrowUpRight size={19} /></a>}
        <div className="pbs-portfolio-links">{profile.linkedin && <a href={profile.linkedin} target="_blank" rel="noopener noreferrer"><Linkedin size={17} /> LinkedIn <ExternalLink size={14} /></a>}{profile.github && <a href={profile.github} target="_blank" rel="noopener noreferrer"><BriefcaseBusiness size={17} /> GitHub <ExternalLink size={14} /></a>}{profile.website && <a href={profile.website} target="_blank" rel="noopener noreferrer"><Globe size={17} /> Website <ExternalLink size={14} /></a>}</div>
      </Panel>
      <Panel title="Share your progress"><p className="pbs-muted">Publish your portfolio to share a professional link with recruiters and your network.</p>
        {profile.published ? <><label className="pbs-live-field"><span>Public portfolio URL</span><input readOnly value={url} onFocus={event => event.target.select()} /></label><div className="pbs-actions"><a className="pbs-button pbs-button-primary" href={linkedInShareUrl(url)} target="_blank" rel="noopener noreferrer"><Share2 size={16} /> Share to LinkedIn</a><Button quiet onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('Select the portfolio URL above to copy it.'); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</Button><a className="pbs-text-button" href={url} target="_blank" rel="noopener noreferrer">View portfolio <ArrowUpRight size={16} /></a></div></> : <Button quiet onClick={onEdit}>Set up public portfolio <ArrowUpRight size={16} /></Button>}
        <div className="pbs-inset pbs-gold-inset"><p>Your public page includes only the profile details and links you choose to publish. Contact details and fees stay private.</p></div>
      </Panel>
    </div>
  </div>;
}
