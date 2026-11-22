import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AccessPackage, AccessDelivery, EnrollmentDecision } from './admissions-types';
export { StudentAccessDialog as TemporaryAccess } from './AccessSharing';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { api, send } from './api';
import type { Account, AssessmentQuestion, Course, Enrollment, Lesson, Receipt, StudentRecord } from './types';
import { Button, DialogForm, Empty, Field, Input, money, paise, useApiResource, value } from './ui';

type Save = () => Promise<void>;
type FormProps = { onClose: () => void; onSaved: Save };

export function CourseForm({ course, onClose, onSaved }: FormProps & { course?: Course }) {
  return <DialogForm title={course ? 'Edit course' : 'Create a course'} submit="Save course" onClose={onClose} wide
    onSubmit={async form => {
      await send(course ? `/admin/courses/${course.id}` : '/admin/courses', {
        title: value(form, 'title'), category: value(form, 'category'), instructor: value(form, 'instructor'),
        schedule: value(form, 'schedule'), description: value(form, 'description'), fee: paise(form, 'fee'),
        published: form.has('published'),
      }, course ? 'PATCH' : 'POST');
      await onSaved();
    }}>
    <Input label="Course title" name="title" defaultValue={course?.title} maxLength={160} required />
    <div className="pbs-form-grid">
      <Input label="Category" name="category" defaultValue={course?.category} maxLength={80} placeholder="Revit, Navisworks or BIM management" required />
      <Input label="Course fee (₹)" name="fee" type="number" step=".01" min="0" defaultValue={(course?.fee ?? 0) / 100} required />
      <Input label="Instructor" name="instructor" defaultValue={course?.instructor} maxLength={120} />
      <Input label="Schedule" name="schedule" defaultValue={course?.schedule} maxLength={160} />
    </div>
    <Field label="Description"><textarea name="description" rows={4} maxLength={3000} defaultValue={course?.description} /></Field>
    <label className="pbs-check"><input type="checkbox" name="published" defaultChecked={course?.published} /> Show in the enrollment catalog</label>
  </DialogForm>;
}

export function ModuleForm({ course, onClose, onSaved }: FormProps & { course: Course }) {
  return <DialogForm title="Add a module" detail={course.title} submit="Add module" onClose={onClose}
    onSubmit={async form => { await send(`/admin/courses/${course.id}/modules`, { title: value(form, 'title') }); await onSaved(); }}>
    <Input label="Module title" name="title" maxLength={160} required />
  </DialogForm>;
}

