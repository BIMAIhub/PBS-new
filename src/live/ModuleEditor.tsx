import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRightLeft, GripVertical, Pencil, Plus, Trash2, Video } from 'lucide-react';
import { MotionConfig, Reorder, useDragControls } from 'motion/react';
import { messageFrom, send } from './api';
import type { Course, Lesson, Module } from './types';
import { DialogForm, Field, FormError, useApiResource, value } from './ui';

type Actions = {
  edit: (module: Module) => void;
  remove: (module: Module) => void;
  video: (module: Module, lesson?: Lesson) => void;
  move: (module: Module, lesson: Lesson) => void;
  removeVideo: (module: Module, lesson: Lesson) => void;
};

export function ModuleEditor({ course, actions, onChanged }: { course: Course; actions: Actions; onChanged: () => Promise<void> }) {
  const serverOrder = course.modules.map(module => module.id), signature = serverOrder.join('|');
  const [order, setOrder] = useState(serverOrder), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const current = useRef(order), baseline = useRef(serverOrder), saving = useRef(false), helpId = useId();
  useEffect(() => { baseline.current = serverOrder; current.current = serverOrder; setOrder(serverOrder); }, [signature]);
  function update(next: string[]) { if (!saving.current) { current.current = next; setOrder(next); } }
  async function persist(next = current.current) {
    if (saving.current || next.join('|') === baseline.current.join('|')) return;
    saving.current = true; setBusy(true); setError(''); setNotice('Saving module order…');
    try {
      await send(`/admin/courses/${course.id}/modules/order`, { moduleIds: next, expectedIds: baseline.current }, 'PUT');
      baseline.current = [...next]; setNotice('Module order saved');
      await onChanged();
    } catch (problem) {
      setError(messageFrom(problem)); setNotice(''); current.current = baseline.current; setOrder(baseline.current);
      await onChanged();
    } finally { saving.current = false; setBusy(false); }
  }
  function step(id: string, delta: number) {
    if (saving.current) return;
    const next = [...current.current], index = next.indexOf(id), target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update(next); void persist(next);
  }
  return <section className="pbs-module-editor" aria-label={`Modules in ${course.title}`} aria-busy={busy}>
    {course.modules.length > 0 && <p className="pbs-muted pbs-small" id={helpId}>Drag a module by its handle to reorder it. Changes save automatically.</p>}
    <FormError error={error}/><p className="pbs-module-order-status" role="status" aria-live="polite">{notice}</p>
    <MotionConfig reducedMotion="user"><Reorder.Group axis="y" values={order} onReorder={update} className="pbs-module-sort-list">
      {order.map((id, index) => {
        const module = course.modules.find(item => item.id === id);
        return module && <ModuleRow key={id} module={module} index={index} busy={busy} helpId={helpId}
          actions={actions} step={delta => step(id, delta)} onDropped={() => { void persist(); }}/>;
      })}
    </Reorder.Group></MotionConfig>
    {!course.modules.length && <p className="pbs-muted">Add a module to organize your lessons.</p>}
  </section>;
}

function ModuleRow({ module, index, busy, helpId, actions, step, onDropped }: {
  module: Module; index: number; busy: boolean; helpId: string; actions: Actions; step: (delta: number) => void; onDropped: () => void;
}) {
  const controls = useDragControls();
  return <Reorder.Item value={module.id} dragListener={false} dragControls={controls} dragMomentum={false} onDragEnd={onDropped}
    layout="position" transition={{ duration: .16, ease: 'easeOut' }} className="pbs-inset pbs-module-sort-item">
    <div className="pbs-module-editor-header">
      <button type="button" className="pbs-module-drag" disabled={busy} aria-label={`Reorder module ${index + 1}: ${module.title}`} aria-describedby={helpId}
        onPointerDown={event => { if (!busy) controls.start(event); }}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); step(event.key === 'ArrowUp' ? -1 : 1); } }}><GripVertical size={20}/></button>
      <div className="pbs-module-editor-title"><small>Module {index + 1} · {module.lessons.length} {module.lessons.length === 1 ? 'video' : 'videos'}</small><strong>{module.title}</strong></div>
      <div className="pbs-module-editor-actions">
        <button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.edit(module)}><Pencil size={15}/>Edit module</button>
        <button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.remove(module)}><Trash2 size={15}/>Delete module</button>
        <button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.video(module)}><Plus size={15}/>Add video</button>
      </div>
    </div>
    <div className="pbs-module-lesson-list">{module.lessons.map(lesson => <div className="pbs-module-lesson-row" key={lesson.id}>
      <Video size={16}/><span>{lesson.title}<small>{lesson.duration}</small></span>
      <div className="pbs-module-lesson-actions"><button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.video(module, lesson)}><Pencil size={14}/>Edit video</button>
        <button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.move(module, lesson)}><ArrowRightLeft size={14}/>Move video</button>
        <button type="button" className="pbs-text-button" disabled={busy} onClick={() => actions.removeVideo(module, lesson)}><Trash2 size={14}/>Remove video</button></div>
    </div>)}{!module.lessons.length && <p className="pbs-muted pbs-small">No videos in this module</p>}</div>
  </Reorder.Item>;
}

