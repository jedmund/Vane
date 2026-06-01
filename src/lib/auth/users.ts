import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import db from '@/lib/db';
import { users } from '@/lib/db/schema';

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
  return { id, sub, email, name, createdAt };
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows.length > 0 ? (rows[0] as AppUser) : null;
}
