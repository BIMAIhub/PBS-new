import { safeUploadText, UploadFailure, type UploadEvent } from './upload-transport';

export type UploadPhase = 'queued' | 'preparing' | 'uploading' | 'verifying' | 'complete' | 'failed' | 'cancelled';
export interface VideoUploadInput {
  file: File; source: 'onedrive' | 'file'; courseId: string; courseTitle: string; moduleId: string; moduleTitle: string;
  title: string; duration: string; description: string; replaceId?: string;
}
export interface VideoUploadJob {
  id: string; filename: string; title: string; courseTitle: string; moduleTitle: string; source: string;
  size: number; uploaded: number; percent: number; speed: number; phase: UploadPhase;
  createdAt: string; updatedAt: string; error?: string; lessonId?: string; logs: UploadEvent[];
}
export interface UploadHooks {
  id: string; signal: AbortSignal; phase: (phase: 'preparing' | 'uploading' | 'verifying', message: string) => void;
  progress: (bytes: number) => void; log: (message: string, detail?: Partial<UploadEvent>) => void;
}
export type VideoUploadWorker = (input: VideoUploadInput, hooks: UploadHooks) => Promise<{ id: string }>;
export const activeUpload = (job: VideoUploadJob) => ['queued', 'preparing', 'uploading', 'verifying'].includes(job.phase);

