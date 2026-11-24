import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, LockKeyhole, Maximize, Minimize, PanelRightClose, PanelRightOpen, Play, Search } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { messageFrom, send } from './api';
import type { Course, Lesson } from './types';
import { Button, dateTimeLabel, Empty, Field, FormError, Input, useApiResource, value } from './ui';
import { LessonPlayer } from './LessonPlayer';
import { usePlaybackProgress } from './usePlaybackProgress';

export function Classroom({ course, completed, onClose, onCompletion, onAssessment, studentId }: {
  course: Course;
  completed: Set<string>;
  onClose: () => void;
  onCompletion?: (lesson: Lesson, done: boolean) => Promise<void>;
  onAssessment?: () => void;
  studentId?: string;
}) {
  const all = course.modules.flatMap(module => module.lessons);
  const [activeId, setActiveId] = useState(() => all.find(lesson => !lesson.locked&&!completed.has(lesson.id))?.id || all.find(l=>!l.locked)?.id);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'content' | 'discussion'>('content');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [sent, setSent] = useState(false);
  const [focusMode, setFocusMode] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const player = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null);
  const playback = usePlaybackProgress(course.id, studentId, all), selectedByStudent = useRef(false);
  const active = all.find(lesson => lesson.id === activeId&&!lesson.locked) || all.find(l=>!l.locked);
  const lessonDone = active ? completed.has(active.id) : false;
  const finished = all.filter(lesson => completed.has(lesson.id)).length;
  const next = active && all[all.findIndex(lesson => lesson.id === active.id) + 1];
  const term = query.toLowerCase().trim();
  useEffect(() => {
    if (playback.ready && playback.lastLessonId && !selectedByStudent.current && all.some(lesson => lesson.id === playback.lastLessonId&&!lesson.locked)) setActiveId(playback.lastLessonId);
  }, [playback.ready, playback.lastLessonId]);
  function chooseLesson(id: string) {
    if(all.find(l=>l.id===id)?.locked)return;
    playback.flush(); selectedByStudent.current = true; setActiveId(id); setSent(false);
  }
  function closeClassroom() { playback.flush(); onClose(); }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.current?.requestFullscreen) await player.current.requestFullscreen();
      else setError('Use the video player’s fullscreen control on this browser.');
    } catch { setError('Fullscreen could not open. Try the video player’s own fullscreen control.'); }
  }
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === player.current);
    document.addEventListener('fullscreenchange', change);
    return () => { document.removeEventListener('fullscreenchange', change); };
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]'))) return;
      const key = event.key.toLowerCase();
      if (key === 'f') { event.preventDefault(); void toggleFullscreen(); }
      if (key === 'i') { event.preventDefault(); setFocusMode(current => !current); }
      if (key === 'k' && video.current) { event.preventDefault(); if (video.current.paused) void video.current.play().catch(() => {}); else video.current.pause(); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, []);

  async function toggleCompletion() {
    if (!active || !onCompletion || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCompletion(active, !lessonDone);
    } catch (problem) {
      setError(messageFrom(problem));
    } finally {
      setBusy(false);
    }
  }

  return <PortalDialog title="Classroom" className={`pbs-classroom-dialog ${focusMode ? 'pbs-focus-mode' : ''}`} onClose={closeClassroom}>
    <p className="pbs-classroom-course">{course.title}</p>
    {all.length === 0 ? <Empty title="Lessons are being prepared">Published lessons appear here when PBS adds them to the course.</Empty> :
      <div className="pbs-classroom-layout">
        <section className="pbs-classroom-main" aria-label="Lesson player">
          <div className="pbs-player-toolbar"><span>{focusMode ? 'Focus mode' : 'Lesson player'}</span><div><Button quiet onClick={() => setFocusMode(current => !current)}>{focusMode ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}{focusMode ? 'Exit focus' : 'Focus mode'}</Button><Button quiet onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}Fullscreen</Button></div></div>
          <div className="pbs-player" ref={player}>
            {studentId && <span className="pbs-player-watermark">PBS · {studentId}</span>}
            {!active?<div className="pbs-playback-error"><LockKeyhole/><h3>Your next module opens with your live session</h3><p>See the module schedule and check Live sessions for the next class.</p></div>:!playback.ready ? <p className="pbs-playback-loading" role="status">Restoring your saved place…</p> : active && <LessonPlayer key={`${active.id}:${active.mediaKey || ''}`} lesson={active} videoRef={video} trackViewing={Boolean(studentId)} onComplete={()=>{if(onCompletion&&!completed.has(active.id))void onCompletion(active,true).catch(e=>setError(messageFrom(e)));}}
              initialPosition={playback.positions[active.id]?.position || 0} onSnapshot={(position, duration, immediate) => playback.snapshot(active, position, duration, immediate)} />}
          </div>
          {studentId && <p className="pbs-playback-save" role="status">{playback.status || 'Your place saves as you watch and when you pause.'}</p>}
          {active && <div className="pbs-lesson-meta">
            <div><h3>{active.title}</h3>{active.duration && <p className="pbs-muted">{active.duration}</p>}</div>
          </div>}
          {active?.description && <p className="pbs-muted pbs-pre-wrap">{active.description}</p>}
          <p className="pbs-player-shortcuts">Keyboard <kbd>F</kbd> fullscreen <kbd>I</kbd> focus mode <kbd>K</kbd> play / pause</p>
          <FormError error={error} />
          <div className="pbs-classroom-actions">
            {onCompletion && <span className="pbs-completion-guidance">{lessonDone?'Completed · 80% viewing requirement met':'Completion is automatic after watching 80%. Skipping ahead does not count.'}</span>}
            {next && <Button quiet disabled={!playback.ready||next.locked} onClick={() => chooseLesson(next.id)}>Next lesson <ArrowRight size={18} /></Button>}
            {onCompletion && <button type="button" className="pbs-text-button" onClick={() => setReport(current => !current)}>
              <CircleHelp size={17} /> Report playback issue
            </button>}
          </div>
          {report && active && <form className="pbs-live-form pbs-inset" onSubmit={async event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              await send('/student/messages', { subject: `Playback issue: ${active.title}`.slice(0, 140), body: value(form, 'issue') });
              setReport(false);
              setSent(true);
            } catch (problem) {
              setError(messageFrom(problem));
            }
          }}>
            <Input label="Describe the playback issue" name="issue" maxLength={3000} required />
            <button type="submit" className="pbs-button pbs-button-primary">Send to PBS</button>
          </form>}
          {sent && <p className="pbs-form-status" role="status">Playback report sent to PBS.</p>}
        </section>
        <aside className="pbs-classroom-outline" aria-label="Course modules">
          <div className="pbs-role-control pbs-form-switch" role="group" aria-label="Classroom panel">
            <button type="button" aria-pressed={panel === 'content'} onClick={() => setPanel('content')}>Content</button>
            <button type="button" aria-pressed={panel === 'discussion'} onClick={() => setPanel('discussion')}>Discussion</button>
          </div>
          {panel === 'discussion' ? <Discussion courseId={course.id} /> : <>
          <div className="pbs-outline-heading"><h3><BookOpen size={18} /> Course content</h3><span>{finished} of {all.length} lessons</span></div>
          <label className="pbs-live-search"><Search size={17} /><input type="search" aria-label="Search lessons" placeholder="Search lessons"
            value={query} onChange={event => setQuery(event.target.value)} /></label>
          {course.modules.map((module, index) => {
            const matches = module.title.toLowerCase().includes(term) ? module.lessons : module.lessons.filter(lesson => lesson.title.toLowerCase().includes(term));
            if (term && !matches.length) return null;
            return <details key={`${module.id}-${Boolean(term)}`} open={Boolean(term) || module.lessons.some(lesson => lesson.id === active?.id)}>
              <summary><span className="pbs-module-index">{module.unlocked===false?<LockKeyhole size={15}/>:String(index + 1).padStart(2, '0')}</span><strong>{module.title}</strong><ChevronDown size={16} /></summary>
              {module.unlocked===false&&<p className="pbs-module-lock-note">{module.reason}{module.releaseAt?` ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(module.releaseAt))}`:''}</p>}
              {matches.length ? matches.map(lesson => <button className="pbs-lesson-row" key={lesson.id} type="button"
                aria-current={lesson.id === active?.id ? 'true' : undefined}
                disabled={!playback.ready||lesson.locked} onClick={() => chooseLesson(lesson.id)}>
                {lesson.locked?<LockKeyhole size={16}/>:completed.has(lesson.id) ? <Check size={16} /> : <Play size={16} />}
                <span>{lesson.title}</span><small>{lesson.duration}</small>
              </button>) : <p className="pbs-muted">No lessons in this module.</p>}
            </details>;
          })}
          {course.assessmentAvailable && onAssessment && <div className="pbs-assessment-link">
            <h3>Course assessment</h3>
            <p className="pbs-muted">{finished === all.length ? 'You can now open the assessment.' : 'Complete every lesson to open the assessment.'}</p>
            <Button quiet disabled={finished !== all.length} onClick={onAssessment}>Open assessment <ArrowRight size={17} /></Button>
          </div>}
          </>}
        </aside>
      </div>}
  </PortalDialog>;
}

