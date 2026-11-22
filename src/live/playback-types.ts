export interface PlaybackPosition {
  lessonId: string;
  mediaKey: string;
  position: number;
  duration: number;
  revision: string;
  updatedAt: string;
}

export interface CoursePlayback {
  lastLessonId: string;
  positions: PlaybackPosition[];
}

export function playbackTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function resumeTime(position: number, duration: number) {
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position < duration ? Math.max(0, Math.min(position, Math.max(0, duration - .01))) : 0;
}
