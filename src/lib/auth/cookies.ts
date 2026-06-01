import { createHmac, timingSafeEqual } from 'crypto';
import { serialize as serializeCookie } from 'cookie';
import { getSessionSecret } from './oidc';

export const SESSION_COOKIE = 'vane_session';
export const STATE_COOKIE = 'vane_oidc_state';

// 5 minute TTL on the state cookie: covers the user typing their PocketID
// password without keeping a dangling PKCE verifier around.
export const STATE_COOKIE_TTL_SECONDS = 5 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// HMAC-SHA256 over the JSON payload using SESSION_SECRET. We sign rather than
// encrypt because the state cookie contents are not secret (just unforgeable):
// an attacker who can read your cookies can also read your URL bar mid-flow.
function sign(payload: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
}

export interface StateCookiePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export function encodeStateCookie(payload: StateCookiePayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function decodeStateCookie(
  raw: string | undefined,
): StateCookiePayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare to avoid timing oracle on the HMAC.
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      typeof parsed?.state !== 'string' ||
      typeof parsed?.nonce !== 'string' ||
      typeof parsed?.codeVerifier !== 'string' ||
      typeof parsed?.returnTo !== 'string'
    ) {
      return null;
    }
    return parsed as StateCookiePayload;
  } catch {
    return null;
  }
}

export function buildStateCookieHeader(value: string): string {
  return serializeCookie(STATE_COOKIE, value, {
    httpOnly: true,
    secure: isProduction(),
    // Lax so the cookie survives the top-level redirect back from PocketID.
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_COOKIE_TTL_SECONDS,
  });
}

export function clearStateCookieHeader(): string {
  return serializeCookie(STATE_COOKIE, '', {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function buildSessionCookieHeader(
  token: string,
  ttlSeconds: number,
): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds,
  });
}

export function clearSessionCookieHeader(): string {
  return serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

// returnTo is only safe if it points back into this app. Reject anything that
// could escape to a different origin or protocol. Locked decision: same-origin
// paths only, reject //, http://, https://.
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (raw.length === 0) return '/';
  if (raw.startsWith('//')) return '/';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return '/';
  if (!raw.startsWith('/')) return '/';
  return raw;
}
