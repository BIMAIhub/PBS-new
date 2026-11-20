import { useEffect, useState } from 'react';
import { Award, CalendarDays, CheckCircle2, Clock, LockKeyhole, Video } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { messageFrom, send } from './api';
import type { LiveClass, StudentLiveData } from './live-session-types';
import { Button, dateTimeLabel, Empty, FormError, Panel, Status, useApiResource } from './ui';

function stateAt(session: LiveClass, time: number) {
  return session.status === 'cancelled' ? 'cancelled' : !session.accessConfirmed ? 'unavailable' : time >= Date.parse(session.endsAt) ? 'ended' : time >= Date.parse(session.joinOpensAt) ? 'open' : 'upcoming';
}
function timeUntil(time: string, clock: number) {
  const minutes = Math.max(1, Math.ceil((Date.parse(time) - clock) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
function LiveClassCard({ session, clock, onJoined }: { session: LiveClass; clock: number; onJoined: () => Promise<unknown> }) {
  const state = stateAt(session, clock), attendance = session.attendance;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [url, setUrl] = useState('');
  async function join() {
    if (busy) return; setBusy(true); setError('');
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    try {
      const result = await send<{ url: string }>(`/live-classes/${session.id}/join`);
      if (popup) popup.location.replace(result.url); else setUrl(result.url);
      void onJoined().catch(() => {});
    } catch (problem) { popup?.close(); setError(messageFrom(problem)); } finally { setBusy(false); }
  }
  return <article className={`pbs-live-class-card ${state === 'open' ? 'pbs-live-class-open' : ''}`}>
    <div className="pbs-live-class-top"><span className="pbs-live-class-icon"><Video size={24} /></span><div><p>{session.courseTitle}</p><h3>{session.title}</h3></div><Status value={state === 'open' ? 'Live session open' : state === 'upcoming' ? 'Upcoming' : state === 'ended' ? 'Completed' : state === 'cancelled' ? 'Cancelled' : 'Setup pending'} /></div>
    {session.description && <p className="pbs-live-class-description pbs-pre-wrap">{session.description}</p>}
    <div className="pbs-live-class-facts"><span><CalendarDays size={17} />{dateTimeLabel(session.startsAt)} IST</span><span><Clock size={17} />{Math.round((Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000)} minutes</span><span><Award size={17} />{session.points} attendance points</span></div>
    <div className="pbs-live-class-actions">
      <Button disabled={state !== 'open' || busy} onClick={() => void join()}>{state === 'open' ? <Video size={17} /> : <LockKeyhole size={17} />}{busy ? 'Opening Meet…' : state === 'open' ? 'Join Google Meet' : state === 'upcoming' ? `Opens in ${timeUntil(session.joinOpensAt, clock)}` : state === 'ended' ? 'Session ended' : state === 'cancelled' ? 'Session cancelled' : 'Waiting for host setup'}</Button>
      {state !== 'cancelled' && state !== 'ended' && <a className="pbs-text-button" href={`/api/live-classes/${session.id}/calendar`}><CalendarDays size={16} />Add to calendar</a>}
      {state === 'upcoming' && <small>Join opens {session.joinBefore} minutes before the session</small>}
    </div><FormError error={error} />
    {attendance && <div className={`pbs-live-attendance-note ${attendance.status === 'present' ? 'pbs-live-attendance-earned' : ''}`}>
      {attendance.status === 'present' ? <CheckCircle2 size={18} /> : <Clock size={18} />}<span>{attendance.verifiedAt ? <><strong>{attendance.status === 'present' ? 'Attendance confirmed' : attendance.status === 'partial' ? 'Partial attendance' : attendance.status === 'excused' ? 'Excused' : 'Marked absent'}</strong>{attendance.minutes > 0 && ` · ${attendance.minutes} minutes`}{attendance.points > 0 && ` · +${attendance.points} points`}</> : attendance.joinCount > 0 ? 'Your portal join was recorded. Attendance is awaiting confirmation.' : state === 'ended' ? 'Attendance has not been confirmed yet.' : `Attend at least ${session.minimumMinutes} minutes to meet the report threshold.`}</span>
    </div>}
    {url && <PortalDialog title="Your live session is open" onClose={() => setUrl('')}><p className="pbs-muted">Your approved enrollment was checked. Open Google Meet using the Google account invited by your instructor.</p><div className="pbs-dialog-actions"><Button quiet onClick={() => setUrl('')}>Close</Button><a className="pbs-button pbs-button-primary" href={url} target="_blank" rel="noopener noreferrer">Open Google Meet</a></div></PortalDialog>}
  </article>;
}

export function LiveClassesStudent() {
  const { data, error, refresh } = useApiResource<StudentLiveData>('/student/live-classes');
  const [clock, setClock] = useState(Date.now()), [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  useEffect(() => { const offset = data?.serverTime ? Date.parse(data.serverTime) - Date.now() : 0; setClock(Date.now() + offset); const timer = window.setInterval(() => setClock(Date.now() + offset), 1000); return () => clearInterval(timer); }, [data?.serverTime]);
  useEffect(() => { const update = () => { if (document.visibilityState === 'visible') void refresh(); }; const timer = window.setInterval(update, 30_000); window.addEventListener('focus', update); return () => { clearInterval(timer); window.removeEventListener('focus', update); }; }, [refresh]);
  const upcoming = (data?.classes || []).filter(item => !['ended', 'cancelled'].includes(stateAt(item, clock))).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const history = (data?.classes || []).filter(item => ['ended', 'cancelled'].includes(stateAt(item, clock))).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const items = tab === 'upcoming' ? upcoming : history;
  return <div className="pbs-live-stack"><section className="pbs-live-session-banner"><Video size={36} /><div><p>Learn together, build your practice</p><h2>Your live classroom</h2><span>Session access opens at the time set by your instructor. All times below are in IST.</span></div><div className="pbs-live-points"><Award size={22} /><strong>{data?.points || 0}</strong><span>attendance points</span><small>{data?.attended || 0} sessions confirmed</small></div></section>
    <FormError error={error} /><Panel title="Course live sessions" action={<div className="pbs-live-tabs" role="group" aria-label="Live session view"><button type="button" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming · {upcoming.length}</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>History · {history.length}</button></div>}>
      {!data && !error && <p className="pbs-muted" role="status">Loading your sessions…</p>}
      {data && !items.length && <Empty title={tab === 'upcoming' ? 'No upcoming sessions' : 'No completed sessions yet'}>{tab === 'upcoming' ? 'Published sessions from your approved courses will appear here, with a notification when they are scheduled.' : 'Your attendance decisions and earned points appear with each completed session.'}</Empty>}
      <div className="pbs-live-class-list">{items.map(session => <LiveClassCard key={session.id} session={session} clock={clock} onJoined={refresh} />)}</div>
    </Panel><p className="pbs-session-footnote">Opening Meet records a portal join. Your instructor confirms actual attendance or imports a Meet report; points are then added once per session. Join with the Google account invited by your instructor.</p></div>;
}

export function NextLiveSession({ data, onOpen }: { data: StudentLiveData; onOpen: () => void }) {
  const next = data.classes.filter(item => item.status === 'scheduled' && Date.parse(item.endsAt) > Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  return <Panel title="Next live session">{next ? <div className="pbs-next-live"><span><Video size={24} /></span><div><h3>{next.title}</h3><p className="pbs-muted">{next.courseTitle}</p><p className="pbs-muted">{dateTimeLabel(next.startsAt)} IST</p><Button onClick={onOpen}>{next.state === 'open' ? 'Open live classroom' : 'View session'}</Button></div></div> : <Empty title="No upcoming sessions">Scheduled sessions from your approved courses will appear here.</Empty>}</Panel>;
}
