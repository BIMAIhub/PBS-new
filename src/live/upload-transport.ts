export interface UploadEvent {
  at: string; stage: string; message: string; code?: string; status?: number; requestId?: string;
}
export class UploadFailure extends Error {
  constructor(public code: string, message: string, public status?: number, public requestId?: string) { super(message); }
}
export const safeUploadText = (text: string) => text
  .replace(/https?:\/\/[^\s<>"']+/gi, '[private URL hidden]')
  .replace(/Bearer\s+\S+/gi, '[credential hidden]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[credential hidden]')
  .slice(0, 1200);
export const uploadAbort = () => new DOMException('Upload cancelled.', 'AbortError');
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw uploadAbort(); };

export interface UploadResponse { status: number; data: any; requestId?: string; retryAfter?: number }
export interface UploadRequest {
  url: string; method: 'GET' | 'PUT' | 'POST'; body?: Blob; headers?: Record<string, string>;
  signal: AbortSignal; progress?: (bytes: number) => void;
}
export type UploadTransport = (request: UploadRequest) => Promise<UploadResponse>;

// No bearer header or cookies are added to a pre-authorized storage URL.
export function browserUploadRequest(request: UploadRequest, create = () => new XMLHttpRequest()): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) { reject(uploadAbort()); return; }
    const xhr = create(); let timer: ReturnType<typeof setTimeout>, settled = false;
    const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
    const finish = (error?: Error, result?: UploadResponse) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(result!); };
    const abort = () => { xhr.abort(); finish(uploadAbort()); };
    const activity = () => { clearTimeout(timer); timer = setTimeout(() => { finish(new UploadFailure('UPLOAD_TIMEOUT', 'No upload activity for 90 seconds. Check your connection and retry.')); xhr.abort(); }, 90_000); };
    xhr.open(request.method, request.url, true); xhr.withCredentials = false;
    for (const [key, val] of Object.entries(request.headers || {})) xhr.setRequestHeader(key, val);
    xhr.upload.onprogress = event => { activity(); request.progress?.(event.loaded); };
    xhr.onprogress = activity;
    xhr.onload = () => {
      let data: any = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* Never log a provider's raw response. */ }
      const exposed = Object.fromEntries(xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).map(line => { const colon=line.indexOf(':');return [line.slice(0,colon).toLowerCase(),line.slice(colon+1).trim()]; }));
      const requestId = (exposed['request-id'] || exposed['x-ms-request-id'] || exposed['x-vercel-id'] || '').replace(/[^\w:.-]/g, '').slice(0, 200);
      const retryAfter = Number(exposed['retry-after']);
      finish(undefined, { status: xhr.status, data, requestId, retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined });
    };
    xhr.onerror = () => finish(new UploadFailure('NETWORK_OR_CORS', 'The browser could not reach the upload service. Check your connection, then retry. If it continues, download the logs for PBS support.'));
    xhr.onabort = () => finish(uploadAbort());
    request.signal.addEventListener('abort', abort, { once: true }); activity();
    try { xhr.send(request.body); } catch { finish(new UploadFailure('UPLOAD_REQUEST_FAILED', 'The browser could not start this upload. Retry from the upload panel.')); }
  });
}

export function uploadResponseError(response: UploadResponse) {
  const code = String(response.data?.error?.code || '').replace(/[^\w.-]/g, '').slice(0, 80) || `HTTP_${response.status}`;
  const message = response.status === 401 || response.status === 403 ? 'Storage access was rejected or expired. Reconnect the storage account if retrying does not help.'
    : response.status === 404 || response.status === 410 ? 'This upload session has expired. Retry to create a new session.'
    : response.status === 413 ? 'This file exceeds the upload limit for this storage destination.'
    : response.status === 429 ? 'The storage service is busy. The upload will retry shortly.'
    : `The upload service returned HTTP ${response.status}. Retry or download the logs for support.`;
  return new UploadFailure(code, message, response.status, response.requestId);
}

