// Deciding when to disturb somebody.
//
// This is the part of Kin that reaches into a pocket, so the bar for sending is
// higher than the bar for showing something on screen. Three rules:
//
//   1. Only when a dose is genuinely late — past its time by the grace period.
//   2. Once per dose, ever. Nagging is how notifications get switched off, and
//      a person who has switched them off is worse than one who never had them.
//   3. Only to people who could act on it. A viewer cannot record a dose, so
//      waking them achieves nothing.

import { DateTime } from 'luxon';

import { config } from '../config/env.js';
import { Membership, Occurrence } from '../models/index.js';
import { pushEnabled, sendToUsers } from './push.js';

/**
 * Finds overdue doses nobody has been told about, claims them, and notifies.
 *
 * The claim is the same trick the resolve endpoint uses: a conditional update
 * on (still due, not yet reminded) that only one caller can win. Two overlapping
 * sweeps — a slow one and the next tick, say — therefore cannot both send for
 * the same dose. Reading a list and then sending would let exactly that happen,
 * and a duplicate notification about medication is the kind of thing that makes
 * someone give a second tablet.
 */
export async function sweepOverdue({ now = new Date() } = {}) {
  if (!pushEnabled()) return { considered: 0, notified: 0, sent: 0 };

  const cutoff = new Date(now.getTime() - config.reminderGraceMinutes * 60 * 1000);

  const candidates = await Occurrence.find({
    status: 'due',
    remindedAt: null,
    dueAt: { $lte: cutoff },
  })
    .populate('medication', 'name dose')
    .populate('circle', 'name timezone')
    .limit(200);

  let notified = 0;
  let sent = 0;

  for (const candidate of candidates) {
    // Claim it. If this returns null somebody else got there first, or the dose
    // was resolved in the moment between the query and now — either way there
    // is nothing to send.
    const claimed = await Occurrence.findOneAndUpdate(
      { _id: candidate._id, status: 'due', remindedAt: null },
      { remindedAt: now },
      { new: true }
    );
    if (!claimed) continue;

    const audience = await Membership.find({
      circle: candidate.circle._id,
      role: { $in: ['admin', 'caregiver'] },
    }).select('user');

    if (audience.length === 0) continue;

    const time = DateTime.fromJSDate(candidate.dueAt)
      .setZone(candidate.circle.timezone)
      .toFormat('HH:mm');

    const result = await sendToUsers(
      audience.map((m) => m.user),
      {
        title: `${candidate.medication?.name ?? 'A dose'} is overdue`,
        body: `${candidate.circle.name} — due at ${time}${
          candidate.medication?.dose ? `, ${candidate.medication.dose}` : ''
        }`,
        tag: `dose-${candidate._id}`,
        url: `/c/${candidate.circle._id}/today`,
        occurrenceId: String(candidate._id),
      }
    );

    notified += 1;
    sent += result.sent;
  }

  return { considered: candidates.length, notified, sent };
}

/**
 * Runs the sweep on a timer, and returns a function that stops it.
 *
 * A setInterval in the API process is honest for a single-instance deployment
 * and has no infrastructure to forget to deploy. It is also the first thing
 * that would have to change to run more than one instance: every instance would
 * sweep, which the atomic claim makes safe but wasteful. A real deployment would
 * move this to one worker.
 */
export function startReminderLoop({ intervalSeconds = config.reminderSweepSeconds } = {}) {
  if (!pushEnabled()) {
    console.log('[kin] push notifications disabled (no VAPID keys); reminders will not run');
    return () => {};
  }

  let running = false;

  const tick = async () => {
    // A sweep that overruns its interval must not stack up behind itself.
    if (running) return;
    running = true;
    try {
      const result = await sweepOverdue();
      if (result.notified > 0) {
        console.log(`[kin] reminded about ${result.notified} overdue dose(s), ${result.sent} push(es) sent`);
      }
    } catch (err) {
      console.error('[kin] reminder sweep failed:', err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalSeconds * 1000);
  // Do not hold the process open purely for the sweep.
  timer.unref?.();
  tick();

  console.log(`[kin] reminder sweep every ${intervalSeconds}s, grace ${config.reminderGraceMinutes}min`);
  return () => clearInterval(timer);
}
