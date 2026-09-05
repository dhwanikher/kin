import { Membership } from '../models/index.js';
import { verifyAccessToken } from '../services/tokens.js';
import { forbidden, notFound, unauthorized } from './errors.js';

/** Populates req.userId from a bearer token, or rejects. */
export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  try {
    req.userId = verifyAccessToken(token).sub;
    return next();
  } catch {
    return next(unauthorized('Your session has expired'));
  }
}

// Who may do what. Roles are ordered, so a check is a comparison rather than a
// list membership test scattered through the routes.
const RANK = { viewer: 0, caregiver: 1, admin: 2 };

/**
 * Confirms the caller belongs to :circleId with at least `minimum` rank, and
 * puts the circle and their role on the request.
 *
 * A circle the caller cannot see reports 404 rather than 403. Answering 403
 * would confirm the circle exists, which leaks the existence of other families'
 * data to anyone willing to guess an id.
 */
export const requireMembership = (minimum = 'viewer') =>
  async function membershipGuard(req, _res, next) {
    try {
      const membership = await Membership.findOne({
        circle: req.params.circleId,
        user: req.userId,
      }).populate('circle');

      if (!membership || !membership.circle) return next(notFound('Circle not found'));
      if (RANK[membership.role] < RANK[minimum]) {
        return next(forbidden(`This needs ${minimum} access; you are a ${membership.role}`));
      }

      req.circle = membership.circle;
      req.role = membership.role;
      return next();
    } catch (err) {
      return next(err);
    }
  };
