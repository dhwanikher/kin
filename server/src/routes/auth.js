import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { User } from '../models/index.js';
import { asyncRoute, conflict, unauthorized } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../services/tokens.js';

const router = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

const registration = credentials.extend({
  name: z.string().trim().min(1, 'Tell us your name').max(80),
});

/** Issues both tokens and sets the refresh cookie. */
function grantSession(res, user) {
  res.cookie(REFRESH_COOKIE, signRefreshToken(user), refreshCookieOptions());
  return { user: user.toJSON(), accessToken: signAccessToken(user) };
}

router.post(
  '/register',
  validate(registration),
  asyncRoute(async (req, res) => {
    const { email, password, name } = req.body;

    if (await User.exists({ email })) {
      throw conflict('An account with that email already exists');
    }

    const user = await User.create({
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
    });

    res.status(201).json(grantSession(res, user));
  })
);

router.post(
  '/login',
  validate(credentials),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    // The same message and roughly the same work whether the address is unknown
    // or the password is wrong, so the response cannot be used to enumerate who
    // has an account.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw unauthorized('Email or password is incorrect');

    res.json(grantSession(res, user));
  })
);

/**
 * Trades the refresh cookie for a fresh access token.
 *
 * The user is re-read rather than trusted from the token, so an account that
 * has been deleted stops working immediately instead of at token expiry.
 */
router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('Please sign in again');

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw unauthorized('Please sign in again');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('Please sign in again');

    res.json(grantSession(res, user));
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  res.status(204).end();
});

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw unauthorized();
    res.json({ user: user.toJSON() });
  })
);

export default router;
