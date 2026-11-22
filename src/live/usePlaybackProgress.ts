import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { Lesson } from './types';
import type { CoursePlayback, PlaybackPosition } from './playback-types';

type Snapshot = { lessonId: string; mediaKey: string; position: number; duration: number; updatedAt: string };

export function usePlaybackProgress(courseId: string, studentId: string | undefined, lessons: Lesson[]) {
  const cacheKey = `pbs:playback:${studentId || 'preview'}:${courseId}`;
  const [ready, setReady] = useState(!studentId), [lastLessonId, setLastLessonId] = useState('');
  const [positions, setPositions] = useState<Record<string, PlaybackPosition>>({});
  const [status, setStatus] = useState('');
  const mounted = useRef(false), loading = useRef(Boolean(studentId));
  const writer = useRef(crypto.randomUUID()), sequence = useRef(0);
  const revisions = useRef(new Map<string, string>()), local = useRef<Record<string, PlaybackPosition>>({});
  const pending = useRef(new Map<string, Snapshot>()), draining = useRef(false), current = useRef<Snapshot | undefined>(undefined);
  const lastServerSave = useRef(0), lastLocalSave = useRef(0), statusRef = useRef('');
  const report = useCallback((text: string) => { if (mounted.current && statusRef.current !== text) { statusRef.current = text; setStatus(text); } }, []);
  const cache = useCallback((snapshot: Snapshot) => {
    local.current[snapshot.lessonId] = { ...snapshot, revision: revisions.current.get(snapshot.lessonId) || '' };
    try { localStorage.setItem(cacheKey, JSON.stringify({ lastLessonId: snapshot.lessonId, positions: Object.values(local.current) })); } catch { /* Server sync still works when local storage is unavailable. */ }
  }, [cacheKey]);

  const drain = useCallback(async () => {
    if (draining.current || loading.current || !studentId) return;
    draining.current = true;
    try {
      while (pending.current.size) {
        const [id, snapshot] = pending.current.entries().next().value!;
        pending.current.delete(id);
        try {
          const result = await api<{ progress: PlaybackPosition }>(`/student/lessons/${encodeURIComponent(id)}/playback`, {
            method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...snapshot, writerId: writer.current, sequence: ++sequence.current, revision: revisions.current.get(id) || '' }),
          });
          revisions.current.set(id, result.progress.revision);
          if (mounted.current) setPositions(previous => ({ ...previous, [id]: result.progress }));
          report('Place saved');
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            // Do not let a late pause/close from another window overwrite newer viewing.
            pending.current.clear();
            try {
              const latest = await api<CoursePlayback>(`/student/courses/${encodeURIComponent(courseId)}/playback`);
              for (const item of latest.positions) revisions.current.set(item.lessonId, item.revision);
              const updated = latest.positions.find(item => item.lessonId === id);
              if (updated) local.current[id] = updated; else delete local.current[id];
              if (current.current?.lessonId === id) current.current = undefined;
              try { localStorage.setItem(cacheKey, JSON.stringify({ lastLessonId: latest.lastLessonId, positions: Object.values(local.current) })); } catch { /* Server position remains authoritative. */ }
            } catch { /* A subsequent active save can retry after reconnecting. */ }
            report('Your place was updated in another window, or the recording changed.');
          } else if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
            pending.current.clear(); report('Sign in again to sync your saved place.');
          } else {
            if (!pending.current.has(id)) pending.current.set(id, snapshot);
            report('Place saved on this device · waiting to sync');
          }
          break;
        }
      }
    } finally { draining.current = false; }
  }, [courseId, studentId, cacheKey, report]);

  const snapshot = useCallback((lesson: Lesson, position: number, duration: number, immediate = false) => {
    if (!studentId || !lesson.mediaKey || !Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
    const record = { lessonId: lesson.id, mediaKey: lesson.mediaKey, position: Math.min(Math.max(0, position), duration), duration, updatedAt: new Date().toISOString() };
    current.current = record;
    const time = Date.now();
    if (immediate || time - lastLocalSave.current > 4000) { cache(record); lastLocalSave.current = time; }
    if (immediate || time - lastServerSave.current > 15000) {
      lastServerSave.current = time; pending.current.set(lesson.id, record); void drain();
    }
  }, [studentId, cache, drain]);

  const flush = useCallback(() => {
    if (current.current && studentId) { cache(current.current); pending.current.set(current.current.lessonId, current.current); void drain(); }
  }, [studentId, cache, drain]);

  useEffect(() => {
    mounted.current = true;
    if (!studentId) { loading.current = false; setReady(true); return () => { mounted.current = false; }; }
    let cancelled = false;
    const valid = (item: PlaybackPosition) => item && Number.isFinite(Date.parse(item.updatedAt)) && lessons.some(lesson => lesson.id === item.lessonId && lesson.mediaKey === item.mediaKey) && Number.isFinite(item.position) && Number.isFinite(item.duration) && item.position >= 0 && item.duration > 0 && item.position <= item.duration;
    let cached: CoursePlayback = { lastLessonId: '', positions: [] };
    try {
      const parsed = JSON.parse(localStorage.getItem(cacheKey) || '{}');
      if (Array.isArray(parsed.positions)) cached = { lastLessonId: String(parsed.lastLessonId || ''), positions: parsed.positions.filter(valid) };
    } catch { /* A malformed cache never blocks classroom playback. */ }
    void (async () => {
      let saved: CoursePlayback = { lastLessonId: '', positions: [] };
      try { saved = await api<CoursePlayback>(`/student/courses/${encodeURIComponent(courseId)}/playback`); }
      catch { report('Resume is available on this device · server sync is unavailable'); }
      if (cancelled) return;
      for (const record of saved.positions) revisions.current.set(record.lessonId, record.revision);
      const combined = new Map(saved.positions.filter(valid).map(item => [item.lessonId, item]));
      for (const item of cached.positions) {
        const existing = combined.get(item.lessonId);
        if (!existing || Date.parse(item.updatedAt) > Date.parse(existing.updatedAt)) combined.set(item.lessonId, item);
      }
      local.current = Object.fromEntries(combined);
      setPositions(local.current);
      const recent = [...combined.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      setLastLessonId(recent?.lessonId || ''); loading.current = false; setReady(true); void drain();
    })();
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const online = () => { void drain(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', flush); window.addEventListener('online', online);
    return () => {
      flush(); cancelled = true; mounted.current = false;
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', flush); window.removeEventListener('online', online);
    };
    // Lessons belong to a fixed classroom instance. Recording keys are checked again on every save.
  }, [courseId, studentId, cacheKey, drain, flush, report]);

  return { ready, lastLessonId, positions, status, snapshot, flush };
}
