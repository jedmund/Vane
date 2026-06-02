'use client';

import { useEffect, useState } from 'react';

export interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
  // Surfaced from /api/me so the client can hide admin-only affordances.
  // The server still re-checks isAdmin on every mutation; this flag is for
  // UX only and is not a trust boundary.
  isAdmin: boolean;
}

// Module-level Promise cache. Locked decision: no SWR / react-query. Multiple
// components mounting on the same page (Sidebar, header, future surfaces)
// share a single in-flight network call. The cache is per-page-load: a hard
// navigation resets the module and a fresh fetch fires.
//
// We cache the Promise rather than the resolved value so the second caller
// that races the first one awaits the same response instead of starting a
// duplicate request.
let cached: Promise<CurrentUser | null> | null = null;

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  // The proxy 401s API calls without a session. We treat 401 as "no user"
  // (returns null) rather than triggering a redirect; redirecting from a
  // data fetch would race the proxy's own redirect on the next navigation
  // and produce confusing flicker. Pages that need to force login should
  // do so at the route layer.
  const res = await fetch('/api/me', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me returned ${res.status}`);
  return (await res.json()) as CurrentUser;
}

function getCachedCurrentUser(): Promise<CurrentUser | null> {
  if (!cached) cached = fetchCurrentUser();
  return cached;
}

export function useCurrentUser(): {
  user: CurrentUser | null;
  loading: boolean;
  error: Error | null;
} {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCachedCurrentUser()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading, error };
}

// Test / dev hook: clears the cache so the next consumer refetches.
// Not exported to consumers as part of normal usage.
export function __resetCurrentUserCache() {
  cached = null;
}
