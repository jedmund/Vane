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

---

## Phase 2: OIDC server plumbing (impl agent)

Date: 2026-06-01

### File convention: `src/proxy.ts`, not `src/middleware.ts`

The orchestrator prompt locked in `src/middleware.ts`. Next.js 16.2 deprecated
that filename and renamed the convention to `proxy.ts`. The critical
behavioral difference is the runtime default: `middleware.ts` still defaults
to the Edge runtime, while `proxy.ts` defaults to Node.js. Edge runtime
crashes on `crypto`, `setInterval`, and `better-sqlite3`, all of which the
session store + cookie HMAC + user lookup transitively require. Naming the
file `middleware.ts` would have meant either inlining a parallel Edge-safe
session lookup (a second source of truth that would drift) or failing at
runtime the first time the file ran. Renamed to `proxy.ts`, exported
`proxy` instead of `middleware`. Behavior is identical from the orchestrator's
perspective; the locked allowlist is preserved verbatim.

### Session store: singleton lives in module scope, not on `globalThis`

The store is created once per Node process and held in a module-level `let`.
Next.js dev mode does hot-reload module identities, which would create
multiple Map instances in the same process and orphan sessions. We accept
the dev-mode flake because the production build (which is what matters for
the deploy) builds once and runs forever. If dev-mode flake becomes
annoying, attach to `globalThis.__vaneSessionStore`. Not doing it now to
avoid the `globalThis as any` typing dance for a problem nobody has yet.

### State cookie: HMAC-SHA256 over a base64url-encoded JSON payload

The state cookie carries `{state, nonce, codeVerifier, returnTo}`. The
format is `<base64url(json)>.<base64url(hmac)>`. We sign rather than
encrypt because the contents are not secret (PKCE verifier exposure does
not break PKCE; the threat model is integrity, not confidentiality).
`timingSafeEqual` on the signature prevents an HMAC timing oracle, which
admittedly is a near-theoretical concern at typical request rates but the
code is one line. The minimum `SESSION_SECRET` length is enforced (16
chars) so a misconfigured deploy with `SESSION_SECRET=x` fails at boot
rather than silently shipping a forgeable cookie.

### Session token format: 32 bytes from `crypto.randomBytes`, base64url

Opaque token, never decoded by anything other than the Map. base64url
chosen over hex because it is shorter (43 vs 64 chars) and cookie-safe with
no escaping. The token never appears in URLs.

### Same-origin `returnTo` validation: prefix check, not URL parsing

`sanitizeReturnTo` rejects anything starting with `//`, `http://`,
`https://`, or anything that doesn't start with `/`. Considered using
`new URL(raw, origin)` and comparing hosts, but the prefix check is
simpler, has no edge cases with `URL` constructor's coercion behavior, and
is the canonical pattern for this. Anything that fails sanitization
silently rewrites to `/` rather than 400-ing the request, because the
sanitization runs on user-supplied query params and we'd rather absorb a
malformed value than break the login flow.

### Userinfo failure: fall back to id_token claims, then to email local-part

If `fetchUserInfo` throws (network blip, IdP misconfiguration), the callback
reads `email` and `name` from the id_token claims that were already
validated during code exchange. If `name` is still missing, derive a
display name from the email local-part. The user row's `name` column is
nullable in the schema but the callback never inserts null for it in
practice; the callback `?? null` paths are there for type honesty, not
because we expect to hit them with PocketID.

### `/api/me` response omits `sub`

Locked by the prompt: `{id, email, name}`. The internal `id` (ULID) is the
stable handle for the rest of the app; `sub` only exists as the lookup key
into the users table. Exposing both would invite the frontend to start
keying off `sub`, which couples the UI to the OIDC provider's identifier.

### Logout: 302 to `/login`, NOT to PocketID's end-session URL

Locked by the prompt. The end-session endpoint is fetched server-side as
a fire-and-forget POST so PocketID can clear its server-side session record
where it implements that; the user's browser is then redirected to our own
`/login` page. The user can re-authenticate against PocketID from there if
they want, but they don't have to round-trip through PocketID's logout
confirmation UI. Tradeoff: PocketID's browser-side session cookie remains
set. If the user clicks "Sign in with PocketID" they will be silently
re-authenticated without a password prompt. That's the expected SSO
behavior and matches OpenWebUI's PocketID integration.

