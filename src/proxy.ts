import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCookies } from 'cookie';
import { SESSION_COOKIE } from '@/lib/auth/cookies';
import { getSessionStore } from '@/lib/auth/session-store';

// Next.js 16 renamed `middleware.ts` to `proxy.ts` and made the new file
// default to the Node.js runtime. That matters here: the session store is
// an in-memory Map + setInterval and relies on Node's crypto. Using
// `middleware.ts` keeps the Edge default and crashes at runtime when the
// store is touched. If we ever target Edge, the store will need to move
// out of process (Redis adapter is the planned path).

const ALLOWLIST_EXACT = new Set<string>([
  '/login',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/logout',
]);

const ALLOWLIST_PREFIXES = ['/_next/'];

function isAllowlisted(pathname: string): boolean {
  if (ALLOWLIST_EXACT.has(pathname)) return true;
  for (const prefix of ALLOWLIST_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isAllowlisted(pathname)) {
    return NextResponse.next();
  }

  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];

  let userId: string | null = null;
  if (token) {
    // touch() slides the expiry forward on every request; locked decision is
    // "refreshed on activity".
    const rec = await getSessionStore().touch(token);
    if (rec) userId = rec.userId;
  }

  if (!userId) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: 'unauthenticated' },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('returnTo', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  // Forward the resolved user id to downstream handlers via a header. Locked
  // decision: handlers trust this header (it cannot originate from the
  // outside because Next strips client-supplied headers it overrides here).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-vane-user-id', userId);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Skip proxy on Next internals and static metadata. The negative lookahead
  // mirrors the allowlist above so this is the single source of truth for
  // "what proxy sees".
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
