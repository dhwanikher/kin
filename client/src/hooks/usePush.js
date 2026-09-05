import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client.js';

/** The VAPID public key arrives base64url; the browser wants raw bytes. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const supported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/**
 * Notification subscription state for this device.
 *
 * Deliberately never asks for permission on load. A permission prompt fired at
 * someone who has not yet worked out what the app does is the fastest way to a
 * permanent denial, and a denial cannot be undone from inside the page.
 */
export function usePush() {
  const [state, setState] = useState({
    supported: supported(),
    enabledOnServer: false,
    permission: supported() ? Notification.permission : 'unsupported',
    subscribed: false,
    busy: false,
    error: null,
  });

  useEffect(() => {
    if (!supported()) return;

    (async () => {
      try {
        const { enabled } = await api.get('/api/push/key');
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        setState((s) => ({ ...s, enabledOnServer: enabled, subscribed: Boolean(existing) }));
      } catch {
        setState((s) => ({ ...s, enabledOnServer: false }));
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const { enabled, publicKey } = await api.get('/api/push/key');
      if (!enabled) throw new Error('This server has no notification keys configured');

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState((s) => ({
          ...s,
          busy: false,
          permission,
          error:
            permission === 'denied'
              ? 'Your browser is blocking notifications for this site. You will need to allow them in browser settings.'
              : 'Notifications were not allowed.',
        }));
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post('/api/push/subscribe', subscription.toJSON());
      setState((s) => ({ ...s, busy: false, permission, subscribed: true }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Tell the server first. If the browser unsubscribes and the request
        // then fails, the server keeps sending to an endpoint nobody is
        // listening on until the push service finally reports it dead.
        await api.del('/api/push/subscribe', { endpoint: subscription.endpoint }).catch(() => {});
        await subscription.unsubscribe();
      }
      setState((s) => ({ ...s, busy: false, subscribed: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
    }
  }, []);

  const sendTest = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      await api.post('/api/push/test');
      setState((s) => ({ ...s, busy: false }));
      return true;
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
      return false;
    }
  }, []);

  return { ...state, subscribe, unsubscribe, sendTest };
}
