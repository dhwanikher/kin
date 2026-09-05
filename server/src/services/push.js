// Web push delivery.
//
// A notification is the only part of Kin that reaches someone who is not
// looking at the app, which makes it the only part that can actually prevent a
// missed dose rather than merely record one. It is also the part most likely to
// annoy people into turning it off, so the rules about when to send are kept
// deliberately strict in reminders.js.

import webpush from 'web-push';

import { config } from '../config/env.js';
import { PushSubscription } from '../models/index.js';

let configured = false;

/**
 * Whether push is usable. Without VAPID keys the app still works completely —
 * it simply never notifies — so a missing key is a disabled feature, not a
 * boot failure.
 */
export function pushEnabled() {
  if (configured) return true;
  const { publicKey, privateKey, subject } = config.vapid;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function publicKey() {
  return config.vapid.publicKey;
}

/**
 * Sends a payload to every device belonging to the given users.
 *
 * Subscriptions die constantly — the browser is uninstalled, the user clears
 * site data, the push service expires the endpoint — and the push service says
 * so with 404 or 410. Those are deleted rather than retried, because a dead
 * endpoint never comes back and keeping it means every future send pays for a
 * guaranteed failure.
 */
export async function sendToUsers(userIds, payload) {
  if (!pushEnabled() || userIds.length === 0) {
    return { sent: 0, pruned: 0, failed: 0 };
  }

  const subscriptions = await PushSubscription.find({ user: { $in: userIds } });
  if (subscriptions.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          body
        );
        sent += 1;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          dead.push(sub._id);
        } else {
          failed += 1;
          console.warn('[kin] push failed:', err?.statusCode, err?.message);
        }
      }
    })
  );

  if (dead.length > 0) {
    await PushSubscription.deleteMany({ _id: { $in: dead } });
  }

  return { sent, pruned: dead.length, failed };
}
