import { badRequest } from './errors.js';

/**
 * Validates req[source] against a zod schema and replaces it with the parsed
 * value, so handlers work with data that has already been checked and coerced
 * rather than whatever arrived on the wire.
 *
 * Express 5 defines req.query as a getter with no setter, so a plain assignment
 * throws "Cannot set property query of #<IncomingMessage>". Redefining the
 * property is the supported way to hand a handler the parsed value while
 * keeping the familiar req.query at the call site.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = {};
    for (const issue of result.error.issues) {
      details[issue.path.join('.') || '_'] = issue.message;
    }
    return next(badRequest('Validation failed', details));
  }

  if (source === 'query') {
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } else {
    req[source] = result.data;
  }

  return next();
};
