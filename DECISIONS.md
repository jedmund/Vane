# Decision Log

Append-only. One section per agent per phase. Document non-obvious judgment calls
so the orchestrator (and the eventual PR reviewer) can see what was decided and why.

---

## Phase 1 / Phase 2 — data model migration (impl agent)

Date: 2026-06-01

### Package manager: yarn (not npm)

The orchestrator prompt said "install the npm dependencies", but the repo ships
`yarn.lock` and both `Dockerfile` and `Dockerfile.slim` invoke
`yarn install --frozen-lockfile` and `yarn build`. Switching to npm would
invalidate the lockfile and break the production image build. Resolved by
enabling yarn 1.22 via corepack and adding deps with `yarn add`. The npm
script names referenced in the plan (`npm run build`) still work because the
script is just `next build`; we run it via `yarn build`.

### ID generator: ulid

Requirements call for "ULID or random" for the users table PK. Chose ULID:
- Lexicographically sortable, so future "list users in admin UI" queries can
  ORDER BY id and get creation order for free.
- 26 chars vs nanoid's variable length; predictable storage cost.
- Single tiny dep (`ulid`), no native bindings, no peer-dep churn.

### Column name: userId (camelCase) — not user_id

The orchestrator prompt explicitly flagged this as a non-obvious choice.
The existing schema is uniformly camelCase at the SQL layer:
`chatId`, `messageId`, `createdAt`, `backendId`, `responseBlocks`.
Matching that convention beats matching the prompt verbatim. Drizzle is
configured via `text('userId')`; the SQL column name is `userId`.
If a future contributor objects, this is mechanical to rename.

### messages table is NOT given a userId column

Ownership flows transitively: a message belongs to a chat, and a chat belongs
to a user. Adding `messages.userId` would be a denormalization with no
security benefit because every message access path already goes through the
chat (either by `chatId` lookup or by joining `chats`). Phase 4's scoping
will enforce ownership at the chat boundary; messages are reached through
already-scoped chats. If a future query pattern reads messages without
joining chats, that's the moment to revisit.

### Foreign key: declared in Drizzle, NOT enforced in SQLite

The Drizzle schema declares `references(() => users.id)` so the type system
and any future query builder sees the relationship. We do NOT issue
`PRAGMA foreign_keys = ON` at connection time, matching upstream behavior.
Enforcing FKs at the engine level is a separate decision and would need a
data audit first (legacy rows that already violate constraints would block
startup). Out of scope for this phase.

### chats.userId is NULLable in the schema

Per the plan: "Nullable in the schema (legacy chats need to pass), but every
new chat must populate it (you do not enforce that at the DB level here;
that is a Phase 4 concern)." Schema reflects this. Phase 4 will tighten the
application-level invariant.

### Migration applies via repo's custom runner, not drizzle-kit at runtime

`src/lib/db/migrate.ts` reads `drizzle/*.sql`, splits on
`--> statement-breakpoint`, and applies un-run files. It records applied
migrations in a `ran_migrations` table by numeric prefix. New migration
file `0003_*.sql` will be picked up automatically on next server start
(triggered from `src/instrumentation.ts`). The drizzle-kit generated SQL is
edited by hand to add the legacy-user INSERT and the backfill UPDATE inside
the same migration file, separated by `--> statement-breakpoint` so the
runner executes them as separate statements.

### Migration file authored by hand (drizzle-kit version mismatch)

`drizzle-kit@0.18.1` (the version pinned in package.json) is too old to read
the version-7 snapshot format that the existing `drizzle/meta/*.json` files
use, so it generates nothing. Newer drizzle-kit versions (0.28 .. 0.31.10)
refuse to run with `drizzle-orm@0.45.2` ("Please install latest version of
drizzle-orm"). Resolving the version skew by bumping `drizzle-orm` is a
much larger change with cross-cutting risk that does not belong in this PR.

Instead the new migration file `drizzle/0003_*.sql` and its companion
`drizzle/meta/0003_snapshot.json` are authored by hand, matching the
structure of `drizzle/0000_fuzzy_randall.sql` / `drizzle/meta/0002_snapshot.json`
verbatim. The repo's own runner (`src/lib/db/migrate.ts`) is what actually
applies the SQL at server boot, so as long as the SQL is valid and the
journal is updated, the toolchain is happy. A future PR can bump
drizzle-kit + drizzle-orm together and re-generate the snapshots from
the schema.

### Verification approach for "clean apply against fresh sqlite"

We don't have a docker-compose test rig. Verified by:
1. Backing up any existing `data/db.sqlite`.
2. Deleting it so the migrate runner sees a fresh database.
3. Running migrations standalone via `npx tsx src/lib/db/migrate.ts`
   (or equivalent node invocation).
4. Inspecting the resulting schema with `sqlite3 .schema` and the
   `users` and `ran_migrations` tables with `SELECT *`.
5. Restoring the backup.
