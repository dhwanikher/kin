// Kin's service worker. Its only job is notifications; there is no offline
// caching here, and pretending otherwise would be worse than not having it —
// a stale cached medication schedule is a dangerous thing to show someone.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Kin', body: event.data?.text() ?? '' };
  }

  const title = data.title ?? 'Kin';
  const options = {
    body: data.body ?? '',
    // Tagging by dose means a second notification about the same dose replaces
    // the first rather than stacking. Someone returning to their phone should
    // find one line per problem, not a wall of them.
    tag: data.tag ?? 'kin',
    renotify: false,
    requireInteraction: false,
    data: { url: data.url ?? '/', occurrenceId: data.occurrenceId ?? null },
    actions: [{ action: 'open', title: 'Open Kin' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/';

  // Focus an existing tab if Kin is already open, rather than piling up
  // duplicate windows every time somebody taps a reminder.
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(target) === false && 'navigate' in client) {
            await client.navigate(target);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