export function VideoForm({ course, moduleId, lesson, onClose, onSaved }: FormProps & { course: Course; moduleId?: string; lesson?: Lesson }) {
  const [source, setSource] = useState<'file' | 'link' | 'keep'>(lesson ? 'keep' : 'file');
  return <DialogForm title={lesson ? 'Edit video lesson' : 'Add video lesson'} detail={course.title}
    submit={lesson ? 'Save lesson' : source === 'file' ? 'Upload lesson' : 'Add lesson'} onClose={onClose} wide
    onSubmit={async form => {
      const module = lesson ? moduleId : value(form, 'module');
      if (!module) throw new Error('Choose a course module.');
      const route = `/admin/courses/${course.id}/modules/${module}/lessons`;
      const details = { title: value(form, 'title'), duration: value(form, 'duration'), description: value(form, 'description'),
        ...(lesson ? { replaceId: lesson.id } : {}) };
      if (source === 'file') {
        const file = form.get('file');
        if (!(file instanceof File) || !file.size) throw new Error('Choose an MP4 or WebM video.');
        const type = /\.mp4$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : '';
        if (!type) throw new Error('Choose an MP4 or WebM video.');
        const upload = await send<{ storage: 'local' } | { storage: 'blob'; url: string; uploadId: string }>(
          `${route}/upload`, { contentType: type, size: file.size });
        if (upload.storage === 'blob') {
          const result = await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': type }, body: file, redirect: 'error' });
          if (!result.ok) throw new Error('The video upload failed. Try again.');
          await send(`${route}/upload/${encodeURIComponent(upload.uploadId)}`, details);
        } else {
          await api(`${route}/file?${new URLSearchParams(details)}`, {
            method: 'POST', headers: { 'Content-Type': type }, body: file,
          });
        }
      } else {
        await send(route, { ...details, url: source === 'link' ? value(form, 'url') : '' });
      }
      await onSaved();
    }}>
    {!lesson && <Field label="Module"><select name="module" defaultValue={moduleId || course.modules[0]?.id} required>
      {course.modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
    </select></Field>}
    <div className="pbs-form-grid">
      <Input label="Lesson title" name="title" defaultValue={lesson?.title} maxLength={160} required />
      <Input label="Duration" name="duration" defaultValue={lesson?.duration} placeholder="e.g. 24 min" maxLength={40} />
    </div>
    <div className={`pbs-role-control pbs-form-switch ${lesson ? 'pbs-three-choices' : ''}`} role="group" aria-label="Video source">
      {lesson && <button type="button" aria-pressed={source === 'keep'} onClick={() => setSource('keep')}>Keep current video</button>}
      <button type="button" aria-pressed={source === 'file'} onClick={() => setSource('file')}>Upload file</button>
      <button type="button" aria-pressed={source === 'link'} onClick={() => setSource('link')}>Paste link</button>
    </div>
    {source === 'file'
      ? <Input label="Video file" name="file" type="file" accept="video/mp4,video/webm,.mp4,.webm" required note="MP4 or WebM. Uploaded videos are available to enrolled students." />
      : source === 'link' ? <Input label="Video URL" name="url" type="url" defaultValue={lesson?.playback.source}
          required note="Paste an individual video file link, not a folder. OneDrive videos use the saved Microsoft connection and play inside PBS with resume. MP4/WebM uploads also support resume." /> : null}
    <Field label="Lesson notes"><textarea name="description" rows={3} maxLength={3000} defaultValue={lesson?.description} /></Field>
  </DialogForm>;
}

export function CourseLinkForm({ course, kind, onClose, onSaved }: FormProps & { course: Course; kind: 'resource' | 'session' }) {
  const session = kind === 'session';
  return <DialogForm title={session ? 'Schedule a live session' : 'Add a course resource'} detail={course.title} submit="Save" onClose={onClose}
    onSubmit={async form => {
      await send(`/admin/courses/${course.id}/links`, {
        kind, title: value(form, 'title'), url: value(form, 'url'),
        startsAt: session ? new Date(value(form, 'start')).toISOString() : undefined,
      });
      await onSaved();
    }}>
    <Input label={session ? 'Session title' : 'Resource title'} name="title" maxLength={160} required />
    {session && <Input label="Starts at" name="start" type="datetime-local" required note="Enter the time in your current time zone." />}
    <Input label={session ? 'Meeting link' : 'Resource link'} name="url" type="url" required />
  </DialogForm>;
}

export function AssessmentForm({ course, onClose, onSaved }: FormProps & { course: Course }) {
  const saved = useApiResource<{ questions: AssessmentQuestion[]; passingScore: number }>(`/admin/courses/${course.id}/assessment`);
  if (course.assessmentAvailable && !saved.data) {
    return <PortalDialog title="Course assessment" onClose={onClose}><p className="pbs-muted">{saved.error || 'Loading assessment…'}</p></PortalDialog>;
  }
  return <AssessmentEditor course={course} initial={saved.data} onClose={onClose} onSaved={onSaved} />;
}

function AssessmentEditor({ course, initial, onClose, onSaved }: FormProps & {
  course: Course; initial?: { questions: AssessmentQuestion[]; passingScore: number };
}) {
  const blank = () => ({ prompt: '', options: ['', '', '', ''], answer: 0, key: crypto.randomUUID() });
  const [questions, setQuestions] = useState(() => initial?.questions.map(question => ({ ...question, key: crypto.randomUUID() })) || [blank()]);
  const set = (index: number, update: Partial<AssessmentQuestion>) =>
    setQuestions(current => current.map((question, position) => position === index ? { ...question, ...update } : question));
  return <DialogForm title="Course assessment" detail={course.title} submit="Publish assessment" onClose={onClose} wide
    onSubmit={async form => {
      await send(`/admin/courses/${course.id}/assessment`, {
        passingScore: Number(value(form, 'passingScore')),
        questions: questions.map(({ key: _key, ...question }) => question),
      }, 'PUT');
      await onSaved();
    }}>
    <Input label="Passing score (%)" name="passingScore" type="number" min="1" max="100" defaultValue={initial?.passingScore || 70} required />
    {questions.map((question, index) => <fieldset className="pbs-inset pbs-live-form" key={question.key}>
      <legend>Question {index + 1}</legend>
      <Input label="Prompt" value={question.prompt} onChange={event => set(index, { prompt: event.target.value })} required maxLength={600} />
      <div className="pbs-form-grid">{question.options.map((option, position) => <Input label={`Option ${position + 1}`} key={position}
        value={option} onChange={event => set(index, { options: question.options.map((text, i) => i === position ? event.target.value : text) })}
        maxLength={300} required />)}</div>
      <Field label="Correct option"><select value={question.answer} onChange={event => set(index, { answer: Number(event.target.value) })}>
        {question.options.map((_, i) => <option key={i} value={i}>Option {i + 1}</option>)}
      </select></Field>
      {questions.length > 1 && <Button quiet onClick={() => setQuestions(current => current.filter(item => item.key !== question.key))}><X size={16} /> Remove question</Button>}
    </fieldset>)}
    <Button quiet disabled={questions.length >= 50} onClick={() => setQuestions(current => [...current, blank()])}><Plus size={17} /> Add question</Button>
  </DialogForm>;
}

export interface CreatedStudent {
  student: Account;
  enrollment: Enrollment;
  receipt?: Receipt;
  temporaryPassword?: string;
  access?: AccessPackage;
  delivery?: AccessDelivery;
}

export function EnrollStudentForm({ courses, student, initialCourseId, onExisting, onCreateCourse, onClose, onSaved }: {
  courses: Course[]; student?: StudentRecord; initialCourseId?: string; onExisting: (enrollment: Enrollment) => void;
  onCreateCourse: () => void; onClose: () => void; onSaved: (result: CreatedStudent) => Promise<void>;
}) {
  const assignable = courses.filter(course => !course.paused && !student?.enrollments.some(enrollment => enrollment.courseId === course.id && enrollment.status !== 'rejected'));
  const [courseId, setCourseId] = useState(initialCourseId || assignable[0]?.id || courses[0]?.id || '');
  const selected = courses.find(course => course.id === courseId);
  const existing = student?.enrollments.find(item => item.courseId === courseId && item.status !== 'rejected');
  const inactive = student?.accountStatus && student.accountStatus !== 'active';
  const [amount, setAmount] = useState('');
  if (!courses.length) return <PortalDialog title="Assign a course" onClose={onClose}><Empty title="Create your first course">There are no courses in this workspace yet. Create one to start enrolling students.<Button onClick={onCreateCourse}>Create course</Button></Empty></PortalDialog>;
  return <DialogForm title={student ? 'Assign or manage a course' : 'Enroll a student'} detail={student ? student.name : 'Use the email the student will sign in with.'} submit={existing ? 'Already assigned' : 'Enroll student'} submitDisabled={Boolean(existing || selected?.paused || inactive || !selected)} wide onClose={onClose}
    onSubmit={async form => {
      const result = await send<CreatedStudent>('/admin/students', {
        name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'), rollNumber: value(form, 'roll'),
        courseId, total: paise(form, 'total'), amount: paise(form, 'amount'), reference: value(form, 'reference'), method: value(form, 'method'),
        sendEmail: form.has('sendEmail'),
      });
      await onSaved(result);
    }}>
    <div className="pbs-form-grid">
      <Input label="Full name" name="name" defaultValue={student?.name} readOnly={Boolean(student)} maxLength={120} required />
      <Input label="Student email" name="email" type="email" defaultValue={student?.email} readOnly={Boolean(student)} required />
      <Input label="Phone" name="phone" type="tel" defaultValue={student?.phone} readOnly={Boolean(student)} />
      <Input label="Roll number" name="roll" defaultValue={student?.rollNumber} readOnly={Boolean(student)} placeholder="Assigned automatically if blank" />
    </div>
    <Field label="Course"><select name="course" required value={courseId} onChange={event => setCourseId(event.target.value)}>
      {courses.map(course => { const enrollment = student?.enrollments.find(item => item.courseId === course.id && item.status !== 'rejected'); return <option key={course.id} value={course.id}>{course.title}{course.paused ? ' · Paused' : enrollment?.status === 'approved' ? ' · Already enrolled' : enrollment?.status === 'pending' ? ' · Awaiting approval' : !course.published ? ' · Draft' : ''}</option>; })}
    </select></Field>
    {inactive && <p className="pbs-form-error">This student is {student.accountStatus}. Reactivate the account from the student record before assigning a course.</p>}
    {selected?.paused && <div className="pbs-inset"><strong>Course paused</strong><p className="pbs-muted">{selected.pauseReason} Resume the course from Courses & videos to allow new enrollments.</p></div>}
    {existing ? <div className="pbs-inset pbs-live-form"><strong>{existing.status === 'pending' ? 'An application already exists' : 'This course is already assigned'}</strong><p className="pbs-muted">Agreed fee {money(existing.total)} · Verified paid {money(existing.paid)} · Balance {money(existing.total - existing.paid)}</p><p className="pbs-muted">{existing.status === 'pending' ? 'Review the current application to approve access. This keeps its offer and payment reference together.' : 'Open the student record to manage access, record a payment or issue documents.'}</p><Button onClick={() => onExisting(existing)}>{existing.status === 'pending' ? 'Review application' : 'Manage assigned course'}</Button></div> : <>
    <div className="pbs-form-grid">
      <Input key={courseId} label="Agreed fee (₹)" name="total" type="number" step=".01" min="0" defaultValue={(selected?.fee ?? 0) / 100} required />
      <Input label="Initial payment (₹)" name="amount" type="number" step=".01" min="0" value={amount} onChange={event => setAmount(event.target.value)} />
    </div>
    {Number(amount) > 0 && <PaymentDetails />}
    <label className="pbs-check"><input type="checkbox" name="sendEmail" defaultChecked /> Email the approved access details through my connected Microsoft account</label>
    </>}
  </DialogForm>;
}

function PaymentDetails({ reference, method = 'UPI' }: { reference?: string; method?: string }) {
  return <div className="pbs-form-grid">
    <Field label="Payment method"><select name="method" defaultValue={method}><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Cheque</option></select></Field>
    <Input label="Payment reference" name="reference" defaultValue={reference} maxLength={80} minLength={4} required />
  </div>;
}

export function ReviewEnrollmentForm({ enrollment, onClose, onSaved }: {
  enrollment: Enrollment; onClose: () => void; onSaved: (result: EnrollmentDecision) => Promise<void>;
}) {
  const [decision, setDecision] = useState('approved');
  return <DialogForm title="Review enrollment" detail={`${enrollment.studentName} · ${enrollment.courseTitle}`} submit="Save decision" onClose={onClose}
    onSubmit={async form => {
      const result = await send<EnrollmentDecision>(`/admin/enrollments/${enrollment.id}/decision`, {
        decision, recordPayment: form.has('record'), notes: value(form, 'notes'), sendEmail: form.has('sendEmail'),
      });
      await onSaved(result);
    }}>
    <Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}>
      <option value="approved">Approve enrollment</option><option value="rejected">Decline application</option>
    </select></Field>
    {enrollment.requestedPayment > 0 && <div className="pbs-inset pbs-live-form">
      <strong>{money(enrollment.requestedPayment)} reported</strong>
      <p className="pbs-muted">Bank reference {enrollment.reference}</p>
      {decision === 'approved' && <label className="pbs-check">
        <input type="checkbox" name="record" /> I verified this payment. Record it and issue a receipt.
      </label>}
    </div>}
    {decision === 'approved' && <label className="pbs-check"><input type="checkbox" name="sendEmail" defaultChecked /> Email the student their approved access details</label>}
    <Field label="Decision notes"><textarea name="notes" maxLength={1000} rows={3} /></Field>
  </DialogForm>;
}

export function RecordPaymentForm({ enrollment, onClose, onSaved }: {
  enrollment: Enrollment; onClose: () => void; onSaved: (receipt: Receipt) => Promise<void>;
}) {
  return <DialogForm title="Record payment" detail={`${enrollment.studentName} · ${enrollment.courseTitle}`} submit="Record and issue receipt" onClose={onClose}
    onSubmit={async form => {
      const result = await send<{ receipt: Receipt }>(`/admin/enrollments/${enrollment.id}/payment`, {
        amount: paise(form, 'amount'), reference: value(form, 'reference'), method: value(form, 'method'),
      });
      await onSaved(result.receipt);
    }}>
    <p className="pbs-inset">Outstanding balance <strong>{money(enrollment.total - enrollment.paid)}</strong></p>
    <Input label="Amount received (₹)" name="amount" type="number" min=".01" max={(enrollment.total - enrollment.paid) / 100} step=".01"
      defaultValue={enrollment.requestedPayment ? enrollment.requestedPayment / 100 : ''} required />
    <PaymentDetails reference={enrollment.reference} />
    <label className="pbs-check"><input type="checkbox" name="verified" required /> I verified that PBS received this payment.</label>
  </DialogForm>;
}
