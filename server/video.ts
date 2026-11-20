import type { Lesson } from '../src/live/types.js';

export function externalUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete HTTPS link.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS link.');
  return url;
}

export function videoPlayback(raw: string): Lesson['playback'] {
  const url = externalUrl(raw);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' || ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? segments[0] : url.searchParams.get('v') || segments[1];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { kind: 'embed', url: `https://www.youtube-nocookie.com/embed/${id}`, source: url.href };
    }
    throw new Error('Enter a link to an individual YouTube video.');
  }
  if (host === 'drive.google.com') {
    const id = segments[0] === 'file' && segments[1] === 'd' ? segments[2] : url.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]{8,}$/.test(id)) {
      const embed = new URL(`https://drive.google.com/file/d/${id}/preview`);
      const resourceKey = url.searchParams.get('resourcekey');
      if (resourceKey) embed.searchParams.set('resourcekey', resourceKey);
      return { kind: 'embed', url: embed.href, source: url.href };
    }
    throw new Error('Enter the share link for a Google Drive video file.');
  }
  if ((host === 'onedrive.live.com' && url.pathname === '/embed') ||
      (host.endsWith('.sharepoint.com') && /\/embed\.aspx$/i.test(url.pathname))) {
    return { kind: 'embed', url: url.href, source: url.href };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const id = segments.find(value => /^\d+$/.test(value));
    if (id) {
      const embed = new URL(`https://player.vimeo.com/video/${id}`);
      const hash = url.searchParams.get('h') || segments[1];
      if (hash && /^[a-z\d]{8,}$/i.test(hash)) embed.searchParams.set('h', hash);
      return { kind: 'embed', url: embed.href, source: url.href };
    }
  }
  if (/\.(mp4|webm|ogv)$/i.test(url.pathname)) return { kind: 'video', url: url.href, source: url.href };
  return { kind: 'link', url: url.href };
}