function Discussion({ courseId }: { courseId: string }) {
  const route = `/courses/${courseId}/discussion`;
  const { data, error, refresh } = useApiResource<{ posts: { id: string; name: string; role: string; body: string; sentAt: string }[] }>(route);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="pbs-live-form">
    <FormError error={error || notice} />
    <form className="pbs-live-form" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const form = event.currentTarget;
      const body = value(new FormData(form), 'body');
      setBusy(true);
      setNotice('');
      try {
        await send(route, { body });
        form.reset();
        await refresh();
      } catch (problem) {
        setNotice(messageFrom(problem));
      } finally {
        setBusy(false);
      }
    }}>
      <Field label="Ask or discuss a course topic"><textarea name="body" rows={3} maxLength={2000} required /></Field>
      <button type="submit" className="pbs-button pbs-button-primary" disabled={busy}>Post message</button>
    </form>
    {data && !data.posts.length && <p className="pbs-muted">No discussion posts yet.</p>}
    {data?.posts.map(post => <article key={post.id} className="pbs-discussion-post">
      <strong>{post.name}{post.role === 'admin' ? ' · PBS' : ''}</strong>
      <p className="pbs-muted">{dateTimeLabel(post.sentAt)}</p>
      <p className="pbs-pre-wrap">{post.body}</p>
    </article>)}
  </div>;
}
