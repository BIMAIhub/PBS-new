import { StudentCourseFeedback } from './CourseFeedback';
import { useEffect, useState } from 'react';
import {
  ArrowRight, Award, BookOpen, Bot, CalendarDays, Clock, CreditCard, Download, FileText, IdCard,
  Compass, Gift, Megaphone, Route, Smartphone, UserRound, KeyRound, Layers, LayoutDashboard, LogOut, MessageSquare, Play, Plus, Settings, Share2
} from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { WorkspaceActionRow, WorkspaceChrome, type WorkspaceNavGroup } from '../components/student-dashboard/WorkspaceChrome';
import { BimAssistant, HelpDialog, MessageForm, MessagesPanel, PasswordForm, PortfolioForm, ProfileForm } from './AccountForms';
import { Classroom } from './Classroom';
import { DocumentDialog, ReceiptList, type DocumentInfo } from './Documents';
import { CatalogDialog, EnrollmentForm, StudentPaymentForm } from './EnrollmentForm';
import { StudyTimer } from './StudyTools';
import { send } from './api';
import { StudentCertificates } from './Certificates';
import { StudentReferrals } from './Referrals';
import { LearningRoadmap,StudentNotices } from './AcademyExperience';
import { PortfolioHub } from './PortfolioHub';
import { PortfolioBuilder } from './PortfolioBuilder';
import { ProfilePage } from './ProfilePage';
import { NotificationCenter } from './Notifications';
import { initialWorkspacePage, MobileAppPage } from './MobileApp';
import { CatalogBrowser } from './Catalog';
import { ResourceLibrary } from './LearningResources';
import { StudentPastTraining } from './AdmissionsTools';
import { StudentQuizzes } from './LearningQuizzes';
import { AlumniWelcome } from './CertificateTools';
import { CertificateDialog } from './Certificates';
import { TaskAssignments } from './TaskAssignments';
import { CourseInformation } from './CourseInformation';
import { LiveClassesStudent, NextLiveSession } from './LiveClassesStudent';
import type { AcademyData } from './academy-types';
import type { Account, AssessmentQuestion, AssessmentResult, Catalog, Course, CourseSummary, Enrollment, StudentWorkspaceData } from './types';
import { Button, dateLabel, dateTimeLabel, DialogForm, Empty, ExternalLink, Field, FormError, Input, money, Panel, Status, useApiResource, value } from './ui';

type Page = 'overview' | 'courses' | 'sessions' | 'project' | 'downloads' | 'fees' | 'reviews' | 'messages' | 'certificates' | 'portfolio' | 'profile' | 'explore' | 'course-feedback' | 'referrals' | 'roadmap' | 'notices' | 'mobile-app';
const groups: WorkspaceNavGroup<Page>[] = [
  { label: 'Learning', pages: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'courses', label: 'My courses', icon: BookOpen },
    { id: 'roadmap', label: 'My learning roadmap', icon: Route },
    { id: 'explore', label: 'Explore courses', icon: Compass },
    { id: 'sessions', label: 'Live sessions', icon: CalendarDays },
    { id: 'notices', label: 'News & notices', icon: Megaphone },
    { id: 'project', label: 'Assignments & tests', icon: Layers },
  ] },
  { label: 'Resources', pages: [
    { id: 'mobile-app', label: 'PBS app & alerts', icon: Smartphone },
    { id: 'downloads', label: 'Downloads', icon: Download },
    { id: 'fees', label: 'Fees & payments', icon: CreditCard },
    { id: 'referrals', label: 'Refer & earn', icon: Gift },
    { id: 'certificates', label: 'My certificates', icon: Award },
    { id: 'portfolio', label: 'My portfolio', icon: Share2 },
    { id: 'profile', label: 'My profile & CV', icon: UserRound },
    { id: 'reviews', label: 'Project reviews', icon: FileText },
    { id: 'course-feedback', label: 'Course feedback', icon: MessageSquare },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
  ] },
];

