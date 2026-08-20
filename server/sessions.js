/**
 * Sessions, without a session store.
 *
 * A session is a signed statement — "this is Discord user 123, until Friday" —
 * so the server keeps no table and a restart logs nobody out. HMAC-SHA256 over
 * a secret, which is the whole security of it: change SESSION_SECRET and every
 * outstanding session dies.
 *
 * Two transports, one verifier. The website sends the token in a cookie; the
 * Discord Activity sends it in an Authorization header, because a page framed
 * inside Discord should not be relying on cookie behaviour it does not
 * control.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = 'parsedle_session';
const STATE_COOKIE = 'parsedle_oauth_state';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time, and false rather than throwing on a length mismatch. */
function signatureMatches(expected, actual) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{secret: string, ttlMs?: number, now?: () => number}} opts
 */
export function createSessions({ secret, ttlMs = SESSION_TTL_MS, now = Date.now }) {
  if (!secret) throw new Error('createSessions: a SESSION_SECRET is required');

  /** @param {{id: string, username: string, avatar?: ?string}} user */
  function issue(user) {
    const claims = { id: user.id, username: user.username, avatar: user.avatar ?? null, exp: now() + ttlMs };
    const payload = b64(JSON.stringify(claims));
    return `${payload}.${sign(payload, secret)}`;
  }

  /** @returns {?{id: string, username: string, avatar: ?string, exp: number}} */
  function verify(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, signature] = token.split('.', 2);
    if (!payload || !signature) return null;
    if (!signatureMatches(sign(payload, secret), signature)) return null;

    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!claims?.id || typeof claims.exp !== 'number' || claims.exp <= now()) return null;
      return claims;
    } catch {
      return null;
    }
  }

  /** Cookie first, then bearer — the Activity has no cookie to send. */
  function fromRequest(req) {
    const cookies = parseCookies(req.headers?.cookie);
    const bearer = (req.headers?.authorization ?? '').replace(/^Bearer /i, '');
    return verify(cookies[COOKIE_NAME]) ?? verify(bearer);
  }

  return { issue, verify, fromRequest, ttlMs };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * `Secure` is dropped for plain-HTTP localhost only — a browser refuses a
 * Secure cookie there, and dev would be unusable.
 */
export function cookieHeader(name, value, { maxAgeMs = SESSION_TTL_MS, secure = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(name, { secure = true } = {}) {
  return cookieHeader(name, '', { maxAgeMs: 0, secure });
}

/** One-time CSRF value for the OAuth round trip. */
export function newState() {
  return randomBytes(16).toString('base64url');
}

export const STATE_COOKIE_NAME = STATE_COOKIE;
