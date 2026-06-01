import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCookies } from 'cookie';
import { SESSION_COOKIE } from '@/lib/auth/cookies';
import { getSessionStore } from '@/lib/auth/session-store';
import { getUserById } from '@/lib/auth/users';

// Locked decision: response shape is {id, email, name}. We deliberately do
// not include the OIDC sub here; downstream code that needs cross-IdP linkage
// looks it up from the users table.
export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return NextResponse.json(
      { error: 'unauthenticated' },
      { status: 401 },
    );
  }

  const rec = await getSessionStore().get(token);
  if (!rec) {
    return NextResponse.json(
      { error: 'unauthenticated' },
      { status: 401 },
    );
  }

  const user = await getUserById(rec.userId);
  if (!user) {
    // Session points to a user row that has been deleted. Treat as logged
    // out and let the next round-trip rebuild a session.
    return NextResponse.json(
      { error: 'unauthenticated' },
      { status: 401 },
    );
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}
