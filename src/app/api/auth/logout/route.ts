import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCookies } from 'cookie';
import {
  SESSION_COOKIE,
  clearSessionCookieHeader,
  getAppOrigin,
} from '@/lib/auth/cookies';
import { getSessionStore } from '@/lib/auth/session-store';
import { tryBuildEndSessionUrl } from '@/lib/auth/oidc';

// POST so logout is not triggered by random GETs (image prefetch, etc.). The
// login page form (Phase 3) POSTs here. Browsers send the cookie on POST same
// as GET.
export async function POST(req: NextRequest) {
  const appOrigin = getAppOrigin();
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    await getSessionStore().delete(token);
  }

  // Best-effort end_session ping. We don't follow the redirect ourselves
  // because the user's browser still has the IdP session cookie; the locked
  // decision is that logout 302s the user to /login, not to PocketID.
  // Compute the URL for logging / debugging only.
  const endSession = await tryBuildEndSessionUrl(
    undefined,
    new URL('/login', appOrigin).toString(),
  );
  if (endSession) {
    // Fire and forget. We swallow the body; the IdP receiving the call is
    // enough for it to clear its server-side record where it implements that.
    fetch(endSession).catch(() => {});
  }

  const res = NextResponse.redirect(new URL('/login', appOrigin), {
    status: 302,
  });
  res.headers.append('Set-Cookie', clearSessionCookieHeader());
  return res;
}