export function waitForUpload(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(uploadAbort()); return; }
    const abort = () => { clearTimeout(timer); reject(uploadAbort()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export interface DriveTransfer {
  url: string; file: Blob; chunkSize: number; signal: AbortSignal; resume?: boolean;
  progress: (bytes: number) => void; event?: (message: string, detail?: Partial<UploadEvent>) => void;
  request?: UploadTransport; delay?: typeof waitForUpload;
}
export async function uploadDriveChunks(input: DriveTransfer): Promise<string | undefined> {
  const request = input.request || browserUploadRequest, delay = input.delay || waitForUpload;
  if (!input.file.size || !Number.isInteger(input.chunkSize) || input.chunkSize < 327680 || input.chunkSize % 327680 || input.chunkSize >= 60 * 1024 ** 2) throw new UploadFailure('INVALID_CHUNK_SIZE', 'The storage service returned an invalid upload fragment size.');
  let offset = 0, failures = 0, operations = 0;
  const nextOffset = (data: any) => {
    const raw = data?.nextExpectedRanges?.[0], next = typeof raw === 'string' ? Number(raw.split('-')[0]) : NaN;
    if (!Number.isSafeInteger(next) || next < 0 || next > input.file.size) throw new UploadFailure('INVALID_UPLOAD_RESPONSE', 'OneDrive did not return a valid upload position. Retry this file.');
    return next;
  };
  const recover = async () => {
    const result = await request({ url: input.url, method: 'GET', signal: input.signal });
    if (result.status === 404 || result.status === 410) return false; // The file may already be committed; PBS verifies it by its authorized filename.
    if (result.status < 200 || result.status >= 300) throw uploadResponseError(result);
    offset = nextOffset(result.data); input.progress(offset); input.event?.('Resumed from the position confirmed by OneDrive.'); return true;
  };
  if (input.resume && !await recover()) return undefined;
  while (offset < input.file.size) {
    checkAbort(input.signal);
    if (++operations > Math.ceil(input.file.size / input.chunkSize) * 3 + 20) throw new UploadFailure('UPLOAD_NOT_ADVANCING', 'OneDrive is not advancing this upload. Retry the file.');
    const start = offset, end = Math.min(input.file.size, start + input.chunkSize);
    try {
      const response = await request({ url: input.url, method: 'PUT', body: input.file.slice(start, end), signal: input.signal,
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${input.file.size}`, 'Content-Type': 'application/octet-stream' },
        progress: bytes => input.progress(Math.min(input.file.size, start + Math.min(bytes, end - start))) });
      if (response.status === 200 || response.status === 201) {
        if (!response.data?.id) throw new UploadFailure('MISSING_FILE_CONFIRMATION', 'OneDrive did not confirm the completed file. Retry to check its status.');
        input.progress(input.file.size); return String(response.data.id);
      }
      if (response.status === 202) {
        const next = nextOffset(response.data); if (next <= start) throw new UploadFailure('UPLOAD_NOT_ADVANCING', 'OneDrive requested the same fragment again.');
        offset = next; failures = 0; input.progress(offset); continue;
      }
      if (response.status === 404 || response.status === 410) return undefined;
      if (![416, 429, 500, 502, 503, 504].includes(response.status)) throw uploadResponseError(response);
      throw Object.assign(uploadResponseError(response), { retryAfter: response.retryAfter, recoverable: true });
    } catch (error) {
      checkAbort(input.signal);
      const failure = error as UploadFailure & { retryAfter?: number; recoverable?: boolean };
      const retryable = failure.recoverable || ['NETWORK_OR_CORS', 'UPLOAD_TIMEOUT', 'UPLOAD_NOT_ADVANCING'].includes(failure.code);
      if (!retryable || ++failures > 3) throw error;
      input.event?.(`Connection interrupted. Retry ${failures} of 3.`, { code: failure.code, status: failure.status, requestId: failure.requestId });
      await delay(Math.min(20_000, Math.max(1000 * 2 ** (failures - 1), (failure.retryAfter || 0) * 1000)), input.signal);
      if (!await recover()) return undefined;
    }
  }
  return undefined;
}
