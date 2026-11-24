import { useState } from 'react';
import { CheckCircle2, ClipboardList, FileText } from 'lucide-react';
import type { LearningTask } from './experience-types';
import { send } from './api';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { AssignmentFileUpload } from './AssignmentUploads';
import { Button, dateLabel, DialogForm, Empty, ExternalLink, Field, FormError, Input, Panel, Status, useApiResource, value } from './ui';

export function TaskAssignments() {
  const { data, error, refresh } = useApiResource<{ tasks: LearningTask[] }>('/student/tasks');
  const [selected, setSelected] = useState<LearningTask>();
  const [upload,setUpload]=useState<LearningTask>();
  return <><Panel title="Module & course assignments"><FormError error={error} />{!data?.tasks.length && <Empty title="No assignment briefs yet">Your instructor's published assignments appear here for your enrolled courses.</Empty>}
    {data?.tasks.map(task => <article className="pbs-student-task" key={task.id}><div className="pbs-section-top"><div><p className="pbs-muted">{task.courseTitle} · {task.moduleId ? 'Module assignment' : 'Course capstone'}</p><h3>{task.title}</h3></div><Status value={task.submission?.reviewedAt ? 'Reviewed' : task.submission ? 'Submitted' : 'Ready to begin'} /></div><p className="pbs-pre-wrap">{task.brief}</p>{task.deliverables.length > 0 && <div className="pbs-task-deliverables"><strong>What to submit</strong><ul>{task.deliverables.map(item => <li key={item}><CheckCircle2 size={15} />{item}</li>)}</ul></div>}
      {task.submission && <div className="pbs-inset"><p className="pbs-muted">Submitted {dateLabel(task.submission.submittedAt)}</p><ExternalLink href={task.submission.url}>Open your submission</ExternalLink>{task.submission.feedback && <><h4>Instructor feedback</h4><p className="pbs-pre-wrap">{task.submission.feedback}</p></>}</div>}
      <div className="pbs-actions"><Button quiet disabled={task.locked} onClick={() => setSelected(task)}><FileText size={16} />Submit project link</Button><Button disabled={task.locked} onClick={()=>setUpload(task)}>Upload assignment files</Button></div>{task.locked&&<p className="pbs-muted">{task.lockReason}</p>}
    </article>)}
  </Panel>{upload&&<PortalDialog title={`Upload: ${upload.title}`} onClose={()=>setUpload(undefined)}><AssignmentFileUpload taskId={upload.id} onSaved={async()=>{await refresh();setUpload(undefined);}}/></PortalDialog>}{selected && <DialogForm title="Submit assignment" detail={selected.title} submit="Send to instructor" onClose={() => setSelected(undefined)} onSubmit={async form => { await send(`/student/tasks/${selected.id}/submit`, { url: value(form, 'url'), note: value(form, 'note') }); await refresh(); setSelected(undefined); }}><Input label="Project or file link" name="url" type="url" defaultValue={selected.submission?.url} required note="Use an HTTPS link your instructor has permission to open." /><Field label="Submission note"><textarea name="note" rows={4} maxLength={2000} defaultValue={selected.submission?.note} /></Field></DialogForm>}</>;
}
