import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';

import { Occurrence } from '../models/index.js';
import { asyncRoute, conflict, forbidden, notFound } from '../middleware/errors.js';
import { requireAuth, requireMembership } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ensureOccurrences, isOverdue } from '../services/schedule.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const dayQuery = z.object({
  from: localDate.optional(),
  to: localDate.optional(),
});

/** Adds the fields the UI needs but the database should not store. */
const present = (occurrence, now) => ({
  ...occurrence.toJSON(),
  overdue: isOverdue(occurrence, { now }),
});

/**
 * The doses for a range of local days, oldest first.
 *
 * Generation runs on read. It is idempotent and cheap, and it means a circle
 * that has been quiet for a fortnight still shows a full schedule the moment
 * somebody opens it — no cron job to forget to deploy, nothing to fall behind.
 */
router.get(
  '/',
  requireMembership('viewer'),
  validate(dayQuery, 'query'),
  asyncRoute(async (req, res) => {
    const today = DateTime.now().setZone(req.circle.timezone).toFormat('yyyy-MM-dd');
    const from = req.query.from ?? today;
    const to = req.query.to ?? from;

    await ensureOccurrences(req.circle);

    const occurrences = await Occurrence.find({
      circle: req.circle._id,
      localDate: { $gte: from, $lte: to },
    })
      .populate('medication', 'name dose instructions active')
      .populate('resolvedBy', 'name')
      .sort({ dueAt: 1 });

    const now = new Date();
    res.json({
      from,
      to,
      timezone: req.circle.timezone,
      occurrences: occurrences.map((o) => present(o, now)),
    });
  })
);

const resolution = z.object({
  status: z.enum(['given', 'skipped', 'missed']),
  note: z.string().trim().max(500).default(''),
});

/**
 * Record what happened to a dose.
 *
 * This is the whole point of the application, and it is a race by nature: two
 * people in the same house, both holding a phone, both about to give the same
 * tablet. The update is therefore conditional on the dose still being unresolved
 * — a single atomic findOneAndUpdate, not a read followed by a write. Whoever
 * loses the race is told who got there first and what they recorded, which is
 * the answer they actually need. Reading and then writing would let both
 * requests pass the check and both write, and the second one would silently
 * overwrite the first.
 */
router.post(
  '/:occurrenceId/resolve',
  requireMembership('caregiver'),
  validate(resolution),
  asyncRoute(async (req, res) => {
    const { status, note } = req.body;

    const updated = await Occurrence.findOneAndUpdate(
      { _id: req.params.occurrenceId, circle: req.circle._id, status: 'due' },
      { status, note, resolvedBy: req.userId, resolvedAt: new Date() },
      { new: true }
    )
      .populate('medication', 'name dose instructions active')
      .populate('resolvedBy', 'name');

    if (!updated) {
      const existing = await Occurrence.findOne({
        _id: req.params.occurrenceId,
        circle: req.circle._id,
      })
        .populate('medication', 'name dose')
        .populate('resolvedBy', 'name');

      if (!existing) throw notFound('That dose is not on this schedule');

      throw conflict(
        `${existing.resolvedBy?.name ?? 'Someone'} already marked this as ${existing.status}`,
        { occurrence: present(existing, new Date()) }
      );
    }

    // Everyone else watching this circle finds out before they can tap. This is
    // the half of double-dose prevention that stops the second person even
    // trying, rather than only telling them off afterwards.
    req.app.get('io')?.to(`circle:${req.circle._id}`).emit('occurrence:resolved', {
      occurrence: present(updated, new Date()),
    });

    res.json({ occurrence: present(updated, new Date()) });
  })
);

/**
 * Put a dose back to unresolved.
 *
 * Restricted to whoever recorded it, or an admin. Anyone being able to undo
 * anyone else's entry would make the log untrustworthy, and an untrustworthy
 * log is worse than no log because people would still rely on it.
 */
router.post(
  '/:occurrenceId/undo',
  requireMembership('caregiver'),
  asyncRoute(async (req, res) => {
    const occurrence = await Occurrence.findOne({
      _id: req.params.occurrenceId,
      circle: req.circle._id,
    });
    if (!occurrence) throw notFound('That dose is not on this schedule');
    if (occurrence.status === 'due') return res.json({ occurrence: present(occurrence, new Date()) });

    const isOwner = String(occurrence.resolvedBy) === String(req.userId);
    if (!isOwner && req.role !== 'admin') {
      throw forbidden('Only the person who recorded this, or an admin, can undo it');
    }

    occurrence.status = 'due';
    occurrence.resolvedBy = null;
    occurrence.resolvedAt = null;
    occurrence.note = '';
    await occurrence.save();

    const populated = await occurrence.populate([
      { path: 'medication', select: 'name dose instructions active' },
      { path: 'resolvedBy', select: 'name' },
    ]);

    req.app.get('io')?.to(`circle:${req.circle._id}`).emit('occurrence:resolved', {
      occurrence: present(populated, new Date()),
    });

    res.json({ occurrence: present(populated, new Date()) });
  })
);

export default router;
