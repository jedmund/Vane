import { randomBytes } from 'crypto';

// Default to 7 days. Tunable via SESSION_TTL_SECONDS so the homelab deploy can
// shorten or extend it without a code change.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

function ttlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return n;
}

export interface SessionRecord {
  userId: string;
  expiresAt: number; // epoch ms
}

export interface SessionStore {
  create(userId: string): Promise<{ token: string; expiresAt: number }>;
  get(token: string): Promise<SessionRecord | null>;
  delete(token: string): Promise<void>;
  // Slides the expiry forward by the full TTL. No-op if the token is missing
  // or already expired.
  touch(token: string): Promise<SessionRecord | null>;
}

class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<string, SessionRecord>();
  private sweepHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 60s sweep. Using setInterval (not setTimeout chaining) so a single timer
    // is enough; .unref() so it does not keep the process alive on its own.
    this.sweepHandle = setInterval(() => this.sweep(), 60_000);
    if (typeof this.sweepHandle.unref === 'function') {
      this.sweepHandle.unref();
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [token, rec] of this.store) {
      if (rec.expiresAt <= now) this.store.delete(token);
    }
  }

  async create(
    userId: string,
  ): Promise<{ token: string; expiresAt: number }> {
    // 32 bytes of entropy is the locked decision. base64url is URL/cookie safe
    // and ~43 chars long.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + ttlSeconds() * 1000;
    this.store.set(token, { userId, expiresAt });
    return { token, expiresAt };
  }

  async get(token: string): Promise<SessionRecord | null> {
    const rec = this.store.get(token);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.store.delete(token);
      return null;
    }
    return rec;
  }

  async delete(token: string): Promise<void> {
    this.store.delete(token);
  }

  async touch(token: string): Promise<SessionRecord | null> {
    const rec = this.store.get(token);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.store.delete(token);
      return null;
    }
    rec.expiresAt = Date.now() + ttlSeconds() * 1000;
    return rec;
  }
}

// Singleton. Module-level so Next.js route handlers, server components, and
// middleware all see the same Map across requests in the same process.
let instance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!instance) instance = new InMemorySessionStore();
  return instance;
}

export function getSessionTtlSeconds(): number {
  return ttlSeconds();
}
