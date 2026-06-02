import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import db from '@/lib/db';
import { chats, users } from '@/lib/db/schema';

const LEGACY_USER_ID = 'legacy';

export interface AppUser {
  id: string;
  sub: string | null;
  email: string | null;
  name: string | null;
  createdAt: string;
  isAdmin: boolean;
}

// Parsed once per upsert (not module-load) so a runtime-set env (e.g. a
// docker-compose reload that swaps the value without a process restart on
// our side) is picked up on the next login. Case-insensitive compare on
// trimmed entries; empty / unset means "no allowlist".
function parseAdminEmailAllowlist(): string[] {
  const raw = process.env.OIDC_ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

// "A real admin is set up." The legacy synthetic user is admin by design
// (zero-config upgrade path for single-user homelabs), but it does not
// satisfy the bootstrap rule that the first real OIDC user becomes admin.
// Without the id != 'legacy' exclusion the first real user would never be
// promoted, because legacy already trips a naive 'any admin exists' check.
async function realAdminExists(): Promise<boolean> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.isAdmin, true), ne(users.id, LEGACY_USER_ID)));
  return (rows[0]?.count ?? 0) > 0;
}

// Look up by OIDC sub, create if missing. On a returning user we refresh
// email and name in case they changed in PocketID since last login. The
// `sub` claim is the stable identity; everything else is display data.
export async function upsertUserFromOIDC(
  sub: string,
  email: string | null,
  name: string | null,
): Promise<AppUser> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.sub, sub))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const needsRefresh =
      (email !== null && row.email !== email) ||
      (name !== null && row.name !== name);
    if (needsRefresh) {
      await db
        .update(users)
        .set({
          email: email ?? row.email,
          name: name ?? row.name,
        })
        .where(eq(users.id, row.id));
      return {
        id: row.id,
        sub: row.sub,
        email: email ?? row.email,
        name: name ?? row.name,
        createdAt: row.createdAt,
        isAdmin: row.isAdmin,
      };
    }
    return row as AppUser;
  }

  // Admin status is determined only at creation. Returning users keep
  // whatever isAdmin they have; we do not silently flip it on every login
  // if the env allowlist or admin headcount changes. Promotion / demotion
  // after the fact is an explicit out-of-scope item for v1 (deferred to a
  // future admin UI, per the plan).
  const allowlist = parseAdminEmailAllowlist();
  const normalizedEmail = email?.trim().toLowerCase() ?? null;
  const allowlisted =
    normalizedEmail !== null && allowlist.includes(normalizedEmail);
  // Order matters: short-circuit on the allowlist match so we do not hit
  // the DB count when we already know the answer.
  const bootstrapFirstAdmin = allowlisted ? false : !(await realAdminExists());
  const isAdmin = allowlisted || bootstrapFirstAdmin;

  const id = ulid();
  const createdAt = new Date().toISOString();
  try {
    await db.insert(users).values({
      id,
      sub,
      email,
      name,
      createdAt,
      isAdmin,
    });
  } catch (err) {
    // Two concurrent first-time logins for the same `sub` race past the
    // initial SELECT and both reach this INSERT. The users.sub UNIQUE
    // index catches the loser; better-sqlite3 surfaces it as
    // SQLITE_CONSTRAINT_UNIQUE. Re-run the SELECT and return the row the
    // winner inserted instead of propagating a 500 to the user.
    const code = (err as { code?: string } | null)?.code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const winner = await db
        .select()
        .from(users)
        .where(eq(users.sub, sub))
        .limit(1);
      if (winner.length > 0) {
        return winner[0] as AppUser;
      }
    }
    throw err;
  }

  if (isAdmin) {
    const reason = allowlisted
      ? 'allowlisted email'
      : 'first real user';
    console.log(
      `[auth] Promoted ${email ?? sub} to admin (${reason}).`,
    );
  }

  await claimLegacyChatsIfFirstUser(id);

  return { id, sub, email, name, createdAt, isAdmin };
}

// On upgrade from a pre-OIDC deploy, every existing chat was backfilled
// to the synthetic 'legacy' user by migration 0003. Once scoping lands,
// those chats become invisible because real users have fresh ULID ids.
// The first real OIDC user to log in inherits the legacy chats; later
// users start clean. For single-user deploys this restores history
// transparently. For multi-user deploys the admin is virtually always
// the first to log in, which is the expected ownership transfer.
async function claimLegacyChatsIfFirstUser(newUserId: string): Promise<void> {
  const otherRealUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.sub), ne(users.id, newUserId)))
    .limit(1);

  if (otherRealUsers.length > 0) return;

  const result = await db
    .update(chats)
    .set({ userId: newUserId })
    .where(eq(chats.userId, LEGACY_USER_ID));

  const claimed = (result as { changes?: number }).changes ?? 0;
  if (claimed > 0) {
    console.log(
      `[auth] First OIDC user ${newUserId} claimed ${claimed} legacy chat(s).`,
    );
  }
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0] as AppUser;
}
