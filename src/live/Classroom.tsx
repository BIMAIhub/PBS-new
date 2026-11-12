import { useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Play, Search } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { messageFrom, send } from './api';
import type { Course, Lesson } from './types';
import { Button, dateTimeLabel, Empty, ExternalLink, Field, FormError, Input, useApiResource, value } from './ui';

export function Classroom({ course, completed, onClose, onCompletion, onAssessment }: {
  course: Course;
  completed: Set<string>;
  onClose: () => void;
  onCompletion?: (lesson: Lesson, done: boolean) => Promise<void>;
  onAssessment?: () => void;
}) {
  const all = course.modules.flatMap(module => module.lessons);
  const [activeId, setActiveId] = useState(() => all.find(lesson => !completed.has(lesson.id))?.id || all[0]?.id);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'content' | 'discussion'>('content');
  const [failed, setFailed] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [sent, setSent] = useState(false);
  const active = all.find(lesson => lesson.id === activeId) || all[0];
  const lessonDone = active ? completed.has(active.id) : false;
  const finished = all.filter(lesson => completed.has(lesson.id)).length;
  const next = active && all[all.findIndex(lesson => lesson.id === active.id) + 1];
  const term = query.toLowerCase().trim();

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

  return <PortalDialog title="Classroom" className="pbs-classroom-dialog" onClose={onClose}>
    <p className="pbs-classroom-course">{course.title}</p>
    {all.length === 0 ? <Empty title="Lessons are being prepared">Published lessons appear here when PBS adds them to the course.</Empty> :
      <div className="pbs-classroom-layout">
        <section className="pbs-classroom-main" aria-label="Lesson player">
          <div className="pbs-player">
            {active && failed === active.id ? <Empty title="Video unavailable">Open the source or report the playback issue to PBS.</Empty> :
              active?.playback.kind === 'video' ? <video key={active.id} src={active.playback.url} controls playsInline preload="metadata"
                onError={() => setFailed(active.id)} aria-label={active.title} /> :
              active?.playback.kind === 'embed' ? <iframe key={active.id} src={active.playback.url} title={active.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> :
              active && <Empty title="Watch on the video provider"><ExternalLink href={active.playback.url}>Open video</ExternalLink></Empty>}
          </div>
          {active && <div className="pbs-lesson-meta">
            <div><h3>{active.title}</h3>{active.duration && <p className="pbs-muted">{active.duration}</p>}</div>
            {active.playback.source && <ExternalLink href={active.playback.source}>Open video source</ExternalLink>}
          </div>}
          {active?.description && <p className="pbs-muted pbs-pre-wrap">{active.description}</p>}
          <FormError error={error} />
          <div className="pbs-classroom-actions">
            {onCompletion && <Button disabled={busy} onClick={() => void toggleCompletion()}>
              <Check size={18} /> {lessonDone ? 'Mark incomplete' : 'Mark complete'}
            </Button>}
            {next && <Button quiet onClick={() => { setActiveId(next.id); setFailed(undefined); }}>Next lesson <ArrowRight size={18} /></Button>}
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
              <summary><span className="pbs-module-index">{String(index + 1).padStart(2, '0')}</span><strong>{module.title}</strong><ChevronDown size={16} /></summary>
              {matches.length ? matches.map(lesson => <button className="pbs-lesson-row" key={lesson.id} type="button"
                aria-current={lesson.id === active?.id ? 'true' : undefined}
                onClick={() => { setActiveId(lesson.id); setFailed(undefined); setSent(false); }}>
                {completed.has(lesson.id) ? <Check size={16} /> : <Play size={16} />}
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
