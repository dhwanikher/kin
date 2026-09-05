import jwt from 'jsonwebtoken';
import { config, isProduction } from '../config/env.js';

// Two tokens rather than one. The access token is short lived and travels in
// the Authorization header; the refresh token is long lived and lives in an
// httpOnly cookie the page's JavaScript cannot read. Putting a long lived token
// in localStorage is the usual shortcut and it means any script that runs on
// the page — an npm dependency, an injected tag — can walk off with a session
// that lasts a month.

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), name: user.name }, config.accessSecret, {
    expiresIn: config.accessTtl,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: String(user._id) }, config.refreshSecret, {
    expiresIn: config.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.refreshSecret);
}

export const REFRESH_COOKIE = 'kin_refresh';

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}
