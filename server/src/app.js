import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { config } from './config/env.js';
import { errorHandler, notFound } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import circleRoutes from './routes/circles.js';
import medicationRoutes from './routes/medications.js';
import occurrenceRoutes from './routes/occurrences.js';

/**
 * Builds the app without binding a port, so tests can drive it in-process.
 */
export function createApp() {
  const app = express();

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // credentials:true because the refresh token travels as a cookie, which
  // means the origin has to be named explicitly — a wildcard is not allowed
  // alongside credentials, and would be wrong here anyway.
  app.use(cors({ origin: config.clientOrigin, credentials: true }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/circles', circleRoutes);
  app.use('/api/circles/:circleId/medications', medicationRoutes);
  app.use('/api/circles/:circleId/occurrences', occurrenceRoutes);

  app.use((_req, _res, next) => next(notFound('No such endpoint')));
  app.use(errorHandler);

  return app;
}