type Dialog =
  | { kind: 'catalog' | 'help' | 'password' | 'profile' | 'portfolio' | 'message' | 'assignment' | 'timer' | 'assistant' }
  | { kind: 'apply'; course: CourseSummary }
  | { kind: 'course-info'; course: CourseSummary }
  | { kind: 'classroom' | 'assessment'; courseId: string }
  | { kind: 'payment'; enrollment: Enrollment }
  | { kind: 'document'; document: DocumentInfo };

function activeEnrollment(enrollments: Enrollment[]) {
  return enrollments.find(enrollment => enrollment.status === 'approved');
}

function StudentOverview({ data, completed, open, navigate }: {
  data: StudentWorkspaceData; completed: Set<string>; open: (dialog: Dialog) => void; navigate: (page: Page) => void;
}) {
  const course = data.courses[0];
  const lessons = course?.modules.flatMap(module => module.lessons) ?? [];
  const done = lessons.filter(lesson => completed.has(lesson.id)).length;
  const percent = lessons.length ? Math.round(done / lessons.length * 100) : 0;
  return <div className="pbs-overview">
    <div className="pbs-overview-main">
      <section className="pbs-course-feature">
        <div className="pbs-course-feature-content">
          <p className="pbs-section-label"><BookOpen /> {course ? 'Active course' : 'BIM learning'}</p>
          <h2>{course?.title || 'Find your next BIM course'}</h2>
          {course && lessons.length > 0 && <div className="pbs-course-progress">
            <div><span>{done} of {lessons.length} lessons</span><strong>{percent}%</strong></div>
            <progress max={100} value={percent} aria-label="Course progress">{percent}%</progress>
          </div>}
          <button type="button" className="pbs-button pbs-button-light"
            onClick={() => course ? open({ kind: 'classroom', courseId: course.id }) : open({ kind: 'catalog' })}>
            {course ? <><Play /> Open classroom</> : <>Explore courses <ArrowRight /></>}
          </button>
        </div>
        <div className="pbs-course-feature-image" aria-hidden="true" />
      </section>
      <Panel title="Study tools">
        <WorkspaceActionRow action={{label:'My learning roadmap',detail:'Your modules, live sessions and course credential',icon:Route,run:()=>navigate('roadmap')}}/><WorkspaceActionRow action={{ label: 'Study timer', detail: 'Start a focus session', icon: Clock, run: () => open({ kind: 'timer' }) }} />
        <WorkspaceActionRow action={{ label: 'Assignments & tests', detail: 'Submit or review your project', icon: Layers, run: () => navigate('project') }} />
        <WorkspaceActionRow action={{ label: 'BIM assistant', detail: 'Ask about a BIM workflow', icon: Bot, run: () => open({ kind: 'assistant' }) }} />
        <WorkspaceActionRow action={{ label: 'Student documents', detail: 'View and print your student ID', icon: IdCard, run: () => navigate('courses') }} />
        <WorkspaceActionRow action={{ label: 'My certificates', detail: 'Earn and share your course credentials', icon: Award, run: () => navigate('certificates') }} />
        <WorkspaceActionRow action={{ label: 'Portfolio & LinkedIn', detail: 'Show your professional work', icon: Share2, run: () => navigate('portfolio') }} />
      </Panel>
    </div>
    <dl className="pbs-learning-stats pbs-student-stats">
      <div><dt><BookOpen /> Enrolled courses</dt><dd>{data.courses.length}</dd></div>
      <div><dt><Layers /> Lessons complete</dt><dd>{completed.size}</dd></div>
      <div><dt><CreditCard /> Payments recorded</dt><dd>{money(data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0))}</dd></div>
      <div><dt><Award /> Attendance points</dt><dd>{data.live.points}</dd></div>
    </dl>
    <div className="pbs-overview-secondary">
      <Panel title="Enrollment activity" action={<button className="pbs-text-button" type="button" onClick={() => navigate('courses')}>View courses <ArrowRight /></button>}>
        {!data.enrollments.length && <Empty title="No applications yet">Browse the catalog to request enrollment.</Empty>}
        {data.enrollments.slice(0, 3).map(enrollment => <div className="pbs-record-row" key={enrollment.id}>
          <strong>{enrollment.courseTitle}</strong><Status value={enrollment.status} />
        </div>)}
      </Panel>
      <NextLiveSession data={data.live} onOpen={() => navigate('sessions')} />
    </div>
  </div>;
}

