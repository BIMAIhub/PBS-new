import { useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, BookOpen, BriefcaseBusiness, CircleHelp, ClipboardList,
  CreditCard, FileText, IndianRupee, KeyRound, LogOut, MessageSquare, Plus, Search, Users, Video
} from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { WorkspaceChrome, type WorkspaceNavGroup } from '../components/student-dashboard/WorkspaceChrome';
import { HelpDialog, MessageForm, MessagesPanel, PasswordForm } from './AccountForms';
import {
  AssessmentForm, CourseForm, CourseLinkForm, EnrollStudentForm, ModuleForm, RecordPaymentForm, ReviewEnrollmentForm,
  TemporaryAccess, VideoForm, type CreatedStudent
} from './AdminForms';
import { Classroom } from './Classroom';
import { DocumentDialog, ReceiptList, type DocumentInfo } from './Documents';
import { send } from './api';
import type { Account, AdminWorkspaceData, Assignment, Course, Enrollment, Lesson, Receipt, StudentRecord } from './types';
import { Button, dateLabel, dateTimeLabel, DialogForm, Empty, ExternalLink, Field, FormError, Input, money, Panel, Status, useApiResource, value } from './ui';

type Page = 'students' | 'courses' | 'enrollments' | 'payments' | 'projects' | 'placements' | 'messages';
const groups: WorkspaceNavGroup<Page>[] = [
  { label: 'Administration', pages: [
    { id: 'students', label: 'Students', icon: Users },
    { id: 'courses', label: 'Courses & videos', icon: BookOpen },
    { id: 'enrollments', label: 'Enrollments', icon: ClipboardList },
    { id: 'payments', label: 'Payments & receipts', icon: CreditCard },
  ] },
  { label: 'Academic records', pages: [
    { id: 'projects', label: 'Projects & reviews', icon: FileText },
    { id: 'placements', label: 'Placements', icon: BriefcaseBusiness },
    { id: 'messages', label: 'Messages', icon: MessageSquare },
  ] },
];

type Dialog =
  | { kind: 'course'; course?: Course }
  | { kind: 'module' | 'assessment' | 'preview'; course: Course }
  | { kind: 'video'; course: Course; moduleId?: string; lesson?: Lesson }
  | { kind: 'link'; course: Course; type: 'session' | 'resource' }
  | { kind: 'enroll'; student?: StudentRecord }
  | { kind: 'record' | 'edit-student' | 'reset' | 'placement'; student: StudentRecord }
  | { kind: 'review' | 'payment' | 'reject-payment'; enrollment: Enrollment }
  | { kind: 'document'; document: DocumentInfo }
  | { kind: 'temp'; email: string; password: string; receipt?: Receipt }
  | { kind: 'feedback'; assignment: Assignment }
  | { kind: 'message'; student: { id: string; name: string }; subject?: string }
  | { kind: 'password' | 'help' };

function AdminStats({ data }: { data: AdminWorkspaceData }) {
  const active = data.students.filter(student => student.enrollments.some(enrollment => enrollment.status === 'approved')).length;
  const due = data.enrollments.filter(enrollment => enrollment.status === 'approved')
    .reduce((sum, enrollment) => sum + enrollment.total - enrollment.paid, 0);
  const received = data.receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  return <dl className="pbs-learning-stats pbs-admin-stats">
    <div><dt><Users /> Active students</dt><dd>{active}</dd></div>
    <div><dt><IndianRupee /> Payments received</dt><dd>{money(received)}</dd></div>
    <div><dt><CreditCard /> Outstanding balance</dt><dd>{money(due)}</dd></div>
  </dl>;
}

