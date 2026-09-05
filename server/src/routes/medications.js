import { Router } from 'express';
import { z } from 'zod';

import { Medication, Occurrence } from '../models/index.js';
import { asyncRoute, notFound } from '../middleware/errors.js';
import { requireAuth, requireMembership } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ensureOccurrences } from '../services/schedule.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 08:00');

const medicationInput = z.object({
  name: z.string().trim().min(1, 'What is it called?').max(120),
  dose: z.string().trim().min(1, 'How much is one dose?').max(120),
  instructions: z.string().trim().max(500).default(''),
  timesOfDay: z.array(timeOfDay).min(1, 'Add at least one time').max(12),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startDate: localDate,
  endDate: localDate.nullable().default(null),
});

router.get(
  '/',
  requireMembership('viewer'),
  asyncRoute(async (req, res) => {
    const medications = await Medication.find({ circle: req.circle._id }).sort({ active: -1, name: 1 });
    res.json({ medications });
  })
);

router.post(
  '/',
  requireMembership('caregiver'),
  validate(medicationInput),
  asyncRoute(async (req, res) => {
    const medication = await Medication.create({
      ...req.body,
      timesOfDay: [...req.body.timesOfDay].sort(),
      circle: req.circle._id,
      createdBy: req.userId,
    });

    // Materialise straight away so the new medication appears on today's list
    // rather than after some later background pass.
    const generated = await ensureOccurrences(req.circle);

    req.app.get('io')?.to(`circle:${req.circle._id}`).emit('medication:created', { medication });
    res.status(201).json({ medication, generated });
  })
);

router.patch(
  '/:medicationId',
  requireMembership('caregiver'),
  validate(medicationInput.partial()),
  asyncRoute(async (req, res) => {
    const medication = await Medication.findOne({ _id: req.params.medicationId, circle: req.circle._id });
    if (!medication) throw notFound('Medication not found');

    Object.assign(medication, req.body);
    if (req.body.timesOfDay) medication.timesOfDay = [...req.body.timesOfDay].sort();
    await medication.save();

    // A changed schedule invalidates doses nobody has acted on yet, but not the
    // ones already given or skipped. Deleting a recorded dose because the
    // prescription later changed would rewrite history — the tablet was still
    // taken at that time.
    await Occurrence.deleteMany({
      medication: medication._id,
      status: 'due',
      dueAt: { $gt: new Date() },
    });
    const generated = await ensureOccurrences(req.circle);

    req.app.get('io')?.to(`circle:${req.circle._id}`).emit('medication:updated', { medication });
    res.json({ medication, generated });
  })
);

/**
 * Stopping a medication rather than deleting it.
 *
 * The rows stay so the history of what was given remains readable; only future
 * unresolved doses are withdrawn.
 */
router.delete(
  '/:medicationId',
  requireMembership('caregiver'),
  asyncRoute(async (req, res) => {
    const medication = await Medication.findOne({ _id: req.params.medicationId, circle: req.circle._id });
    if (!medication) throw notFound('Medication not found');

    medication.active = false;
    await medication.save();

    await Occurrence.deleteMany({
      medication: medication._id,
      status: 'due',
      dueAt: { $gt: new Date() },
    });

    req.app.get('io')?.to(`circle:${req.circle._id}`).emit('medication:stopped', { medicationId: medication._id });
    res.json({ medication });
  })
);

export default router;