function StudentCourses({ data, account, open, academy }: { data: StudentWorkspaceData; account: Account; open: (dialog: Dialog) => void; academy?: AcademyData }) {
  return <div className="pbs-live-stack">
    <Panel title="My enrollments" action={<Button onClick={() => open({ kind: 'catalog' })}><Plus size={18} /> Explore courses</Button>}>
      {!data.enrollments.length && <Empty title="No courses yet">Choose a published course to apply.</Empty>}
      {data.enrollments.map(enrollment => <article className="pbs-record-row" key={enrollment.id}>
        <div><h3>{enrollment.courseTitle}</h3><p className="pbs-muted">{dateLabel(enrollment.submittedAt)}</p>
          <p className="pbs-reference">Application code <code>{enrollment.id}</code></p>
          {enrollment.notes && <p className="pbs-muted pbs-pre-wrap">{enrollment.notes}</p>}{Boolean(enrollment.accessPaused || enrollment.coursePaused) && <p className="pbs-muted">{enrollment.pauseReason || 'PBS has paused this course access. Your progress and receipts are saved.'}</p>}</div>
        <div className="pbs-actions"><Status value={enrollment.status} />
          {Boolean(enrollment.accessPaused || enrollment.coursePaused) && <Status value="Access paused" />}{enrollment.status === 'approved' && !enrollment.accessPaused && !enrollment.coursePaused && <Button onClick={() => open({ kind: 'classroom', courseId: enrollment.courseId })}>Open classroom</Button>}</div>
      </article>)}
    </Panel>
    {academy?.grants.some(item => item.status === 'granted' && item.webUrl) && <Panel title="OneDrive course access">
      <p className="pbs-muted">Sign in to Microsoft using {account.email} to open your shared course files.</p>
      {academy.grants.filter(item => item.status === 'granted' && item.webUrl).map(item => <article className="pbs-record-row" key={item.enrollmentId}><strong>{data.enrollments.find(enrollment => enrollment.id === item.enrollmentId)?.courseTitle}</strong><ExternalLink href={item.webUrl}>Open course in OneDrive</ExternalLink></article>)}
    </Panel>}
    <Panel title="Student documents">
      <WorkspaceActionRow action={{ label: 'Student ID', icon: IdCard, run: () => open({ kind: 'document', document: { kind: 'id', account, enrollments: data.enrollments } }) }} />
      {data.enrollments.filter(enrollment => enrollment.status === 'approved').map(enrollment => <WorkspaceActionRow key={enrollment.id}
        action={{ label: 'Bonafide letter', detail: enrollment.courseTitle, icon: FileText,
          run: () => open({ kind: 'document', document: { kind: 'letter', account, enrollment } }) }} />)}
    </Panel>
  </div>;
}

