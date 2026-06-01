import { sql } from 'drizzle-orm';
import {
  text,
  integer,
  sqliteTable,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { Block } from '../types';
import { SearchSources } from '../agents/search/types';

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey(),
  messageId: text('messageId').notNull(),
  chatId: text('chatId').notNull(),
  backendId: text('backendId').notNull(),
  query: text('query').notNull(),
  createdAt: text('createdAt').notNull(),
  responseBlocks: text('responseBlocks', { mode: 'json' })
    .$type<Block[]>()
    .default(sql`'[]'`),
  status: text({ enum: ['answering', 'completed', 'error'] }).default(
    'answering',
  ),
});

interface DBFile {
  name: string;
  fileId: string;
}

// Users table for OIDC-backed multi-user support. The `sub` column stores the
// OpenID Connect subject claim and is the lookup key on every login. It is
// nullable so the synthetic `legacy` user can sit in the same table without
// claiming an external identity.
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    sub: text('sub'),
    email: text('email'),
    name: text('name'),
    createdAt: text('createdAt').notNull(),
  },
  (table) => ({
    // Unique index, not a UNIQUE column constraint: SQLite treats NULL as
    // distinct so the synthetic 'legacy' row (sub=NULL) does not collide.
    subIdx: uniqueIndex('users_sub_idx').on(table.sub),
  }),
);

export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: text('createdAt').notNull(),
    sources: text('sources', {
      mode: 'json',
    })
      .$type<SearchSources[]>()
      .default(sql`'[]'`),
    files: text('files', { mode: 'json' })
      .$type<DBFile[]>()
      .default(sql`'[]'`),
    // Nullable for the legacy data path (existing rows are backfilled to the
    // synthetic 'legacy' user by the 0003 migration). New chats must populate
    // this column; that invariant is enforced at the application layer in a
    // later phase, not by a NOT NULL constraint here.
    userId: text('userId').references(() => users.id),
  },
  (table) => ({
    userIdIdx: index('chats_user_id_idx').on(table.userId),
  }),
);
