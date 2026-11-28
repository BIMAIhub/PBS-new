import {PermanentStudentDelete} from './PermanentStudentDelete';
import type { Course, Enrollment, StudentRecord } from './types';
import { send } from './api';
import { DialogForm, Field, Input, PasswordInput, value } from './ui';

export type AccessControlDialog =
  | { kind: 'student-status' | 'delete-student' | 'archive-student' | 'restore-student'; student: StudentRecord }
  | { kind: 'pause-course'; course: Course }
  | { kind: 'pause-enrollment'; enrollment: Enrollment };

export function AccessControlForm({ control, onClose, onSaved }: { control: AccessControlDialog; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  if(control.kind==='delete-student')return <PermanentStudentDelete student={control.student} onClose={onClose} onSaved={onSaved}/>;
  const student = 'student' in control ? control.student : undefined;
  const removing = control.kind === 'archive-student', restoring = control.kind === 'restore-student';
  const paused = control.kind === 'pause-course' ? Boolean(control.course.paused) : control.kind === 'pause-enrollment' ? Boolean(control.enrollment.accessPaused) : false;
  const title = student ? removing ? 'Archive student' : restoring ? 'Restore student' : student.accountStatus === 'inactive' ? 'Reactivate student' : 'Deactivate student'
    : control.kind === 'pause-course' ? paused ? 'Resume course' : 'Pause course' : paused ? 'Resume student course access' : 'Pause student course access';
  return <DialogForm title={title} detail={student?.email || (control.kind === 'pause-course' ? control.course.title : control.kind === 'pause-enrollment' ? `${control.enrollment.studentName} · ${control.enrollment.courseTitle}` : '')} submit={title} onClose={onClose} onSubmit={async form => {
    if (student) {
      if (removing) await send(`/admin/students/${student.id}`, { expectedStatus: student.accountStatus || 'active', confirmEmail: value(form, 'email'), current: String(form.get('current') || ''), reason: value(form, 'reason') }, 'DELETE');
      else if (restoring) await send(`/admin/students/${student.id}/restore`, {});
      else await send(`/admin/students/${student.id}/status`, { expectedStatus: student.accountStatus || 'active', status: student.accountStatus === 'inactive' ? 'active' : 'inactive', reason: value(form, 'reason') }, 'PATCH');
    } else if (control.kind === 'pause-course') await send(`/admin/courses/${control.course.id}/pause`, { paused: !paused, expectedPaused: paused, reason: value(form, 'reason') }, 'PATCH');
    else if (control.kind === 'pause-enrollment') await send(`/admin/enrollments/${control.enrollment.id}/pause`, { paused: !paused, expectedPaused: paused, reason: value(form, 'reason') }, 'PATCH');
    await onSaved(restoring ? 'Student restored as inactive. Reactivate the account when ready.' : `${title}: changes saved.`);
  }}>
    <div className="pbs-inset"><strong>{removing ? 'Move to deleted students' : restoring ? 'Restore without opening account access' : 'Manage access without losing history'}</strong><p className="pbs-muted">{removing ? 'This removes the student from your active roster, signs them out and hides their public portfolio and feedback. Receipts, payment balances and learning records remain available for audit. You can restore this record from the Deleted students filter.' : restoring ? 'The record will return to your roster as inactive. Review it, then choose Reactivate student to allow sign-in.' : student ? student.accountStatus === 'inactive' ? 'The student can sign in again after reactivation. Course pauses and pending enrollment approvals still apply.' : 'The student is signed out immediately and cannot sign in. Their public portfolio and feedback are hidden while inactive. Existing fees and receipts remain unchanged.' : control.kind === 'pause-course' ? paused ? 'Classroom access and new enrollments will reopen for this course. Individual student access pauses still apply.' : 'New applications and assignments stop. Existing students keep their progress and payment records, but classroom content, assessments and live-session joins are locked until you resume the course. The public course page stays visible with a paused notice.' : paused ? 'This student can open the course again, provided the account and course are active.' : 'Only this student loses access to this course content, assessments and live sessions. Fees, receipts and progress remain available.'}</p></div>
    {!student && !paused && <p className="pbs-muted pbs-small">Previously granted Microsoft OneDrive permissions are managed in OneDrive. Revoke those separately if you also need to block direct Microsoft links.</p>}
    {!restoring && <Field label={student ? 'Admin reason' : 'Reason shown to students'}><textarea name="reason" maxLength={500} rows={3} required={removing || (student ? student.accountStatus !== 'inactive' : !paused)} /></Field>}
    {removing && <><Input label="Type the student email to confirm" name="email" type="email" autoComplete="off" required /><PasswordInput label="Confirm with your admin password" name="current" autoComplete="current-password" required /></>}
  </DialogForm>;
}