function StudentFees({ data, catalog, open, academy, onWallet }: { data: StudentWorkspaceData; catalog?: Catalog; open: (dialog: Dialog) => void; academy?: AcademyData; onWallet: () => void }) {
  const approved = data.enrollments.filter(enrollment => enrollment.status === 'approved');
  return <div className="pbs-live-stack">
    <dl className="pbs-learning-stats"><div><dt>Verified payments</dt><dd>{money(data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0))}</dd></div><div><dt>Remaining course fees</dt><dd>{money(approved.reduce((sum, item) => sum + item.total - item.paid, 0))}</dd></div><div><dt>References in review</dt><dd>{data.enrollments.filter(item => item.requestedPayment > 0).length}</dd></div></dl>
    <Panel title="Course fees" action={<Button quiet onClick={onWallet}><Gift size={16} />Use referral credit</Button>}>
      {!approved.length && <Empty title="No fees yet">Approved enrollments appear here with their balances.</Empty>}
      {approved.map(enrollment => <article className="pbs-record-row" key={enrollment.id}>
        <div><h3>{enrollment.courseTitle}</h3><p className="pbs-muted">{money(enrollment.paid)} paid · {money(enrollment.total)} total</p>
          {enrollment.requestedPayment > 0 && <p className="pbs-muted">{money(enrollment.requestedPayment)} awaiting verification</p>}
          {enrollment.notes && <p className="pbs-muted pbs-pre-wrap">{enrollment.notes}</p>}
          {Boolean(enrollment.discount) && <p className="pbs-muted">{enrollment.promotionTitle} · {money(enrollment.discount!)} saved</p>}
          {academy?.details.find(item => item.enrollmentId === enrollment.id)?.dueDate && <p className="pbs-muted">Due {dateLabel(academy.details.find(item => item.enrollmentId === enrollment.id)!.dueDate)}</p>}
        </div>
        <div className="pbs-actions">
          <strong>{money(enrollment.total - enrollment.paid)} due</strong>
          <Button quiet onClick={() => open({ kind: 'document', document: { kind: 'statement', enrollment, receipts: data.receipts } })}>Fee statement</Button>
          {catalog?.paymentUpiId && enrollment.total > enrollment.paid && !enrollment.requestedPayment &&
            <Button onClick={() => open({ kind: 'payment', enrollment })}><CreditCard size={17} /> Pay course fees</Button>}
          {!catalog?.paymentUpiId && enrollment.total > enrollment.paid && <Button quiet onClick={() => open({ kind: 'message' })}>Arrange payment with PBS</Button>}
        </div>
      </article>)}
    </Panel>
    <ReceiptList receipts={data.receipts} onOpen={receipt => open({ kind: 'document', document: { kind: 'receipt', receipt } })} />
  </div>;
}

function CourseAssessment({ course, onClose, onSaved, onCertificate }: { course: Course; onClose: () => void; onSaved: () => Promise<void>; onCertificate: () => void }) {
  const { data, error } = useApiResource<{ questions: Omit<AssessmentQuestion, 'answer'>[]; passingScore: number }>(`/student/courses/${course.id}/assessment`);
  const [result, setResult] = useState<AssessmentResult>();
  if (!data || result) return <PortalDialog title="Course assessment" onClose={onClose}>
    <p className="pbs-muted">{result ? `Score ${result.score}%. ${result.passed ? 'You passed the assessment.' : 'Review the course and try again.'}` : error || 'Loading assessment…'}</p>
    {result?.passed && <div className="pbs-certificate-earned"><Award size={30} /><div><h3>Your course certificate is ready</h3><p>Your lessons and assessment are complete. Claim the credential from My certificates.</p><Button onClick={onCertificate}>View certificate progress</Button></div></div>}
  </PortalDialog>;
  return <DialogForm title="Course assessment" detail={`${course.title} · Passing score ${data.passingScore}%`} submit="Submit answers" onClose={onClose} wide
    onSubmit={async form => {
      const answers = data.questions.map((_, index) => Number(value(form, `answer-${index}`)));
      const response = await send<AssessmentResult>(`/student/courses/${course.id}/assessment`, { answers });
      setResult(response);
      await onSaved();
    }}>
    {data.questions.map((question, index) => <fieldset className="pbs-inset pbs-answer-options" key={index}>
      <legend>{index + 1}. {question.prompt}</legend>
      {question.options.map((option, i) => <label className="pbs-check" key={i}>
        <input type="radio" name={`answer-${index}`} value={i} required /> {option}
      </label>)}
    </fieldset>)}
  </DialogForm>;
}

