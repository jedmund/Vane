import { and, eq, isNotNull, ne } from 'drizzle-orm';
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
      };
    }
    return row as AppUser;
  }

  const id = ulid();
  const createdAt = new Date().toISOString();
  await db.insert(users).values({
    id,
    sub,
    email,
    name,
    createdAt,
  });

  await claimLegacyChatsIfFirstUser(id);

  return { id, sub, email, name, createdAt };
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
  return rows.length > 0 ? (rows[0] as AppUser) : null;
}