export function DeleteModuleForm({ course, module, onClose, onSaved }: { course: Course; module: Module; onClose: () => void; onSaved: () => Promise<void> }) {
  const resource = useApiResource<{ title: string; lessons: number; lessonIds: string[]; assignments: number; uploads: number }>(`/admin/courses/${course.id}/modules/${module.id}/usage`);
  const usage = resource.data, blocked = !usage || Boolean(usage.uploads);
  return <DialogForm title="Delete module" detail={usage?.title || module.title} submit={usage?.lessons ? `Delete module & ${usage.lessons} ${usage.lessons === 1 ? 'video' : 'videos'}` : 'Delete module'} submitDisabled={blocked} onClose={onClose}
    onSubmit={async form => {
      if (!form.has('confirm') || !usage) throw new Error('Confirm deletion of this module and its videos.');
      await send(`/admin/courses/${course.id}/modules/${module.id}`, { confirm: true, expectedTitle: usage.title, includeVideos: true, expectedLessonIds: usage.lessonIds, keepAssignments: true }, 'DELETE'); await onSaved();
    }}>
    <FormError error={resource.error}/>
    {!usage && !resource.error && <p className="pbs-muted" role="status">Checking module contents…</p>}
    {usage && <>
      <p className="pbs-muted">{usage.lessons} videos · {usage.assignments} assignments · {usage.uploads} unfinished uploads</p>
      <p>This removes the module, its description and unlock schedule{usage.lessons ? ', together with all of its video lessons and their watch/completion records' : ''}.</p>
      <p className="pbs-muted">Original video files in OneDrive or other storage are kept.</p>
      {usage.assignments > 0 && <p>The assignments will stay available as course assignments, including their existing submissions and reviews.</p>}
      {usage.uploads > 0 && <p>Finish the unfinished uploads or wait for their sessions to expire before deleting this module.</p>}
      {!blocked && <label className="pbs-check"><input type="checkbox" name="confirm" required/>Delete this module{usage.lessons ? ' and all of its videos' : ''}</label>}
    </>}
  </DialogForm>;
}

export function RemoveVideoForm({ course, module, lesson, onClose, onSaved }: {
  course: Course; module: Module; lesson: Lesson; onClose: () => void; onSaved: () => Promise<void>;
}) {
  return <DialogForm title="Remove video" detail={lesson.title} submit="Remove video" onClose={onClose}
    onSubmit={async form => {
      if (!form.has('confirm')) throw new Error('Confirm removal of this video.');
      await send(`/admin/courses/${course.id}/lessons/${lesson.id}`, { confirm: true, expectedModuleId: module.id, expectedTitle: lesson.title, expectedMediaKey: lesson.mediaKey }, 'DELETE'); await onSaved();
    }}>
    <p>Remove this video lesson from {module.title}, including its watch and completion records?</p>
    <p className="pbs-muted">The original video file in OneDrive or other storage is kept. Other lessons and student accounts are unaffected.</p>
    <label className="pbs-check"><input type="checkbox" name="confirm" required/>Remove this video from the course</label>
  </DialogForm>;
}

export function MoveVideoForm({ course, module, lesson, onClose, onSaved }: {
  course: Course; module: Module; lesson: Lesson; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const options = course.modules.filter(item => item.id !== module.id);
  return <DialogForm title="Move video to another module" detail={lesson.title} submit="Move video" submitDisabled={!options.length} onClose={onClose}
    onSubmit={async form => { await send(`/admin/courses/${course.id}/lessons/${lesson.id}/module`, { moduleId: value(form, 'module'), expectedModuleId: module.id }, 'PATCH'); await onSaved(); }}>
    <p className="pbs-muted">Current module: {module.title}</p>
    {options.length ? <Field label="Destination module"><select name="module" required defaultValue={options[0].id}>{options.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      : <p>Add another module in this course before moving this video.</p>}
    <p className="pbs-muted">The video is appended to the destination module and follows its unlock schedule. Its video link and student watch progress are retained.</p>
  </DialogForm>;
}
