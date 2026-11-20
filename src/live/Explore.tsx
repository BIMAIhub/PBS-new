import { useState } from 'react';
import { BookOpen, Check, CheckCircle2, Clock, Layers, ShieldCheck, Users } from 'lucide-react';
import { PortalBrand, PortalDialog } from '../components/student-dashboard/PortalUI';
import { CatalogBrowser } from './Catalog';
import { CourseInformation } from './CourseInformation';
import { EnrollmentForm } from './EnrollmentForm';
import type { Account, Catalog, CourseSummary } from './types';
import type { CourseOutline } from './experience-types';
import { Button, FormError, money, useApiResource } from './ui';

export function PublicExplore({ courseId }: { courseId?: string }) {
  const { data: catalog, error } = useApiResource<Catalog>('/catalog');
  const session = useApiResource<{ account: Account | null }>('/session');
  const [applying, setApplying] = useState<CourseSummary>();
  const referral = new URLSearchParams(location.search).get('ref') || '';
  return <div className="pbs-explore-page"><header className="pbs-explore-header"><a href="/explore"><PortalBrand subtitle="Courses & professional practice" /></a><nav aria-label="PBS courses"><a href="/explore" aria-current={!courseId ? 'page' : undefined}>Explore courses</a><a href="/">{session.data?.account ? 'My workspace' : 'Sign in'}</a></nav></header>
    <main className="pbs-explore-main">{courseId ? <><a className="pbs-text-button pbs-back-to-courses" href="/explore">All courses</a><CourseInformation courseId={courseId} onApply={setApplying} /></> : <><section className="pbs-explore-intro"><div><p className="pbs-section-context">Pragmatic BIM Solution</p><h1>Build the skills behind<br />a coordinated BIM model</h1><p>Explore the curriculum, choose your course, and take your next step in Revit and building services practice.</p></div><div className="pbs-explore-intro-note"><span>Learn</span><span>Model</span><span>Coordinate</span><p>Practical BIM education, with your progress and credentials in one workspace</p></div></section><FormError error={error} />{catalog ? <CatalogBrowser catalog={catalog} onChoose={course => window.location.assign(`/courses/${encodeURIComponent(course.id)}${referral ? `?ref=${encodeURIComponent(referral)}` : ''}`)} /> : !error && <p className="pbs-muted" role="status">Loading courses…</p>}</>}
    </main><footer className="pbs-explore-footer"><PortalBrand subtitle="Learning. Applied." /><a href="mailto:info@pragmaticbim.com">Contact PBS</a><span>Course details and offers are managed by PBS</span></footer>
    {applying && catalog && (session.data?.account?.role === 'admin' || session.data?.account?.mustChangePassword ? <PortalDialog title="Open your PBS workspace" onClose={() => setApplying(undefined)}><p className="pbs-muted">Open your workspace to manage this account before applying as a student.</p><div className="pbs-dialog-actions"><Button quiet onClick={() => setApplying(undefined)}>Close</Button><a className="pbs-button pbs-button-primary" href="/">Open workspace</a></div></PortalDialog> : <EnrollmentForm course={applying} catalog={catalog} account={session.data?.account || undefined} initialCode={referral} onClose={() => setApplying(undefined)} onSuccess={() => window.location.assign('/')} />)}
  </div>;
}
