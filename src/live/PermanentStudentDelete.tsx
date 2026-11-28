import type {StudentRecord} from './types';
import {send} from './api';
import {DialogForm,FormError,Input,PasswordInput,money,useApiResource,value} from './ui';
type Preview={name:string;email:string;enrollments:number;receipts:number;paid:number;certificates:number;assignments:number;liveAttendance:number;mailRecords:number;messages:number;assignmentFiles:number;originalCertificates:number;devices:number;blocked:string;reviewToken:string};
export function PermanentStudentDelete({student,onClose,onSaved}:{student:StudentRecord;onClose:()=>void;onSaved:(message:string)=>Promise<void>}){
  const resource=useApiResource<Preview>(`/admin/students/${student.id}/deletion-preview`),p=resource.data;
  return <DialogForm title="Delete student & linked records permanently" detail={student.email} submit="Delete student permanently" submitDisabled={!p||Boolean(p.blocked)} wide onClose={onClose} onSubmit={async form=>{
    const result=await send<{privateFileCleanupPending:number}>(`/admin/students/${student.id}/permanent`,{reviewToken:p!.reviewToken,confirmEmail:value(form,'email'),confirmation:value(form,'confirmation'),current:value(form,'current')},'DELETE');
    await onSaved(`Student and linked payment, enrollment, learning and credential records permanently removed.${result.privateFileCleanupPending?' Private-file cleanup is queued; retry it from Data reset if the storage connection needs attention.':''}`);
  }}><FormError error={resource.error}/>{p&&<><p className="pbs-muted">This permanently removes the student login, payment receipts, enrollments, progress, assignments, attendance, messages, feedback, referral details and certificates. It cannot be restored. Shared courses and other students’ payment balances are preserved.</p>
    <div className="pbs-education-stats"><div><strong>{p.enrollments}</strong><span>Enrollments</span></div><div><strong>{p.receipts}</strong><span>Payment receipts · {money(p.paid)}</span></div><div><strong>{p.certificates}</strong><span>Certificates</span></div><div><strong>{p.assignments}</strong><span>Assignments</span></div><div><strong>{p.liveAttendance}</strong><span>Attendance records</span></div><div><strong>{p.mailRecords+p.messages}</strong><span>Mail & messages</span></div><div><strong>{p.assignmentFiles+p.originalCertificates}</strong><span>Private stored files</span></div><div><strong>{p.devices}</strong><span>Connected devices</span></div></div>
    <p className="pbs-muted pbs-small">Known private files and individual OneDrive permissions are queued for removal. Emails already sent and actual bank transfers stay with their providers. Archive the account instead if you need a recoverable record.</p>
    {p.blocked&&<p className="pbs-form-status">{p.blocked}</p>}
    <Input label="Type the student email to confirm" name="email" type="email" autoComplete="off" required/><Input label="Type DELETE STUDENT to confirm" name="confirmation" autoComplete="off" required/><PasswordInput label="Confirm with your admin password" name="current" autoComplete="current-password" required/>
  </>}</DialogForm>;
}
