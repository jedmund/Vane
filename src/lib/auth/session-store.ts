import { createHmac, timingSafeEqual } from 'crypto';
import { getSessionSecret } from './oidc';

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
  expiresAt: number;
}

export interface SessionStore {
  create(userId: string): Promise<{ token: string; expiresAt: number }>;
  get(token: string): Promise<SessionRecord | null>;
  delete(token: string): Promise<void>;
  touch(token: string): Promise<({ token: string } & SessionRecord) | null>;
}

interface TokenPayload {
  userId: string;
  iat: number;
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyExpiresAt(iat: number): number | null {
  const expiresAt = iat + ttlSeconds() * 1000;
  if (expiresAt <= Date.now()) return null;
  return expiresAt;
}

function verifyToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as TokenPayload;
    if (typeof parsed?.userId !== 'string' || typeof parsed?.iat !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

class StatelessSessionStore implements SessionStore {
  async create(userId: string): Promise<{ token: string; expiresAt: number }> {
    const payload: TokenPayload = { userId, iat: Date.now() };
    const expiresAt = payload.iat + ttlSeconds() * 1000;
    return { token: sign(payload), expiresAt };
  }

  async get(token: string): Promise<SessionRecord | null> {
    const payload = verifyToken(token);
    if (!payload) return null;
    const expiresAt = verifyExpiresAt(payload.iat);
    if (!expiresAt) return null;
    return { userId: payload.userId, expiresAt };
  }

  async delete(_token: string): Promise<void> {
  }

  async touch(token: string): Promise<({ token: string } & SessionRecord) | null> {
    const payload = verifyToken(token);
    if (!payload) return null;
    const expiresAt = verifyExpiresAt(payload.iat);
    if (!expiresAt) return null;
    const rotated = sign({ userId: payload.userId, iat: Date.now() });
    return { token: rotated, userId: payload.userId, expiresAt };
  }
}

let instance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!instance) instance = new StatelessSessionStore();
  return instance;
}

export function getSessionTtlSeconds(): number {
  return ttlSeconds();
}
