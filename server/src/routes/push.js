import { Router } from 'express';
import { z } from 'zod';

import { PushSubscription } from '../models/index.js';
import { asyncRoute, badRequest } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicKey, pushEnabled, sendToUsers } from '../services/push.js';

const router = Router();

// The public key is not a secret — the browser needs it to build a
// subscription — so this is the one push endpoint that does not require a
// session. `enabled` lets the UI say "notifications are not configured on this
// server" rather than failing mysteriously when the user taps the button.
router.get('/key', (_req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: publicKey() });
});

router.use(requireAuth);

const subscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * Stores a browser's push subscription.
 *
 * Upserted on the endpoint, because re-subscribing on the same browser returns
 * the same endpoint and a second row would mean every notification arriving
 * twice on one device. The user is set on every write so a shared computer
 * moves the subscription to whoever signed in last rather than continuing to
 * notify the previous person.
 */
router.post(
  '/subscribe',
  validate(subscription),
  asyncRoute(async (req, res) => {
    if (!pushEnabled()) throw badRequest('Push notifications are not configured on this server');

    const saved = await PushSubscription.findOneAndUpdate(
      { endpoint: req.body.endpoint },
      {
        user: req.userId,
        endpoint: req.body.endpoint,
        keys: req.body.keys,
        userAgent: req.get('user-agent') ?? '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ subscribed: true, id: saved._id });
  })
);

router.delete(
  '/subscribe',
  validate(z.object({ endpoint: z.string().url() })),
  asyncRoute(async (req, res) => {
    await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: req.userId });
    res.status(204).end();
  })
);

/** Sends a notification to the caller's own devices, to prove the wiring. */
router.post(
  '/test',
  asyncRoute(async (req, res) => {
    if (!pushEnabled()) throw badRequest('Push notifications are not configured on this server');

    const result = await sendToUsers([req.userId], {
      title: 'Kin notifications are working',
      body: 'You will be told when a dose goes overdue.',
      tag: 'kin-test',
      url: '/circles',
    });

    if (result.sent === 0) {
      throw badRequest('No active subscription for this account on any device');
    }
    res.json(result);
  })
);

export default router;
