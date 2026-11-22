import { RequestError } from './http.js';
import { externalUrl } from './video.js';

export function microsoftDownloadLocation(value: string) {
  let target: URL;
  try { target = externalUrl(value); }
  catch { throw new RequestError(502, 'Microsoft returned an invalid video location.'); }
  const trusted = ['1drv.com', 'onedrive.live.com', 'sharepoint.com', 'sharepointonline.com']
    .some(domain => target.hostname === domain || target.hostname.endsWith(`.${domain}`));
  if (!trusted || target.port && target.port !== '443') throw new RequestError(502, 'Microsoft returned an unsupported video location.');
  return target.href;
}

// /content returns a short-lived Location header. Read that header on the server
// without following it or passing the Microsoft access token to the file host.
export async function readMicrosoftContentLocation(token: string, path: string, transport: typeof fetch = fetch) {
  if (!/^\/(?:drives\/[^/?#]+\/items\/[^/?#]+|shares\/u![A-Za-z0-9_-]+\/driveItem)\/content$/.test(path)) {
    throw new RequestError(400, 'The Microsoft video request is invalid.');
  }
  const response = await transport(`https://graph.microsoft.com/v1.0${path}`, {
    method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  try {
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) return microsoftDownloadLocation(location);
      throw new RequestError(502, 'Microsoft did not return a video playback address. Try again or report this recording to PBS.');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
      const raw = body.error?.code;
      const code = typeof raw === 'string' && /^[\w.]{1,100}$/.test(raw) ? raw : String(response.status);
      if ([401, 403].includes(response.status)) throw new RequestError(502, `Microsoft denied access to this recording (${code}). PBS needs to verify the connected course owner can open this file.`);
      if (response.status === 404) throw new RequestError(502, 'Microsoft could not find this recording. PBS needs to check its saved video link.');
      throw new RequestError(response.status === 429 ? 503 : 502, `Microsoft video playback is unavailable (${code}). Try again shortly.`);
    }
    throw new RequestError(502, 'Microsoft did not return a seekable video address. PBS can upload this recording as an MP4 or WebM lesson.');
  } finally {
    if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
  }
}
