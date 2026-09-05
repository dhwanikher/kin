// The access token lives here, in a module variable, and nowhere else.
//
// Not localStorage, not sessionStorage. Those survive a page load, which sounds
// convenient until you remember that anything running on the page can read
// them — a compromised dependency, an injected script. Keeping the token in
// memory means a refresh loses it, and the httpOnly refresh cookie is what
// silently gets a new one. The cookie itself is unreadable from JavaScript, so
// that is the piece worth having survive.

let accessToken = null;
let onSignedOut = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSignedOutHandler(handler) {
  onSignedOut = handler;
}

export class ApiError extends Error {
  constructor(status, message, details, body) {
    super(message);
    this.status = status;
    this.details = details;
    this.body = body;
  }
}

async function parse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

/**
 * Asks for a new access token using the refresh cookie.
 *
 * Deduplicated: if three requests expire at once they share one refresh rather
 * than firing three, which would race and leave two of them holding a token
 * that was already replaced.
 */
let refreshInFlight = null;

async function refresh() {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return null;
      const body = await parse(response);
      accessToken = body?.accessToken ?? null;
      return body;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function send(method, path, body, { retry = true } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // One transparent retry after a refresh. Any more and a genuinely revoked
  // session would spin instead of signing the user out.
  if (response.status === 401 && retry) {
    const refreshed = await refresh();
    if (refreshed?.accessToken) {
      return send(method, path, body, { retry: false });
    }
    accessToken = null;
    onSignedOut();
  }

  const parsed = await parse(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed?.error ?? `Request failed (${response.status})`,
      parsed?.details,
      parsed
    );
  }
  return parsed;
}

export const api = {
  get: (path) => send('GET', path),
  post: (path, body) => send('POST', path, body),
  patch: (path, body) => send('PATCH', path, body),
  // DELETE carries a body here so a device can name the subscription it is
  // removing; the endpoint URL is the only identifier the browser has.
  del: (path, body) => send('DELETE', path, body),
  refresh,
};