export class VideoUploadQueue {
  private jobs: VideoUploadJob[] = [];
  private inputs = new Map<string, VideoUploadInput>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private running = 0;
  private disposed = false;
  constructor(private worker: VideoUploadWorker, private completed?: () => void, private concurrency = 2) {}
  snapshot = () => this.jobs;
  activate() { this.disposed = false; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private change(id: string, update: Partial<VideoUploadJob>) {
    this.jobs = this.jobs.map(j => j.id === id ? { ...j, ...update, updatedAt: new Date().toISOString() } : j);
    this.listeners.forEach(fn => fn());
  }
  private log(id: string, message: string, detail: Partial<UploadEvent> = {}) {
    const job = this.jobs.find(j => j.id === id); if (!job) return;
    const event: UploadEvent = { at: new Date().toISOString(), stage: job.phase, message: safeUploadText(message),
      ...(detail.code ? { code: safeUploadText(detail.code).slice(0, 100) } : {}), ...(detail.status ? { status: detail.status } : {}),
      ...(detail.requestId ? { requestId: safeUploadText(detail.requestId).replace(/[^\w:.-]/g, '').slice(0, 200) } : {}) };
    this.change(id, { logs: [...job.logs, event].slice(-150) });
  }
  enqueue(inputs: VideoUploadInput[]) {
    if (this.disposed) throw new Error('Reopen your admin workspace before uploading.');
    if (!inputs.length || inputs.length > 5) throw new Error('Choose up to five videos per batch.');
    if (this.jobs.filter(activeUpload).length + inputs.length > 20) throw new Error('Let a few uploads finish before adding more. The queue supports 20 pending videos.');
    const keys = new Set<string>();
    for (const input of inputs) {
      if (!input.file.size || !/\.(mp4|webm)$/i.test(input.file.name)) throw new Error('Choose non-empty MP4 or WebM videos.');
      if (input.source === 'onedrive' && input.file.size > 8 * 1024 ** 3) throw new Error('OneDrive videos can be up to 8 GB each.');
      if (!input.moduleId || !input.courseId || !input.title.trim() || input.title.length > 160) throw new Error('Choose a module and a title for every video.');
      const key = [input.courseId, input.moduleId, input.file.name, input.file.size, input.file.lastModified].join(':');
      if (keys.has(key) || [...this.inputs.entries()].some(([id, old]) => this.jobs.some(j => j.id === id && activeUpload(j)) && [old.courseId, old.moduleId, old.file.name, old.file.size, old.file.lastModified].join(':') === key)) throw new Error(`${input.file.name} is already queued for this module.`);
      keys.add(key);
    }
    const ids: string[] = [];
    for (const input of inputs) {
      const id = crypto.randomUUID(), at = new Date().toISOString(); ids.push(id); this.inputs.set(id, input);
      this.jobs = [...this.jobs, { id, filename: input.file.name, title: input.title, courseTitle: input.courseTitle, moduleTitle: input.moduleTitle,
        source: input.source, size: input.file.size, uploaded: 0, percent: 0, speed: 0, phase: 'queued', createdAt: at, updatedAt: at,
        logs: [{ at, stage: 'queued', message: 'Added to the background upload queue.' }] }];
    }
    this.listeners.forEach(fn => fn()); this.pump(); return ids;
  }
  private pump() {
    if (this.disposed) return;
    for (const job of this.jobs) {
      if (this.running >= this.concurrency) break;
      if (job.phase === 'queued' && !this.controllers.has(job.id)) void this.run(job.id);
    }
  }
  private async run(id: string) {
    const input = this.inputs.get(id); if (!input) return;
    const controller = new AbortController(); this.controllers.set(id, controller); this.running++;
    let lastBytes = 0, lastTime = Date.now(), lastMilestone = -1, lastPaint = 0;
    this.change(id, { phase: 'preparing', error: undefined, speed: 0 }); this.log(id, 'Preparing the storage destination.');
    const hooks: UploadHooks = {
      id, signal: controller.signal,
      phase: (phase, message) => { if (controller.signal.aborted) return; this.change(id, { phase, ...(phase === 'verifying' ? { percent: 95, speed: 0 } : {}) }); this.log(id, message); },
      progress: bytes => {
        if (controller.signal.aborted) return;
        const uploaded = Math.max(0, Math.min(input.file.size, bytes)), elapsed = (Date.now() - lastTime) / 1000;
        if (Date.now()-lastPaint<150 && uploaded<input.file.size) return;
        lastPaint=Date.now();
        const speed = uploaded<lastBytes?0:elapsed > .1 ? (uploaded - lastBytes) / elapsed : this.jobs.find(j => j.id === id)?.speed || 0;
        this.change(id, { uploaded, percent: Math.min(95, uploaded / input.file.size * 95), speed });
        if (elapsed > .1) { lastTime = Date.now(); lastBytes = uploaded; }
        const milestone = Math.floor(uploaded / input.file.size * 20);
        if (milestone > lastMilestone) { lastMilestone = milestone; this.log(id, `${Math.min(100, milestone * 5)}% of video bytes transferred.`); }
      },
      log: (message, detail) => this.log(id, message, detail),
    };
    try {
      const result = await this.worker(input, hooks);
      if (!controller.signal.aborted) {
        this.change(id, { phase: 'complete', uploaded: input.file.size, percent: 100, speed: 0, lessonId: result.id }); this.log(id, 'Video verified and lesson saved.');
        this.inputs.delete(id); try { this.completed?.(); } catch { this.log(id, 'Lesson saved. Refresh the course list if it has not updated.'); }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const fault = error as UploadFailure;
        this.change(id, { phase: 'failed', error: safeUploadText(error instanceof Error ? error.message : 'The upload failed. Retry from this panel.'), speed: 0 });
        this.log(id, error instanceof Error ? error.message : 'Upload failed.', { code: fault.code || 'UPLOAD_FAILED', status: fault.status, requestId: fault.requestId });
      }
    } finally { this.controllers.delete(id); this.running--; this.pump(); }
  }
  cancel(id: string) {
    const job = this.jobs.find(j => j.id === id); if (!job || !activeUpload(job) || job.phase === 'verifying') return;
    this.change(id, { phase: 'cancelled', speed: 0 }); this.log(id, 'Upload cancelled. An unfinished storage session expires automatically.'); this.controllers.get(id)?.abort(); this.pump();
  }
  retry(id: string) {
    const job = this.jobs.find(j => j.id === id); if (!job || !['failed', 'cancelled'].includes(job.phase) || this.controllers.has(id) || !this.inputs.has(id)) return;
    this.change(id, { phase: 'queued', error: undefined }); this.log(id, 'Retry requested.'); this.pump();
  }
  clearFinished() {
    const finished = this.jobs.filter(j => ['complete', 'cancelled'].includes(j.phase));
    for (const job of finished) this.inputs.delete(job.id);
    this.jobs = this.jobs.filter(j => !finished.includes(j)); this.listeners.forEach(fn => fn());
  }
  remove(id: string) {
    const job=this.jobs.find(j=>j.id===id);if(!job||activeUpload(job)||this.controllers.has(id))return;
    this.inputs.delete(id);this.jobs=this.jobs.filter(j=>j.id!==id);this.listeners.forEach(fn=>fn());
  }
  dispose() { this.disposed = true; this.controllers.forEach(c => c.abort()); this.inputs.clear(); this.listeners.clear(); }
}
