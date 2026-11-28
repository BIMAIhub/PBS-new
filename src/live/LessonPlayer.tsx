import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import type { Lesson } from './types';
import { api, messageFrom } from './api';
import { playbackTime, resumeTime } from './playback-types';
import { Button, Empty, Field } from './ui';
import { useViewingTracker } from './useViewingTracker';

export function LessonPlayer({ lesson, initialPosition, videoRef, onSnapshot,trackViewing=false,onComplete }: {
  lesson: Lesson; initialPosition: number; videoRef: RefObject<HTMLVideoElement | null>;
  onSnapshot: (position: number, duration: number, immediate?: boolean) => void;
  trackViewing?:boolean;onComplete?:()=>void;
}) {
  const viewing=useViewingTracker(lesson,videoRef,trackViewing,onComplete);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0), [rate, setRate] = useState(1), [resumed, setResumed] = useState(0);
  const touched = useRef(false), restoring = useRef(false), last = useRef<{ position: number; duration: number } | undefined>(undefined);
  const callback = useRef(onSnapshot); callback.current = onSnapshot;
  const capture = (immediate = false) => {
    const video = videoRef.current;
    if (!video || restoring.current || !touched.current || !Number.isFinite(video.duration) || video.duration <= 0) return;
    last.current = { position: video.currentTime, duration: video.duration };
    callback.current(video.currentTime, video.duration, immediate);
  };
  useEffect(() => () => { if (last.current) callback.current(last.current.position, last.current.duration, true); }, []);
  async function playbackError() {
    setError('This recording could not play. Try again or report the issue to PBS.');
    if (lesson.playback.provider === 'microsoft') {
      try { await api(`/lessons/${encodeURIComponent(lesson.id)}/playback-status`); }
      catch (problem) { setError(messageFrom(problem)); }
    }
  }
  const seek = (seconds: number) => {
    const video = videoRef.current; if (!video || !duration) return;
    touched.current = true; video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
  };
  if (lesson.playback.kind === 'link') return <Empty title="This recording needs an update">PBS needs to attach a playable video file to this lesson. Use Report playback issue below to let your instructor know.</Empty>;
  if (lesson.playback.kind === 'embed') return <div className="pbs-embedded-video"><iframe src={lesson.playback.url} title={lesson.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /><p>Embedded video · automatic PBS resume is available for uploaded and connected OneDrive recordings</p></div>;
  return <div className="pbs-native-player">
    {error ? <div className="pbs-playback-error" role="alert"><h3>Recording unavailable</h3><p>{error}</p><Button quiet onClick={() => { setError(''); setDuration(0); restoring.current = false; setAttempt(value => value + 1); }}>Retry playback</Button></div> : <video key={`${lesson.id}:${attempt}`} ref={videoRef} src={lesson.playback.url} controls playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback onContextMenu={event => event.preventDefault()} aria-label={lesson.title}
      onLoadedMetadata={event => {
        const video = event.currentTarget; setDuration(video.duration);
        const position = resumeTime(last.current?.position ?? initialPosition, video.duration);
        if (position > 0) { restoring.current = true; video.currentTime = position; setResumed(position); }
        video.playbackRate = rate;
      }}
      onPlay={() => { touched.current = true; setPaused(false); capture(true);void viewing.start(); }}
      onPause={() => { setPaused(true); capture(true);viewing.tick(true); }}
      onTimeUpdate={() => {capture();viewing.tick();}}
      onSeeking={()=>viewing.seek()}
      onSeeked={() => { restoring.current = false; capture(true); }}
      onEnded={() => { setPaused(true); capture(true);viewing.tick(true); }}
      onError={() => void playbackError()} />}
    {!error && <div className="pbs-video-controls" aria-label="Video playback tools">
      <div className="pbs-actions"><Button quiet disabled={!duration} onClick={() => {
        const video = videoRef.current; if (!video) return;
        if (video.paused) void video.play().catch(() => setError('Playback could not start. Try the play control on the video.')); else video.pause();
      }}>{paused ? <Play size={16} /> : <Pause size={16} />}{paused ? 'Play video' : 'Pause'}</Button>
        <Button quiet disabled={!duration} onClick={() => seek(-10)}><RotateCcw size={16} />10s back</Button>
        <Button quiet disabled={!duration} onClick={() => seek(10)}><RotateCw size={16} />10s forward</Button>
        <Button quiet disabled={!duration} onClick={() => { const video = videoRef.current; if (video) { touched.current = true; video.currentTime = 0; } }}>Start over</Button>
      </div>
      <Field label="Playback speed"><select aria-label="Playback speed" value={rate} onChange={event => { const speed = Number(event.target.value); setRate(speed); if (videoRef.current) videoRef.current.playbackRate = speed; }}>{[.75, 1, 1.25, 1.5, 1.75, 2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></Field>
      {resumed > 0 && <p className="pbs-resume-note">Resumed from {playbackTime(resumed)}</p>}
      {trackViewing&&<div className="pbs-watching-progress"><progress max={80} value={Math.min(80,viewing.progress.percent)} aria-label="Watched progress toward completion"/><span>{viewing.progress.percent}% watched · completes at 80%</span><small role="status">{viewing.status}</small></div>}
    </div>}
  </div>;
}
