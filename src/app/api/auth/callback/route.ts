import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCookies } from 'cookie';
import { exchangeCode, fetchUserinfo } from '@/lib/auth/oidc';
import {
  STATE_COOKIE,
  buildSessionCookieHeader,
  clearStateCookieHeader,
  decodeStateCookie,
  getAppOrigin,
  sanitizeReturnTo,
} from '@/lib/auth/cookies';
import {
  getSessionStore,
  getSessionTtlSeconds,
} from '@/lib/auth/session-store';
import { upsertUserFromOIDC } from '@/lib/auth/users';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const state = decodeStateCookie(cookies[STATE_COOKIE]);

  if (!state) {
    return NextResponse.json(
      { error: 'invalid_state' },
      { status: 400 },
    );
  }

  // Provider-side errors come back as ?error=... rather than ?code=...
  const providerError = url.searchParams.get('error');
  if (providerError) {
    const res = NextResponse.json(
      { error: 'oidc_error', detail: providerError },
      { status: 400 },
    );
    res.headers.append('Set-Cookie', clearStateCookieHeader());
    return res;
  }

  let sub: string;
  let accessToken: string;
  let idTokenClaims: Record<string, unknown> | undefined;
  try {
    const tokens = await exchangeCode(url, {
      state: state.state,
      nonce: state.nonce,
      codeVerifier: state.codeVerifier,
    });
    sub = tokens.sub;
    accessToken = tokens.accessToken;
    idTokenClaims = tokens.idTokenClaims;
  } catch (err) {
    console.error('OIDC code exchange failed:', err);
    const res = NextResponse.json(
      { error: 'oidc_exchange_failed' },
      { status: 400 },
    );
    res.headers.append('Set-Cookie', clearStateCookieHeader());
    return res;
  }

  // Prefer userinfo (more recent / canonical), fall back to id_token claims.
  // PocketID returns name + email on both; the fallback covers a degraded IdP
  // or a network blip on the userinfo call.
  let email: string | null = null;
  let name: string | null = null;
  try {
    const info = await fetchUserinfo(accessToken, sub);
    email = info.email ?? null;
    name =
      info.name ??
      info.preferred_username ??
      null;
  } catch (err) {
    console.warn('OIDC userinfo fetch failed, falling back to id_token:', err);
    if (idTokenClaims) {
      const claims = idTokenClaims as Record<string, unknown>;
      if (typeof claims.email === 'string') email = claims.email;
      if (typeof claims.name === 'string') name = claims.name;
      else if (typeof claims.preferred_username === 'string')
        name = claims.preferred_username;
    }
  }

  // Derive a display name from email local-part if PocketID returned nothing
  // useful. Never null in practice because users always have an email, but the
  // type is honest.
  if (!name && email) {
    const at = email.indexOf('@');
    name = at > 0 ? email.slice(0, at) : email;
  }

  const user = await upsertUserFromOIDC(sub, email, name);

  const session = await getSessionStore().create(user.id);
  const returnTo = sanitizeReturnTo(state.returnTo);
  const res = NextResponse.redirect(new URL(returnTo, getAppOrigin()), {
    status: 302,
  });
  res.headers.append('Set-Cookie', clearStateCookieHeader());
  res.headers.append(
    'Set-Cookie',
    buildSessionCookieHeader(session.token, getSessionTtlSeconds()),
  );
  return res;
}
