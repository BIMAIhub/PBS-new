import { api, ApiError } from './api';
import type { UploadHooks, VideoUploadInput, VideoUploadWorker } from './upload-queue';
import { browserUploadRequest, safeUploadText, uploadAbort, uploadDriveChunks, UploadFailure, uploadResponseError, type UploadTransport } from './upload-transport';

interface StorageSession { storage?: 'local' | 'blob'; uploadId: string; url: string; chunkSize: number; expiresAt?: number }
interface TransferState { session?: StorageSession; started?: boolean; uploaded?: boolean; itemId?: string }
type JsonRequest = <T>(path: string, body: unknown, signal: AbortSignal) => Promise<T>;

export async function uploadJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
  try { return await api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }); }
  catch (error) {
    if (signal.aborted) throw uploadAbort();
    if (timedOut) throw new UploadFailure('PBS_REQUEST_TIMEOUT', 'PBS did not finish this step within a minute. Retry from the upload panel; completed storage transfers will be checked before uploading again.');
    if (error instanceof ApiError) throw new UploadFailure(`PBS_HTTP_${error.status}`, safeUploadText(error.message), error.status, error.requestId);
    throw new UploadFailure('PBS_NETWORK_ERROR', 'The browser could not reach PBS. Check your connection and retry.');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function createVideoUploadWorker(json: JsonRequest = uploadJson, transfer: UploadTransport = browserUploadRequest): VideoUploadWorker {
  const states = new Map<string, TransferState>();
  return async (input: VideoUploadInput, hooks: UploadHooks) => {
    let state = states.get(hooks.id); if (!state) { state = {}; states.set(hooks.id, state); }
    const route = `/admin/courses/${encodeURIComponent(input.courseId)}/modules/${encodeURIComponent(input.moduleId)}/lessons`;
    const contentType = /\.mp4$/i.test(input.file.name) ? 'video/mp4' : 'video/webm';
    const details = { title: input.title, duration: input.duration, description: input.description, ...(input.replaceId ? { replaceId: input.replaceId } : {}) };
    if (input.source !== 'onedrive' && state.session?.expiresAt && state.session.expiresAt < Date.now() && !state.uploaded) { state = {}; states.set(hooks.id, state); hooks.log('The previous upload session expired. Preparing a new session.'); }
    if (!state.session) {
      hooks.phase('preparing', input.source === 'onedrive' ? 'Creating a OneDrive upload session and checking the course folder.' : 'Preparing private PBS video storage.');
      state.session = await json<StorageSession>(input.source === 'onedrive' ? `/admin/modules/${encodeURIComponent(input.moduleId)}/drive-upload` : `${route}/upload`, { filename: input.file.name, size: input.file.size, contentType }, hooks.signal);
      hooks.log(`Storage session ${state.session.uploadId} is ready.`, { code: 'SESSION_CREATED' });
    }
    const session = state.session;
    if (!state.uploaded) {
      hooks.phase('uploading', state.started ? 'Checking the previous transfer and resuming the video.' : 'Uploading video bytes. You can keep browsing PBS.');
      if (input.source === 'onedrive') {
        const resume = state.started; state.started = true;
        state.itemId = await uploadDriveChunks({ url: session.url, file: input.file, chunkSize: session.chunkSize, resume,
          signal: hooks.signal, progress: hooks.progress, event: hooks.log, request: transfer });
      } else if (session.storage === 'blob') {
        state.started = true;
        const response = await transfer({ url: session.url, method: 'PUT', body: input.file, headers: { 'Content-Type': contentType }, signal: hooks.signal, progress: hooks.progress });
        // A retry may encounter the already-uploaded fixed pathname. PBS verifies it before attaching a lesson.
        if ((response.status < 200 || response.status >= 300) && response.status !== 409) throw uploadResponseError(response);
      } else {
        state.started = true;
        const query = new URLSearchParams({ ...details, uploadId: session.uploadId });
        const response = await transfer({ url: `/api${route}/file?${query}`, method: 'POST', body: input.file,
          headers: { 'Content-Type': contentType, 'X-PBS-Request': '1' }, signal: hooks.signal, progress: n=>{hooks.progress(n);if(n>=input.file.size)hooks.phase('verifying','Video bytes transferred. PBS is checking and saving this local lesson.');} });
        if (response.status < 200 || response.status >= 300) throw new UploadFailure(`PBS_HTTP_${response.status}`,typeof response.data?.error==='string'?safeUploadText(response.data.error):uploadResponseError(response).message,response.status,response.requestId);
        if (!response.data?.id) throw new UploadFailure('MISSING_LESSON_CONFIRMATION', 'PBS did not confirm the saved lesson. Retry to check this upload.');
        states.delete(hooks.id); return { id: String(response.data.id) };
      }
      state.uploaded = true; hooks.progress(input.file.size);
    }
    hooks.phase('verifying', 'Video bytes transferred. PBS is verifying the file and saving the lesson.');
    try {
      const result = await json<{id:string}>(input.source === 'onedrive' ? `/drive-uploads/${encodeURIComponent(session.uploadId)}/complete` : `${route}/upload/${encodeURIComponent(session.uploadId)}`,
        { ...details, ...(state.itemId ? { itemId: state.itemId } : {}) }, hooks.signal);
      states.delete(hooks.id); return result;
    } catch (error) {
      const failure = error as UploadFailure;
      if (input.source === 'onedrive' && !state.itemId && [400, 404, 409, 410].includes(failure.status || 0)) {
        states.delete(hooks.id);
        throw new UploadFailure('UPLOAD_SESSION_EXPIRED', 'The upload session ended before the complete file could be verified. Retry to create a new session.', failure.status, failure.requestId);
      }
      if (session.expiresAt && session.expiresAt < Date.now()) states.delete(hooks.id);
      throw error;
    }
  };
}
