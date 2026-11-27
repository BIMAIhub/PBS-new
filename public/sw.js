/* PBS caches public installation assets only. API responses, lessons, files and accounts stay online. */
const PUBLIC_CACHE = 'pbs-public-v3';
const OFFLINE_PAGE = '/offline.html';
const pages = new Set(['overview','students','courses','sessions','enrollments','payments','projects','placements','messages',
  'leads','past-students','resources','certificates','offers','curriculum','course-feedback','batches','notices','fees','project','downloads','reviews','portfolio','profile','referrals','roadmap','mobile-app']);
function notificationTarget(input) {
  try {
    const candidate = new URL(input || '/', self.location.origin);
    if (candidate.origin !== self.location.origin || candidate.pathname !== '/') return '/';
    const page = candidate.searchParams.get('page');
    return pages.has(page) ? `/?page=${encodeURIComponent(page)}` : '/';
  } catch { return '/'; }
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(PUBLIC_CACHE).then(cache => cache.addAll([OFFLINE_PAGE, '/app-icon-192.png', '/app-icon-512.png'])));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pbs-public-') && key !== PUBLIC_CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_PAGE)) || Response.error()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'PBS_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'PBS_SIGNED_OUT') event.waitUntil(self.registration.getNotifications().then(items => items.forEach(item => item.close())));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Still show a visible update, as required on iOS. */ }
  const id = typeof data.id === 'string' ? data.id.slice(0, 400) : 'pbs-update';
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title.slice(0, 120) : 'PBS learning portal', {
    body: typeof data.body === 'string' ? data.body.slice(0, 240) : 'Open PBS to see your latest update.',
    icon: '/app-icon-192.png', badge: '/app-badge.png', tag: id,
    data: { id, url: notificationTarget(data.url) }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && url.pathname === '/';
    });
    if (client) {
      await client.focus();
      client.postMessage({ type: 'PBS_OPEN_NOTIFICATION', url: target, id: event.notification.data?.id });
    } else await self.clients.openWindow(target);
  })());
});