export function StudentWorkspace({ account, onAccount, onSignOut }: {
  account: Account; onAccount: (account: Account) => void; onSignOut: () => void;
}) {
  const [page, setPage] = useState<Page>(() => initialWorkspacePage(groups.flatMap(group => group.pages.map(page => page.id)), 'overview'));
  const [dialog, setDialog] = useState<Dialog>();
  const [notice, setNotice] = useState('');
  const { data, error, refresh } = useApiResource<StudentWorkspaceData>('/student/workspace');
  const catalog = useApiResource<Catalog>('/catalog');
  const academy = useApiResource<AcademyData>('/student/academy');
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [refresh]);
  async function refreshAll() { await Promise.all([refresh(), academy.refresh(), catalog.refresh()]); }
  const completed = new Set(data?.completions.map(completion => completion.lessonId));
  const course = dialog && 'courseId' in dialog ? data?.courses.find(course => course.id === dialog.courseId) : undefined;
  const close = () => setDialog(undefined);
  const show = (next: Dialog) => { setNotice(''); setDialog(next); };
  function navigate(next: Page) {
    setPage(next); setNotice(''); window.scrollTo({ top: 0, behavior: 'instant' });
    void refreshAll();
  }
  async function saved(message: string) {
    await refreshAll(); close(); setNotice(message);
  }
  const [alumniCertificate,setAlumniCertificate]=useState<import('./academy-types').CertificateRecord>();
  const enrollment = data && activeEnrollment(data.enrollments);
  return <>
    {!dialog&&!alumniCertificate&&<AlumniWelcome accountId={account.id} onCertificate={setAlumniCertificate} onReferrals={()=>navigate('referrals')}/>}
    {alumniCertificate&&<CertificateDialog record={alumniCertificate} onClose={()=>setAlumniCertificate(undefined)}/>}
    <WorkspaceChrome groups={groups} activePage={page} onNavigate={navigate} userName={account.name}
      notifications={<NotificationCenter onNavigate={target => { if (groups.some(group => group.pages.some(item => item.id === target))) navigate(target as Page); }} />}
      onHelp={() => show({ kind: 'help' })}
      searchActions={[
        { label: 'Explore courses', icon: BookOpen, run: () => show({ kind: 'catalog' }) },
        { label: 'Study timer', icon: Clock, run: () => show({ kind: 'timer' }) },
        { label: 'BIM assistant', icon: Bot, run: () => show({ kind: 'assistant' }) },
        { label: 'Student ID', icon: IdCard, run: () => show({ kind: 'document', document: { kind: 'id', account, enrollments: data?.enrollments || [] } }) },
        ...(enrollment ? [{ label: 'Bonafide letter', icon: FileText, run: () => show({ kind: 'document', document: { kind: 'letter', account, enrollment } }) }] : []),
      ]}
      accountActions={[
        { label: 'Profile & CV', icon: Settings, run: () => navigate('profile') },
        { label: 'Change password', icon: KeyRound, run: () => show({ kind: 'password' }) },
        { label: 'BIM portfolio', icon: Layers, run: () => navigate('portfolio') },
        { label: 'Sign out', icon: LogOut, run: onSignOut },
      ]}>
      <FormError error={error || academy.error} />
      {!data && !error && <p className="pbs-muted" role="status">Loading your workspace…</p>}
      {notice && <p className="pbs-form-status pbs-notice" role="status">{notice}</p>}
      {data && page === 'overview' && <div className="pbs-live-stack"><StudentOverview data={data} completed={completed} open={show} navigate={navigate} /><StudentNotices compact/><StudentPastTraining onCertificates={()=>navigate('certificates')} onProfile={()=>navigate('profile')}/></div>}
      {data && page === 'courses' && <div className="pbs-live-stack"><StudentCourses data={data} account={account} open={show} academy={academy.data} /><StudentPastTraining onCertificates={()=>navigate('certificates')} onProfile={()=>navigate('profile')}/></div>}
      {data && page === 'fees' && <StudentFees data={data} catalog={catalog.data} open={show} academy={academy.data} onWallet={() => navigate('referrals')} />}
      {data && page === 'referrals' && <StudentReferrals enrollments={data.enrollments} onChanged={refreshAll} />}
      {page === 'roadmap' && <LearningRoadmap onCourses={()=>navigate('courses')} onCertificates={()=>navigate('certificates')}/>}
      {page === 'notices' && <StudentNotices/>}
      {data && academy.data && page === 'certificates' && <StudentCertificates data={data} academy={academy.data} onSaved={refreshAll} onFeedback={() => navigate('course-feedback')} />}
      {data && page === 'portfolio' && <PortfolioBuilder account={account} portfolio={data.portfolio} certificates={academy.data?.certificates || []} onSaved={refreshAll} />}
      {page === 'profile' && <ProfilePage account={account} onAccount={onAccount} />}
      {page === 'mobile-app' && <MobileAppPage />}
      {page === 'explore' && catalog.data && <CatalogBrowser catalog={catalog.data} onChoose={course => show({ kind: 'course-info', course })} />}
      {page === 'course-feedback' && <StudentCourseFeedback account={account} />}
      {page === 'sessions' && <LiveClassesStudent />}
      {data && page === 'downloads' && <div className="pbs-live-stack"><ResourceLibrary/><Panel title="Additional course links">
        {!data.courses.some(course => course.resources.length) && <Empty title="No additional course links">Your published practice downloads appear in the section above.</Empty>}
        {data.courses.flatMap(course => course.resources.map(resource => <article className="pbs-record-row" key={resource.id}>
          <div><h3>{resource.title}</h3><p className="pbs-muted">{course.title}</p></div><ExternalLink href={resource.url}>Open resource</ExternalLink>
        </article>))}
      </Panel></div>}
      {data && page === 'project' && <div className="pbs-live-stack"><TaskAssignments /><StudentQuizzes/><Panel title="Project submissions" action={data.courses.length > 0 && <Button onClick={() => show({ kind: 'assignment' })}>Submit project</Button>}>
        {!data.assignments.length && <Empty title="No projects submitted">Submit a project link for your instructor to review.</Empty>}
        {data.assignments.map(assignment => <article className="pbs-record-row" key={assignment.id}>
          <div><h3>{assignment.courseTitle}</h3><p className="pbs-muted">{dateLabel(assignment.submittedAt)}</p><ExternalLink href={assignment.url}>Open project</ExternalLink></div>
          <Status value={assignment.reviewedAt ? 'Reviewed' : 'Awaiting feedback'} />
        </article>)}
      </Panel></div>}
      {data && page === 'reviews' && <div className="pbs-live-stack">
        <Panel title="Project feedback">
          {!data.assignments.some(item => item.reviewedAt) && <Empty title="No feedback yet">Your instructor's published feedback will appear here.</Empty>}
          {data.assignments.filter(item => item.reviewedAt).map(item => <article className="pbs-record-row" key={item.id}><div>
            <h3>{item.courseTitle}</h3><p className="pbs-muted">{dateLabel(item.reviewedAt)}</p><p className="pbs-pre-wrap">{item.feedback}</p>
          </div></article>)}
        </Panel>
        <Panel title="Course assessments">
          {!data.courses.some(course => course.assessmentAvailable) && <Empty title="No published assessments" />}
          {data.courses.filter(course => course.assessmentAvailable).map(course => {
            const result = data.assessmentResults.find(result => result.courseId === course.id);
            return <article className="pbs-record-row" key={course.id}>
              <div><h3>{course.title}</h3>{result && <p className="pbs-muted">Score {result.score}%</p>}</div>
              {result?.passed ? <Button quiet onClick={() => navigate('certificates')}><Award size={18} /> My certificates</Button>
                : <Button quiet onClick={() => show({ kind: 'assessment', courseId: course.id })}>Open assessment</Button>}
            </article>;
          })}
        </Panel>
      </div>}
      {data && page === 'messages' && <MessagesPanel messages={data.messages} onCompose={() => show({ kind: 'message' })} />}
    </WorkspaceChrome>

    {dialog?.kind === 'catalog' && (catalog.data ? <CatalogDialog catalog={catalog.data} onClose={close} onChoose={course => show({ kind: 'apply', course })} />
      : <PortalDialog title="Explore BIM courses" onClose={close}><p className="pbs-muted">{catalog.error || 'Loading courses…'}</p></PortalDialog>)}
    {dialog?.kind === 'apply' && catalog.data && <EnrollmentForm course={dialog.course} catalog={catalog.data} account={account}
      onClose={close} onSuccess={async () => { navigate('courses'); await saved('Enrollment application submitted.'); }} />}
    {dialog?.kind === 'course-info' && <PortalDialog title="Course information" className="pbs-dialog-catalog" onClose={close}><CourseInformation courseId={dialog.course.id} onApply={course => show({ kind: 'apply', course })} /></PortalDialog>}
    {dialog?.kind === 'classroom' && course && <Classroom course={course} completed={completed} onClose={close} studentId={account.id}
      onCompletion={async (lesson, done) => {
        await send(`/student/lessons/${lesson.id}/completion`, { completed: done }); await refresh();
      }}
      onAssessment={() => show({ kind: 'assessment', courseId: course.id })} />}
    {dialog?.kind === 'assessment' && course && <CourseAssessment course={course} onClose={close} onSaved={async () => { await refreshAll(); }} onCertificate={() => { close(); navigate('certificates'); }} />}
    {dialog?.kind === 'document' && <DocumentDialog document={dialog.document} onClose={close} />}
    {dialog?.kind === 'payment' && catalog.data && <StudentPaymentForm enrollment={dialog.enrollment} catalog={catalog.data}
      onClose={close} onSuccess={() => saved('Payment reference sent for review.')} />}
    {dialog?.kind === 'password' && <PasswordForm account={account} onClose={close} onSaved={updated => { onAccount(updated); close(); setNotice('Password changed.'); }} />}
    {dialog?.kind === 'profile' && <ProfileForm account={account} onClose={close} onSaved={updated => { onAccount(updated); close(); setNotice('Profile saved.'); }} />}
    {dialog?.kind === 'portfolio' && data && <PortfolioForm account={account} portfolio={data.portfolio} onClose={close} onSaved={() => saved('Portfolio saved.')} />}
    {dialog?.kind === 'message' && <MessageForm onClose={close} onSaved={() => saved('Message sent.')} />}
    {dialog?.kind === 'assignment' && data && <DialogForm title="Submit a capstone project" submit="Submit project" onClose={close}
      onSubmit={async form => {
        await send('/student/assignments', { courseId: value(form, 'course'), url: value(form, 'url'), note: value(form, 'note') });
        await saved('Project submitted for review.');
      }}>
      <Field label="Course"><select name="course" required>{data.courses.map(course => <option value={course.id} key={course.id}>{course.title}</option>)}</select></Field>
      <Input label="Project link" name="url" type="url" required />
      <Field label="Project notes"><textarea name="note" rows={4} maxLength={2000} /></Field>
    </DialogForm>}
    {dialog?.kind === 'help' && <HelpDialog onClose={close} />}
    {dialog?.kind === 'timer' && <StudyTimer onClose={close} />}
    {dialog?.kind === 'assistant' && <BimAssistant onClose={close} />}
  </>;
}