### Middleware passes `x-vane-user-id` header to downstream handlers

The proxy mutates the request headers via `NextResponse.next({ request:
{ headers } })` so route handlers can read `req.headers.get('x-vane-user-id')`
without re-validating the session cookie. Next.js prevents client-supplied
versions of headers it overrides this way from reaching the handler, so
the trust boundary is real. Phase 3 will consume this header for per-user
chat scoping.

### Session expiry mid-stream: 401 immediately, no refresh

Locked by the prompt. `getSessionStore().get(token)` returns null for an
expired token and deletes the entry. The middleware then 401s API calls
and 302s HTML routes to `/login`. No silent refresh, no grace window. A
running chat request that crosses the expiry boundary will 401 mid-stream
on its next API call. The user re-authenticates and resumes.

### `node:` prefix on imports: removed

Originally wrote `import { randomBytes } from 'node:crypto'`. Webpack 5
(invoked by `yarn build`) refuses to resolve the `node:` URI scheme inside
files transitively reachable from `proxy.ts`. Dropped the prefix; the
import is equivalent at the module level. This is a webpack limitation,
not a Node limitation.

### Manifest in the allowlist

`/manifest.webmanifest` is generated by the Next metadata API and is
expected to be fetchable without auth (PWA spec, plus browsers don't send
cookies on the manifest fetch in some configurations). Added to the
proxy allowlist alongside `/favicon.ico`. Static assets under `/_next/`
are also allowlisted by prefix.

### What is necessarily untested

The actual OIDC round-trip (discovery, authorization code exchange,
userinfo) cannot be exercised without a real PocketID instance. The smoke
test verified:
- `/` without a cookie redirects to `/login?returnTo=%2F`
- `/api/me` without a cookie returns 401 `{error: "unauthenticated"}`
- `/login` renders 200 OK
- `/api/auth/login` without `OIDC_ISSUER_URL` returns 503 `{error: "oidc_unavailable"}`
- `/api/auth/login` with an invalid issuer URL returns 503 (discovery
  fails before the redirect is built)
- `/api/auth/callback` without a state cookie returns 400 `{error: "invalid_state"}`
- `/api/auth/logout` (POST) returns 302 to `/login` and emits a
  `Set-Cookie: vane_session=; Max-Age=0` header
- `/favicon.ico` and `/manifest.webmanifest` bypass auth
- `yarn build` is clean with no warnings

The lines that are NOT exercised end-to-end and need a real PocketID
round-trip to validate:
- `buildAuthorizationStart` URL construction with real provider metadata
- `authorizationCodeGrant` validation of state / nonce / PKCE
- `fetchUserInfo` happy path (and the id_token fallback path)
- `tryBuildEndSessionUrl` actually calling out to PocketID's end_session_endpoint
- The cookie chain on successful callback (state cookie cleared,
  session cookie set with the real token)

### Mid-review fix: legacy chat claim on first OIDC login

Surfaced by review of the stacked PR #3: Phase 1's migration backfilled
every pre-existing chat to `userId='legacy'`, and Phase 3's scoping then
filters by the session's user id. Real OIDC users get fresh ULID ids,
so the `legacy` rows become invisible to them. Upgrading an existing
Vane deploy would silently eat the entire chat history at the moment
the API lockdown went live.

Fix lives in `upsertUserFromOIDC` on the "user newly inserted" branch:
if no other user with `sub IS NOT NULL` exists yet, this caller is the
first real OIDC user and inherits every chat where `userId='legacy'`.

Considered alternatives and why they were rejected:
- `WHERE userId = ? OR userId = 'legacy'` everywhere in the scoped
  queries: every authenticated user would see every legacy chat.
  Breaks multi-user.
- Admin route to manually reassign legacy chats: real solution
  long-term, but blocks the upgrade path right now.
- Email-based claim: the migration set legacy user's email to NULL,
  no anchor to match against.
- Opt-in `CLAIM_LEGACY_CHATS=true` env var: extra deploy step, the
  default would still lose data on upgrade.

The "first user wins" rule is the right default for the homelab
single-user case (the only user wins automatically) AND for typical
multi-user deploys where the admin is virtually always first to log
in. The legacy user row itself is left in place after the claim so
the schema FK target stays valid for any rows that might still
reference it in some edge case.
