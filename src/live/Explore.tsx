import { useState } from 'react';
import { Award, BookOpen, Layers } from 'lucide-react';
import { PortalBrand, PortalDialog } from '../components/student-dashboard/PortalUI';
import { CatalogBrowser } from './Catalog';
import { CourseInformation } from './CourseInformation';
import { EnrollmentForm } from './EnrollmentForm';
import type { Account, Catalog, CourseSummary } from './types';
import type { CourseOutline } from './experience-types';
import { Button, FormError, money, useApiResource } from './ui';
import { useBranding } from './Branding';

export function PublicExplore({ courseId }: { courseId?: string }) {
  const { brand } = useBranding();
  const { data: catalog, error } = useApiResource<Catalog>('/catalog');
  const session = useApiResource<{ account: Account | null }>('/session');
  const [applying, setApplying] = useState<CourseSummary>();
  const referral = new URLSearchParams(location.search).get('ref') || '';
  return <div className="pbs-explore-page"><header className="pbs-explore-header"><a href="/explore"><PortalBrand subtitle="Courses & professional practice" /></a><nav aria-label="PBS courses"><a href="/explore" aria-current={!courseId ? 'page' : undefined}>Explore courses</a><a href="/">{session.data?.account ? 'My workspace' : 'Sign in'}</a></nav></header>
    {!courseId && <section className="pbs-public-hero"><div className="pbs-public-hero-inner"><div className="pbs-public-hero-copy"><p className="pbs-hero-eyebrow"><span />{brand.heroEyebrow}</p><h1 className="pbs-pre-wrap">{brand.heroTitle}</h1><p>{brand.heroDescription}</p><div className="pbs-hero-actions"><a className="pbs-button pbs-gold-button" href="#course-catalog">Explore courses</a><a className="pbs-hero-link" href="/">Open your workspace</a></div><div className="pbs-hero-disciplines"><span>Structure</span><span>Services</span><span>Coordination</span></div></div>
      <aside className="pbs-hero-course-note"><span className="pbs-hero-note-label">Professional BIM education</span><h2>From your first model<br />to a coordinated project</h2><ul><li><Layers /><div>Build your practice<small>Revit and building services workflows</small></div></li><li><BookOpen /><div>Learn with a clear path<small>Course outlines, lessons and assignments</small></div></li><li><Award /><div>Show what you have learned<small>Projects, portfolios and earned credentials</small></div></li></ul><div className="pbs-hero-note-footer"><span>{catalog ? `${catalog.courses.length} ${catalog.courses.length === 1 ? 'course' : 'courses'} open to explore` : 'Explore the published curriculum'}</span><a href="#course-catalog">View courses</a></div></aside>
    </div></section>}
    <main id="course-catalog" className={`pbs-explore-main ${courseId ? 'pbs-course-detail-page' : ''}`}>{courseId ? <><a className="pbs-text-button pbs-back-to-courses" href="/explore">All courses</a><CourseInformation courseId={courseId} onApply={setApplying} /></> : <><div className="pbs-catalog-heading"><div><p className="pbs-section-context">Choose your learning path</p><h2>Explore BIM courses</h2></div><p>Review the curriculum, compare your options,<br />and apply when you are ready</p></div><FormError error={error} />{catalog ? <CatalogBrowser catalog={catalog} onChoose={course => window.location.assign(`/courses/${encodeURIComponent(course.id)}${referral ? `?ref=${encodeURIComponent(referral)}` : ''}`)} /> : !error && <p className="pbs-muted" role="status">Loading courses…</p>}</>}
    </main><footer className="pbs-explore-footer"><PortalBrand /><a href={`mailto:${brand.supportEmail}`}>Contact {brand.shortName}</a><span>Course details and offers are managed by {brand.shortName}</span></footer>
    {applying && catalog && (session.data?.account?.role === 'admin' || session.data?.account?.mustChangePassword ? <PortalDialog title="Open your PBS workspace" onClose={() => setApplying(undefined)}><p className="pbs-muted">Open your workspace to manage this account before applying as a student.</p><div className="pbs-dialog-actions"><Button quiet onClick={() => setApplying(undefined)}>Close</Button><a className="pbs-button pbs-button-primary" href="/">Open workspace</a></div></PortalDialog> : <EnrollmentForm course={applying} catalog={catalog} account={session.data?.account || undefined} initialCode={referral} onClose={() => setApplying(undefined)} onSuccess={() => window.location.assign('/')} />)}
  </div>;
}
