import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCookies } from 'cookie';
import { buildAuthorizationStart } from '@/lib/auth/oidc';
import {
  SESSION_COOKIE,
  buildStateCookieHeader,
  encodeStateCookie,
  sanitizeReturnTo,
} from '@/lib/auth/cookies';
import { getSessionStore } from '@/lib/auth/session-store';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  // Already-logged-in short-circuit: skip the PocketID round trip if the
  // session cookie is valid. This matches the locked decision in the plan.
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const existingToken = cookies[SESSION_COOKIE];
  if (existingToken) {
    const rec = await getSessionStore().get(existingToken);
    if (rec) {
      return NextResponse.redirect(new URL(returnTo, url.origin), {
        status: 302,
      });
    }
  }

  try {
    const start = await buildAuthorizationStart();
    const cookieValue = encodeStateCookie({
      state: start.state,
      nonce: start.nonce,
      codeVerifier: start.codeVerifier,
      returnTo,
    });
    const res = NextResponse.redirect(start.url, { status: 302 });
    res.headers.append('Set-Cookie', buildStateCookieHeader(cookieValue));
    return res;
  } catch (err) {
    console.error('OIDC login init failed:', err);
    return NextResponse.json(
      { error: 'oidc_unavailable' },
      { status: 503 },
    );
  }
}
