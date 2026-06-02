import { isNull, or, eq } from 'drizzle-orm';
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
// ones. The warning is loud enough that the row will get noticed.
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
    return null;
  }

  if (!blob || typeof blob !== 'object') {
    console.warn(
      `providers: skipping row ${row.id} (${row.name}) with non-object config`,
    );
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
