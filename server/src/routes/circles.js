import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';

import { Circle, Membership, User } from '../models/index.js';
import { asyncRoute, badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { requireAuth, requireMembership } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../models/index.js';

const router = Router();
router.use(requireAuth);

const timezone = z
  .string()
  .refine((tz) => DateTime.local().setZone(tz).isValid, 'Not a recognised timezone');

const createCircle = z.object({
  name: z.string().trim().min(1, 'Give this circle a name').max(80),
  timezone: timezone.default('Asia/Kolkata'),
});

/** The circles the caller belongs to, with their role in each. */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const memberships = await Membership.find({ user: req.userId }).populate('circle').sort({ createdAt: 1 });

    res.json({
      circles: memberships
        .filter((m) => m.circle)
        .map((m) => ({ ...m.circle.toJSON(), role: m.role })),
    });
  })
);

router.post(
  '/',
  validate(createCircle),
  asyncRoute(async (req, res) => {
    const circle = await Circle.create({ ...req.body, createdBy: req.userId });
    // Whoever creates the circle administers it; without this they would be
    // locked out of the thing they just made.
    await Membership.create({ circle: circle._id, user: req.userId, role: 'admin' });

    res.status(201).json({ circle: { ...circle.toJSON(), role: 'admin' } });
  })
);

router.get(
  '/:circleId',
  requireMembership('viewer'),
  asyncRoute(async (req, res) => {
    res.json({ circle: { ...req.circle.toJSON(), role: req.role } });
  })
);

router.get(
  '/:circleId/members',
  requireMembership('viewer'),
  asyncRoute(async (req, res) => {
    const members = await Membership.find({ circle: req.circle._id })
      .populate('user', 'name email')
      .sort({ createdAt: 1 });

    res.json({
      members: members
        .filter((m) => m.user)
        .map((m) => ({ id: m._id, role: m.role, user: m.user })),
    });
  })
);

const invite = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(ROLES).default('caregiver'),
});

/**
 * Adds an existing account to the circle.
 *
 * There is no email delivery here, so an invitation can only reach someone who
 * has already signed up. Saying so plainly beats inventing a pending-invite
 * flow that never actually notifies anybody.
 */
router.post(
  '/:circleId/members',
  requireMembership('admin'),
  validate(invite),
  asyncRoute(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      throw notFound('No account with that email yet — ask them to sign up first, then invite them');
    }

    if (await Membership.exists({ circle: req.circle._id, user: user._id })) {
      throw conflict('They are already in this circle');
    }

    const membership = await Membership.create({
      circle: req.circle._id,
      user: user._id,
      role: req.body.role,
    });

    res.status(201).json({
      member: { id: membership._id, role: membership.role, user: { id: user._id, name: user.name, email: user.email } },
    });
  })
);

const changeRole = z.object({ role: z.enum(ROLES) });

router.patch(
  '/:circleId/members/:memberId',
  requireMembership('admin'),
  validate(changeRole),
  asyncRoute(async (req, res) => {
    const membership = await Membership.findOne({ _id: req.params.memberId, circle: req.circle._id });
    if (!membership) throw notFound('That person is not in this circle');

    // A circle with no administrator cannot be repaired from inside the app, so
    // the last one is not allowed to demote or remove themselves.
    if (membership.role === 'admin' && req.body.role !== 'admin') {
      const admins = await Membership.countDocuments({ circle: req.circle._id, role: 'admin' });
      if (admins <= 1) throw badRequest('Make someone else an admin first — a circle needs at least one');
    }

    membership.role = req.body.role;
    await membership.save();
    res.json({ member: { id: membership._id, role: membership.role } });
  })
);

router.delete(
  '/:circleId/members/:memberId',
  requireMembership('admin'),
  asyncRoute(async (req, res) => {
    const membership = await Membership.findOne({ _id: req.params.memberId, circle: req.circle._id });
    if (!membership) throw notFound('That person is not in this circle');

    if (membership.role === 'admin') {
      const admins = await Membership.countDocuments({ circle: req.circle._id, role: 'admin' });
      if (admins <= 1) throw badRequest('Make someone else an admin first — a circle needs at least one');
    }

    await membership.deleteOne();
    res.status(204).end();
  })
);

export default router;