function Roster({ data, open, onCreateCourse }: { data: AdminWorkspaceData; open: (dialog: Dialog) => void; onCreateCourse: () => void }) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const students = data.students.filter(student => [student.name, student.email, student.id, student.rollNumber]
    .some(field => field.toLowerCase().includes(search)));
  return <div className="pbs-live-stack">
    <AdminStats data={data} />
    <Panel title="Student roster" action={data.courses.length
      ? <Button onClick={() => open({ kind: 'enroll' })}><Plus size={18} /> Enroll student</Button>
      : <Button onClick={onCreateCourse}><Plus size={18} /> Create course</Button>}>
      <label className="pbs-live-search pbs-roster-search"><Search size={18} /><input type="search" aria-label="Find a student"
        placeholder="Find by name, email or student ID" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {students.length ? <div className="pbs-table-scroll">
        <table className="pbs-table">
          <thead><tr><th>Student</th><th>Student ID</th><th>Courses</th><th>Balance</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{students.map(student => {
            const active = student.enrollments.filter(enrollment => enrollment.status === 'approved');
            const balance = active.reduce((sum, enrollment) => sum + enrollment.total - enrollment.paid, 0);
            return <tr key={student.id}>
              <td><strong>{student.name}</strong><small>{student.email}</small></td>
              <td>{student.id}</td><td>{active.length}</td><td>{money(balance)}</td>
              <td><button className="pbs-text-button" type="button" onClick={() => open({ kind: 'record', student })}>Open record <ArrowRight /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <Empty title={query ? 'No matching students' : 'No students yet'}>
        {query ? 'Try a different name or email.' : 'Students appear after they apply or you enroll them directly.'}
      </Empty>}
    </Panel>
  </div>;
}

function CourseManager({ courses, open }: { courses: Course[]; open: (dialog: Dialog) => void }) {
  return <Panel title="Course library" action={<Button onClick={() => open({ kind: 'course' })}><Plus size={18} /> Create course</Button>}>
    {!courses.length && <Empty title="Create your first course">Add a course, create a module and upload a lesson.</Empty>}
    {courses.map(course => <article className="pbs-course-admin" key={course.id}>
      <div className="pbs-section-top">
        <div><p className="pbs-muted">{course.category}</p><h3>{course.title}</h3><p className="pbs-muted">{money(course.fee)} · {course.modules.length} modules</p></div>
        <Status value={course.published ? 'Published' : 'Draft'} />
      </div>
      <div className="pbs-actions">
        <Button quiet onClick={() => open({ kind: 'course', course })}>Edit course</Button>
        <Button quiet onClick={() => open({ kind: 'module', course })}>Add module</Button>
        <Button disabled={!course.modules.length} onClick={() => open({ kind: 'video', course })}><Video size={18} /> Add video</Button>
      </div>
      <details className="pbs-course-details">
        <summary>Curriculum and materials</summary>
        <div className="pbs-course-modules">
          {course.modules.length === 0 && <p className="pbs-muted">Add a module to organize your lessons.</p>}
          {course.modules.map(module => <div className="pbs-inset" key={module.id}>
            <div className="pbs-section-top"><strong>{module.title}</strong><button className="pbs-text-button" type="button"
              onClick={() => open({ kind: 'video', course, moduleId: module.id })}>Add video <Plus /></button></div>
            {module.lessons.map(lesson => <div className="pbs-content-line" key={lesson.id}><Video size={16} />
              <span>{lesson.title}</span><small>{lesson.duration}</small>
              <button className="pbs-text-button" type="button" onClick={() => open({ kind: 'video', course, moduleId: module.id, lesson })}>Edit lesson</button>
            </div>)}
            {!module.lessons.length && <p className="pbs-muted">No lessons in this module.</p>}
          </div>)}
          <div className="pbs-actions">
            <Button quiet onClick={() => open({ kind: 'link', course, type: 'resource' })}>Add resource</Button>
            <Button quiet onClick={() => open({ kind: 'link', course, type: 'session' })}>Schedule session</Button>
            <Button quiet onClick={() => open({ kind: 'assessment', course })}>{course.assessmentAvailable ? 'Edit assessment' : 'Add assessment'}</Button>
            <Button quiet disabled={!course.modules.some(module => module.lessons.length)} onClick={() => open({ kind: 'preview', course })}>Preview classroom</Button>
          </div>
          {(course.resources.length > 0 || course.sessions.length > 0) && <div className="pbs-inset">
            {course.resources.map(resource => <p key={resource.id}><ExternalLink href={resource.url}>{resource.title}</ExternalLink></p>)}
            {course.sessions.map(session => <p key={session.id}><ExternalLink href={session.url}>{session.title} · {dateTimeLabel(session.startsAt)}</ExternalLink></p>)}
          </div>}
        </div>
      </details>
    </article>)}
  </Panel>;
}

function EnrollmentList({ enrollments, open, payment = false }: { enrollments: Enrollment[]; open: (dialog: Dialog) => void; payment?: boolean }) {
  return <Panel title={payment ? 'Balances and payment review' : 'Enrollment applications'}>
    {!enrollments.length && <Empty title={payment ? 'No balances to review' : 'No applications yet'}>
      {payment ? 'Approved enrollments appear here with their balances.' : 'Applications appear here when students apply.'}
    </Empty>}
    {enrollments.map(enrollment => <article className="pbs-record-row" key={enrollment.id}>
      <div><h3>{enrollment.studentName}</h3><p>{enrollment.courseTitle}</p>
        <p className="pbs-muted">{enrollment.email} · {dateLabel(enrollment.submittedAt)}</p>
        {enrollment.requestedPayment > 0 && <p className="pbs-muted">{money(enrollment.requestedPayment)} reported · {enrollment.reference}</p>}
        {payment && <p className="pbs-muted">{money(enrollment.total - enrollment.paid)} due · {money(enrollment.paid)} received</p>}
      </div>
      <div className="pbs-actions">
        {!payment && <Status value={enrollment.status} />}
        {enrollment.status === 'pending' && <Button onClick={() => open({ kind: 'review', enrollment })}>Review</Button>}
        {payment && enrollment.total > enrollment.paid && <Button onClick={() => open({ kind: 'payment', enrollment })}>Record payment</Button>}
        {payment && enrollment.requestedPayment > 0 && <Button quiet onClick={() => open({ kind: 'reject-payment', enrollment })}>Decline reference</Button>}
      </div>
    </article>)}
  </Panel>;
}


function StudentRecordPanel({ student, open, onClose }: { student: StudentRecord; open: (dialog: Dialog) => void; onClose: () => void }) {
  return <PortalDialog title={student.name} className="pbs-dialog-wide" onClose={onClose}>
    <div className="pbs-live-stack">
      <dl className="pbs-facts">
        <div><dt>Email</dt><dd>{student.email}</dd></div>
        <div><dt>Student ID</dt><dd>{student.id}</dd></div>
        <div><dt>Roll number</dt><dd>{student.rollNumber}</dd></div>
        <div><dt>Lessons completed</dt><dd>{student.completedLessons}</dd></div>
      </dl>
      <div className="pbs-actions">
        <Button onClick={() => open({ kind: 'enroll', student })}>Assign course</Button>
        <Button quiet onClick={() => open({ kind: 'edit-student', student })}>Edit record</Button>
        <Button quiet onClick={() => open({ kind: 'reset', student })}>Reset password</Button>
        <Button quiet onClick={() => open({ kind: 'message', student })}>Message</Button>
        <Button quiet onClick={() => open({ kind: 'document', document: { kind: 'id', account: student, enrollments: student.enrollments } })}>Student ID</Button>
      </div>
      <div>
        <h3 className="pbs-subheading">Enrollments</h3>
        {!student.enrollments.length && <p className="pbs-muted">No courses assigned.</p>}
        {student.enrollments.map(enrollment => <div className="pbs-record-row" key={enrollment.id}>
          <div><strong>{enrollment.courseTitle}</strong><p className="pbs-muted">{money(enrollment.paid)} received</p></div>
          <div className="pbs-actions"><Status value={enrollment.status} />
            {enrollment.status === 'approved' && <Button quiet onClick={() => open({ kind: 'document', document: { kind: 'letter', account: student, enrollment } })}>Bonafide letter</Button>}
          </div>
        </div>)}
      </div>
      {student.receipts.length > 0 && <ReceiptList receipts={student.receipts} onOpen={receipt => open({ kind: 'document', document: { kind: 'receipt', receipt } })} />}
    </div>
  </PortalDialog>;
}

export function AdminWorkspace({ account, onAccount, onSignOut }: {
  account: Account; onAccount: (account: Account) => void; onSignOut: () => void;
}) {
  const [page, setPage] = useState<Page>('students');
  const [dialog, setDialog] = useState<Dialog>();
  const [notice, setNotice] = useState('');
  const { data, error, refresh } = useApiResource<AdminWorkspaceData>('/admin/workspace');
  const close = () => setDialog(undefined);
  const show = (next: Dialog) => { setNotice(''); setDialog(next); };
  const showReceipt = (receipt: Receipt) => show({ kind: 'document', document: { kind: 'receipt', receipt } });
  async function saved(message = 'Changes saved.') {
    await refresh();
    close();
    setNotice(message);
  }
  async function enroll(result: CreatedStudent) {
    await refresh();
    if (result.temporaryPassword) {
      show({ kind: 'temp', email: result.student.email, password: result.temporaryPassword, receipt: result.receipt });
    } else if (result.receipt) showReceipt(result.receipt);
    else { close(); setNotice('Student enrolled.'); }
  }
  function navigate(next: Page) {
    setPage(next);
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return <>
    <WorkspaceChrome groups={groups} activePage={page} onNavigate={navigate} userName={account.name} workspaceLabel="Administration"
      onHelp={() => show({ kind: 'help' })}
      searchActions={[
        { label: 'Create course', icon: Plus, run: () => show({ kind: 'course' }) },
        { label: 'Enroll student', icon: Users, run: () => data?.courses.length ? show({ kind: 'enroll' }) : navigate('courses') },
      ]}
      accountActions={[
        { label: 'Change password', icon: KeyRound, run: () => show({ kind: 'password' }) },
        { label: 'Export records', icon: ArrowDownToLine, run: () => { window.location.href = '/api/admin/export'; } },
        { label: 'PBS support', icon: CircleHelp, run: () => show({ kind: 'help' }) },
        { label: 'Sign out', icon: LogOut, run: onSignOut },
      ]}>
      {notice && <p className="pbs-form-status pbs-notice" role="status">{notice}</p>}
      <FormError error={error} />
      {!data && !error && <p className="pbs-muted" role="status">Loading records…</p>}
      {data && page === 'students' && <Roster data={data} open={show} onCreateCourse={() => show({ kind: 'course' })} />}
      {data && page === 'courses' && <CourseManager courses={data.courses} open={show} />}
      {data && page === 'enrollments' && <EnrollmentList enrollments={data.enrollments} open={show} />}
      {data && page === 'payments' && <div className="pbs-live-stack">
        <EnrollmentList enrollments={data.enrollments.filter(enrollment => enrollment.status === 'approved' && (enrollment.total > enrollment.paid || enrollment.requestedPayment))} open={show} payment />
        <ReceiptList receipts={data.receipts} onOpen={showReceipt} />
      </div>}
      {data && page === 'projects' && <Panel title="Project submissions">
        {!data.assignments.length && <Empty title="No submissions yet">Student projects appear here for review.</Empty>}
        {data.assignments.map(assignment => <article className="pbs-record-row" key={assignment.id}>
          <div><h3>{assignment.studentName}</h3><p>{assignment.courseTitle}</p>
            <p className="pbs-muted">{dateLabel(assignment.submittedAt)} · {assignment.reviewedAt ? 'Reviewed' : 'Awaiting feedback'}</p>
            <ExternalLink href={assignment.url}>Open submission</ExternalLink>
          </div>
          <Button quiet onClick={() => show({ kind: 'feedback', assignment })}>{assignment.reviewedAt ? 'Edit feedback' : 'Add feedback'}</Button>
        </article>)}
      </Panel>}
      {data && page === 'placements' && <Panel title="Placement records">
        {!data.students.length && <Empty title="No placement records">Enroll a student to start tracking placement.</Empty>}
        {data.students.map(student => <article className="pbs-record-row" key={student.id}>
          <div><h3>{student.name}</h3><p className="pbs-muted">{student.placement?.targetRole || student.email}</p></div>
          <div className="pbs-actions"><Status value={student.placement?.status || 'Unassigned'} />
            <Button quiet onClick={() => show({ kind: 'placement', student })}>Update placement</Button></div>
        </article>)}
      </Panel>}
      {data && page === 'messages' && <MessagesPanel messages={data.messages} admin
        onReply={message => show({ kind: 'message', student: { id: message.studentId, name: message.studentName }, subject: `Re: ${message.subject}`.slice(0, 140) })} />}
    </WorkspaceChrome>

    {dialog?.kind === 'course' && <CourseForm course={dialog.course} onClose={close} onSaved={() => { navigate('courses'); return saved('Course saved.'); }} />}
    {dialog?.kind === 'module' && <ModuleForm course={dialog.course} onClose={close} onSaved={() => saved('Module added.')} />}
    {dialog?.kind === 'video' && <VideoForm course={dialog.course} moduleId={dialog.moduleId} lesson={dialog.lesson} onClose={close} onSaved={() => saved(dialog.lesson ? 'Video lesson updated.' : 'Video lesson added.')} />}
    {dialog?.kind === 'link' && <CourseLinkForm course={dialog.course} kind={dialog.type} onClose={close} onSaved={() => saved('Course materials saved.')} />}
    {dialog?.kind === 'assessment' && <AssessmentForm course={dialog.course} onClose={close} onSaved={() => saved('Assessment published.')} />}
    {dialog?.kind === 'preview' && <Classroom course={dialog.course} completed={new Set()} onClose={close} />}
    {dialog?.kind === 'enroll' && data && <EnrollStudentForm courses={data.courses} student={dialog.student} onClose={close} onSaved={enroll} />}
    {dialog?.kind === 'record' && <StudentRecordPanel student={dialog.student} open={show} onClose={close} />}
    {dialog?.kind === 'review' && <ReviewEnrollmentForm enrollment={dialog.enrollment} onClose={close} onSaved={async receipt => {
      await saved('Enrollment reviewed.'); if (receipt) showReceipt(receipt);
    }} />}
    {dialog?.kind === 'payment' && <RecordPaymentForm enrollment={dialog.enrollment} onClose={close} onSaved={async receipt => {
      await refresh(); showReceipt(receipt);
    }} />}
    {dialog?.kind === 'reject-payment' && <DialogForm title="Decline payment reference" detail={dialog.enrollment.reference}
      onClose={close} submit="Decline reference" onSubmit={async form => {
        await send(`/admin/enrollments/${dialog.enrollment.id}/reject-payment`, { notes: value(form, 'notes') });
        await saved('Payment reference declined.');
      }}>
      <Field label="Reason"><textarea name="notes" maxLength={1000} rows={3} required /></Field>
    </DialogForm>}
    {dialog?.kind === 'reset' && <DialogForm title="Reset student password" detail={dialog.student.email} onClose={close}
      submit="Generate temporary password" onSubmit={async () => {
        const result = await send<{ temporaryPassword: string }>(`/admin/students/${dialog.student.id}/reset-password`);
        show({ kind: 'temp', email: dialog.student.email, password: result.temporaryPassword });
      }}><p className="pbs-muted">The student will be signed out and will need the new temporary password.</p></DialogForm>}
    {dialog?.kind === 'edit-student' && <DialogForm title="Edit student record" submit="Save record" onClose={close}
      onSubmit={async form => {
        await send(`/admin/students/${dialog.student.id}`, {
          name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'), rollNumber: value(form, 'roll'),
        }, 'PATCH');
        await saved('Student record saved.');
      }}>
      <Input label="Full name" name="name" defaultValue={dialog.student.name} maxLength={120} required />
      <Input label="Student email" name="email" type="email" defaultValue={dialog.student.email} required />
      <Input label="Phone" name="phone" type="tel" defaultValue={dialog.student.phone} />
      <Input label="Roll number" name="roll" defaultValue={dialog.student.rollNumber} required />
    </DialogForm>}
    {dialog?.kind === 'placement' && <DialogForm title="Placement record" detail={dialog.student.name} submit="Save placement" onClose={close}
      onSubmit={async form => {
        await send(`/admin/students/${dialog.student.id}/placement`, { status: value(form, 'status'), targetRole: value(form, 'role'), notes: value(form, 'notes') }, 'PATCH');
        await saved('Placement record saved.');
      }}>
      <Field label="Placement status"><select name="status" defaultValue={dialog.student.placement?.status || 'In training'}>
        <option>In training</option><option>Ready for interviews</option><option>Interviewing</option><option>Placed</option>
      </select></Field>
      <Input label="Target role" name="role" defaultValue={dialog.student.placement?.targetRole} />
      <Field label="Notes"><textarea name="notes" maxLength={2000} rows={4} defaultValue={dialog.student.placement?.notes} /></Field>
    </DialogForm>}
    {dialog?.kind === 'feedback' && <DialogForm title="Project feedback" detail={dialog.assignment.courseTitle} submit="Publish feedback" onClose={close}
      onSubmit={async form => {
        await send(`/admin/assignments/${dialog.assignment.id}`, { feedback: value(form, 'feedback') }, 'PATCH');
        await saved('Feedback published.');
      }}>
      <ExternalLink href={dialog.assignment.url}>Open student submission</ExternalLink>
      {dialog.assignment.note && <p className="pbs-muted pbs-pre-wrap">{dialog.assignment.note}</p>}
      <Field label="Feedback"><textarea name="feedback" maxLength={4000} rows={5} defaultValue={dialog.assignment.feedback} required /></Field>
    </DialogForm>}
    {dialog?.kind === 'message' && <MessageForm student={dialog.student} initialSubject={dialog.subject} onClose={close} onSaved={() => saved('Message sent.')} />}
    {dialog?.kind === 'temp' && <TemporaryAccess email={dialog.email} password={dialog.password} receipt={dialog.receipt} onClose={close} onReceipt={showReceipt} />}
    {dialog?.kind === 'document' && <DocumentDialog document={dialog.document} onClose={close} />}
    {dialog?.kind === 'password' && <PasswordForm account={account} onClose={close} onSaved={updated => { onAccount(updated); close(); setNotice('Password changed.'); }} />}
    {dialog?.kind === 'help' && <HelpDialog onClose={close} />}
  </>;
}
