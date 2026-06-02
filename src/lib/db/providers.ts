import { isNull, or, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import db from '@/lib/db';
import { providers as providersTable } from '@/lib/db/schema';
import { Model } from '@/lib/models/types';

// Typed view of a providers row. We deliberately separate the type-specific
// config (api_key, baseURL, etc.) from chatModels/embeddingModels, even
// though the on-disk blob folds them together. Keeping them split here
// matches the shape every consumer (ModelRegistry, the provider classes,
// the eventual /api/providers serializer) actually wants, and means callers
// never see chatModels accidentally typed as part of `config`.
export type StoredProvider = {
  id: string;
  userId: string | null;
  type: string;
  name: string;
  config: Record<string, any>;
  chatModels: Model[];
  embeddingModels: Model[];
  createdAt: string;
};

// Rows whose `config` JSON cannot be parsed are dropped rather than
// crashing the read path. A corrupt blob is almost certainly an operator
// error (hand-edited db, partial write); failing the whole list because of
// one bad row would lock the user out of every provider including healthy
// ones. The warning is loud enough that the row will get noticed, and the
// row is then deleted so the warning fires once instead of on every read.
function deleteCorruptRow(id: string, reason: string): void {
  try {
    const result = db
      .delete(providersTable)
      .where(eq(providersTable.id, id))
      .run();
    if (result.changes > 0) {
      console.warn(
        `providers: deleted corrupt row ${id} (${reason}); operator action may be needed to re-create it`,
      );
    }
  } catch (err) {
    // Best-effort: a deletion failure is not worth crashing the read path
    // over. The warning above already told the operator something is off.
    console.warn(`providers: failed to delete corrupt row ${id}:`, err);
  }
}

function parseRow(row: {
  id: string;
  userId: string | null;
  type: string;
  name: string;
  config: string;
  createdAt: string;
}): StoredProvider | null {
  let blob: any;
  try {
    blob = JSON.parse(row.config);
  } catch (err) {
    console.warn(
      `providers: skipping row ${row.id} (${row.name}) with unparseable config:`,
      err,
    );
    deleteCorruptRow(row.id, 'unparseable config JSON');
    return null;
  }

  if (!blob || typeof blob !== 'object') {
    console.warn(
      `providers: skipping row ${row.id} (${row.name}) with non-object config`,
    );
    deleteCorruptRow(row.id, 'non-object config');
    return null;
  }

  const { chatModels, embeddingModels, ...rest } = blob;
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    name: row.name,
    config: rest,
    chatModels: Array.isArray(chatModels) ? chatModels : [],
    embeddingModels: Array.isArray(embeddingModels) ? embeddingModels : [],
    createdAt: row.createdAt,
  };
}

// Visibility rule: instance rows (userId IS NULL) are visible to every
// authenticated user; personal rows are visible only to their owner. Single
// SQL query so the filter never gets accidentally bypassed in JS land.
// Sync return: better-sqlite3 is synchronous, and ModelRegistry's
// constructor needs to call this without awaiting. Phase 4 route handlers
// can wrap the call in an async function transparently.
export function getProvidersForUser(userId: string): StoredProvider[] {
  const rows = db
    .select()
    .from(providersTable)
    .where(or(isNull(providersTable.userId), eq(providersTable.userId, userId)))
    .all();

  return rows
    .map((r) => parseRow(r))
    .filter((p): p is StoredProvider => p !== null);
}

// Returns the row whether or not the caller can see it. Visibility checks
// are the caller's job (see canUserSeeProvider) because the right response
// for "exists but not yours" differs from "does not exist anywhere" only at
// the route layer (404 vs 403).
export function getProviderById(id: string): StoredProvider | null {
  const row = db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, id))
    .get();

  if (!row) return null;
  return parseRow(row);
}

// Centralized visibility predicate. Instance rows (userId IS NULL) are
// visible to everyone; personal rows are visible to their owner and to
// admins. Used by route handlers to gate /api/providers/[id] reads.
export function canUserSeeProvider(
  provider: StoredProvider,
  userId: string,
  isAdmin: boolean,
): boolean {
  if (provider.userId === null) return true;
  if (isAdmin) return true;
  return provider.userId === userId;
}

// Mutation predicate. Instance rows require admin to mutate; personal rows
// allow admin (override) or owner. Non-admin non-owner gets denied even if
// they can read the row.
export function canUserMutateProvider(
  provider: StoredProvider,
  userId: string,
  isAdmin: boolean,
): boolean {
  if (provider.userId === null) return isAdmin;
  if (isAdmin) return true;
  return provider.userId === userId;
}

// Folds the typed config + model lists back into the single on-disk JSON
// blob the schema expects. Kept private to this module so callers cannot
// accidentally store a half-merged shape.
function serializeBlob(
  config: Record<string, any>,
  chatModels: Model[],
  embeddingModels: Model[],
): string {
  return JSON.stringify({
    ...config,
    chatModels,
    embeddingModels,
  });
}

export type CreateProviderInput = {
  userId: string | null;
  type: string;
  name: string;
  config: Record<string, any>;
  chatModels?: Model[];
  embeddingModels?: Model[];
};

export function createProvider(input: CreateProviderInput): StoredProvider {
  const id = ulid();
  const createdAt = new Date().toISOString();
  const chatModels = input.chatModels ?? [];
  const embeddingModels = input.embeddingModels ?? [];

  db.insert(providersTable)
    .values({
      id,
      userId: input.userId,
      type: input.type,
      name: input.name,
      config: serializeBlob(input.config, chatModels, embeddingModels),
      createdAt,
    })
    .run();

  return {
    id,
    userId: input.userId,
    type: input.type,
    name: input.name,
    config: input.config,
    chatModels,
    embeddingModels,
    createdAt,
  };
}

export type UpdateProviderInput = {
  name?: string;
  config?: Record<string, any>;
  chatModels?: Model[];
  embeddingModels?: Model[];
};

// Read-modify-write so we can preserve chatModels/embeddingModels when only
// name or config is being patched. Type is intentionally not updatable;
// callers that want a different type delete and recreate (locked decision).
export function updateProviderRow(
  id: string,
  patch: UpdateProviderInput,
): StoredProvider | null {
  const current = getProviderById(id);
  if (!current) return null;

  const nextName = patch.name ?? current.name;
  const nextConfig = patch.config ?? current.config;
  const nextChatModels = patch.chatModels ?? current.chatModels;
  const nextEmbeddingModels = patch.embeddingModels ?? current.embeddingModels;

  db.update(providersTable)
    .set({
      name: nextName,
      config: serializeBlob(nextConfig, nextChatModels, nextEmbeddingModels),
    })
    .where(eq(providersTable.id, id))
    .run();

  return {
    ...current,
    name: nextName,
    config: nextConfig,
    chatModels: nextChatModels,
    embeddingModels: nextEmbeddingModels,
  };
}

export function deleteProviderRow(id: string): boolean {
  const result = db
    .delete(providersTable)
    .where(eq(providersTable.id, id))
    .run();
  return result.changes > 0;
}
