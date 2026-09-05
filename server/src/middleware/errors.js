// A small error type so route handlers can fail with a status and a message
// without each one hand-rolling a response.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Not signed in') => new HttpError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m, d) => new HttpError(409, m, d);

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Mongoose validation and duplicate keys are user errors, not server faults,
  // and reporting them as 500s makes a form look broken when it is merely wrong.
  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])),
    });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'That already exists', details: err.keyValue });
  }

  console.error('[kin] unhandled error:', err);
  return res.status(500).json({ error: 'Something went wrong' });
}
