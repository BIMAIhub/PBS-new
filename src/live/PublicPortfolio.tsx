import type { CSSProperties } from 'react';
import { Award, BriefcaseBusiness, Download, ExternalLink, GraduationCap, Layers, Linkedin, MapPin } from 'lucide-react';
import { PortalBrand } from '../components/student-dashboard/PortalUI';
import type { Portfolio } from './types';
import type { PortfolioSections } from './experience-types';
import { dateLabel, FormError, useApiResource } from './ui';

export interface PublicPortfolioData {
  name: string; portfolio: Portfolio; sections: PortfolioSections;
  profile: { headline: string; location: string; about: string; skills: string[]; cvAvailable: boolean };
  certificates: { id: string; courseTitle: string; issuedAt: string; publicToken: string; issuer: string }[];
}
export function PortfolioShowcase({ data, id, preview = false }: { data: PublicPortfolioData; id: string; preview?: boolean }) {
  const { portfolio, profile, sections } = data;
  return <div className={`pbs-showcase pbs-showcase-${sections.layout}`} style={{ '--portfolio-accent': sections.accentColor } as CSSProperties}>
    <header className="pbs-showcase-header"><a href="/explore"><PortalBrand subtitle="BIM professional portfolios" /></a><span>{preview ? 'Portfolio preview' : 'Professional portfolio'}</span></header>
    <main className="pbs-showcase-content"><section className="pbs-showcase-hero"><div className="pbs-showcase-monogram" aria-hidden="true">{data.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</div><div><p>{portfolio.headline || profile.headline || 'BIM practice'}</p><h1>{data.name}</h1>{profile.location && <span className="pbs-showcase-location"><MapPin size={17} />{profile.location}</span>}<div className="pbs-showcase-actions">{profile.cvAvailable && <a className="pbs-button pbs-button-primary" href={preview ? '/api/student/profile/cv' : `/api/portfolios/${encodeURIComponent(id)}/cv`}><Download size={16} /> Download CV</a>}{portfolio.linkedin && <a href={portfolio.linkedin} target="_blank" rel="noopener noreferrer"><Linkedin size={17} /> LinkedIn</a>}{portfolio.github && <a href={portfolio.github} target="_blank" rel="noopener noreferrer">GitHub <ExternalLink size={14} /></a>}{portfolio.website && <a href={portfolio.website} target="_blank" rel="noopener noreferrer">Website <ExternalLink size={14} /></a>}</div></div></section>
      {(portfolio.bio || profile.about || profile.skills.length > 0) && <section className="pbs-showcase-about"><div><h2>About my practice</h2><p className="pbs-pre-wrap">{portfolio.bio || profile.about}</p></div>{profile.skills.length > 0 && <div><h3>Tools & skills</h3><ul className="pbs-skill-list">{profile.skills.map(skill => <li key={skill}>{skill}</li>)}</ul></div>}</section>}
      {(sections.projects.length > 0 || portfolio.projectUrl) && <section className="pbs-showcase-section"><div className="pbs-showcase-section-heading"><h2>Selected projects</h2><span>{sections.projects.length || 1} projects</span></div><div className="pbs-showcase-projects">{(sections.projects.length ? sections.projects : [{ title: 'Featured BIM project', summary: '', tools: '', url: portfolio.projectUrl }]).map((project, index) => <article key={index}><div className="pbs-project-drawing"><Layers size={40} /><span>{project.tools || 'BIM project'}</span></div><div><h3>{project.title}</h3>{project.summary && <p className="pbs-pre-wrap">{project.summary}</p>}<a href={project.url} target="_blank" rel="noopener noreferrer">Open project <ExternalLink size={15} /></a></div></article>)}</div></section>}
      {(sections.experience.length > 0 || sections.education.length > 0) && <div className="pbs-showcase-history">{[{ title: 'Experience', icon: BriefcaseBusiness, items: sections.experience }, { title: 'Education', icon: GraduationCap, items: sections.education }].map(({ title, icon: Icon, items }) => items.length > 0 && <section className="pbs-showcase-section" key={title}><h2><Icon size={21} />{title}</h2>{items.map((entry, index) => <article className="pbs-showcase-timeline" key={index}><span>{entry.period}</span><div><h3>{entry.title}</h3><strong>{entry.organization}</strong><p className="pbs-pre-wrap">{entry.description}</p></div></article>)}</section>)}</div>}
      {data.certificates.length > 0 && <section className="pbs-showcase-section"><h2>Earned credentials</h2><div className="pbs-showcase-credentials">{data.certificates.map(item => <a href={`/verify/certificate/${encodeURIComponent(item.publicToken)}`} key={item.id} target="_blank" rel="noopener noreferrer"><Award size={28} /><div><h3>{item.courseTitle}</h3><p>{item.issuer} · {dateLabel(item.issuedAt)}</p><span>Verify credential</span></div><ExternalLink size={16} /></a>)}</div></section>}
    </main><footer className="pbs-showcase-footer"><span>Portfolio by {data.name}</span><a href="/explore">Pragmatic BIM Solution</a></footer>
  </div>;
}
export function PublicPortfolioPage({ id }: { id: string }) {
  const { data, error } = useApiResource<PublicPortfolioData>(`/portfolios/${encodeURIComponent(id)}`);
  if (error) return <main className="pbs-public-paper"><PortalBrand /><h1>Portfolio unavailable</h1><FormError error={error} /><a className="pbs-text-button" href="/explore">Explore PBS courses</a></main>;
  return data ? <PortfolioShowcase data={data} id={id} /> : <p className="pbs-route-loading" role="status">Opening portfolio…</p>;
}
