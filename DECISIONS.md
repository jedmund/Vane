# Decision Log

Append-only. One section per agent per phase. Document non-obvious judgment calls
so the orchestrator (and the eventual PR reviewer) can see what was decided and why.

---

## Phase 1 / Phase 2: data model migration (impl agent)

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

### Column name: userId (camelCase), not user_id

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

---

## Phase 3: per-user data scoping (impl agent)

Date: 2026-06-01

### OwnershipError lives in src/lib/db/scoped.ts, not its own file

The error class is a single sentinel value used only by helpers in the same
module and the routes that call them. Splitting it into `src/lib/db/errors.ts`
would create a one-line file and force every route to import from two places
to handle ownership failures. Kept it adjacent to the helper that throws it.
The same file also exports `MissingUserIdHeaderError` and the canned
`ownershipErrorResponse` / `missingUserIdResponse` builders so a route only
has to import from one place.

### Audit was a grep, not a type-system change

Considered making the scoped helpers the only way to access `chats` from
route code by exporting a `userScopedDb(userId)` proxy that wraps the
drizzle query builder. Rejected: drizzle's chainable types are large and
non-trivial to wrap; the leverage would be small (we only touch three API
routes today); and the grep audit is already short and conclusive. The
audit shape is committed to muscle memory:

```
rg "from\(chats\)" src/app/api
rg "from\(messages\)" src/app/api
rg "db\.query\.(chats|messages)" src/app/api
rg "db\.(insert|update|delete)\((chats|messages)\)" src/app/api
```

Every hit must either be inside `scoped.ts` (the helpers themselves), or
preceded by a `userId` filter / `getUserChat` / `assertUserOwnsChat`.

### /api/chats GET: switched .reverse() to ORDER BY desc(createdAt)

The original implementation did `findMany()` (no order) then `.reverse()`
in JS. That assumed SQLite insertion order matched the desired display
order, which is true today but is not a guarantee. While I was already
rewriting the query to add the userId filter I switched to `ORDER BY
createdAt DESC`. Same display order, explicit contract.

### Existing chat collision in /api/chat: 403 not silent take-over

When POST /api/chat arrives with a `chatId` that already exists in the
database but is owned by someone else (or is a legacy NULL-userId row),
we return 403. The alternative would be to silently insert a NEW chat
with the same id but a different `userId` (impossible: id is the PK), or
to accept the message into the existing chat (an obvious data leak), or
to auto-allocate a fresh id (breaks the client's optimistic UI which has
already routed to `/c/<chatId>`). 403 is the only honest answer; the
client should handle it by surfacing an error.

Legacy chats (userId === null) fall into the same 403 bucket. A real
user does not "claim" a legacy chat in this phase; admin reclaim tooling
is out of scope per the plan.

### Ownership check in /api/chat happens BEFORE model loading

The check runs before `ModelRegistry`, before the `SearchAgent`, before
the response stream is opened. A cross-user POST with a bogus chatId
returns 403 without touching the model layer, so it cannot be used to
probe model availability or exhaust LLM quotas.

### SearchAgent's messages access was NOT modified

`src/lib/agents/search/index.ts` reads and writes `messages` rows but
the agent is reachable only via `/api/chat` POST. That route now
ownership-checks the chatId before spawning the agent, so by the time
the agent runs the chatId is known-good. Adding a second ownership
check inside the agent would be redundant and would require threading
`userId` through the search agent's input shape for a non-functional
gain.

### Messages route: 403 leaks nothing the chat list does not already leak

`/api/chats/[id]` returns 403 for both "chat does not exist" and "chat
exists but belongs to someone else". An attacker who already enumerated
`/api/chats` can see exactly their own chat ids; nothing they probe
externally distinguishes "not yours" from "not real". Matches the locked
policy.

### useCurrentUser: useState + module-level Promise cache, no context

Considered wrapping the hook in a React context so the cache invalidates
on logout. Rejected because logout always navigates to `/login` via
`window.location.href = '/login'`, which is a hard navigation that
re-imports the module and resets the cache as a side effect. No context
needed.

The hook returns `{user, loading, error}` rather than just `user` so a
future consumer can render skeletons. The Sidebar currently renders
`null` during `loading` to avoid a layout shift.

### Logout uses `fetch('/api/auth/logout', { redirect: 'manual' })` + manual nav

The logout endpoint returns 302 to `/login`. Browsers will not follow a
redirect from a fetch POST to a top-level navigation. We pass
`redirect: 'manual'` to suppress the fetch-level redirect handling, then
do `window.location.href = '/login'` ourselves. The server-side cookie
clear runs as the fetch completes; the navigation guarantees the user
ends up on the login page even if the redirect status was unreadable.

### Sidebar treatment: avatar circle + small logout button, no email text

The desktop sidebar is 72px wide. A full email does not fit and forcing
it would require either a wider sidebar (out of scope visual change) or
heavy truncation (`jed...@atelier.house` style) that loses the
information the email was supposed to convey. Settled on a 36px circle
with the user's first initial, tooltipped (`title` + `aria-label`) with
the full email. The logout button matches the existing circular icon
button used by `SettingsButton`. Both sit in a new flex column under
Settings so the visual ordering bottom-up is: logout, user, settings,
nav links. That reads bottom-of-screen to top-of-screen.

Mobile bar (the `lg:hidden` strip) is untouched. The mobile UX is
secondary on this app and crowding the bottom strip with a logout
button there is an explicit non-goal for this phase. A future pass
that adds a "more" menu to the mobile bar is the natural home.

### removed unused Sidebar imports while editing

`SquarePen`, `ArrowLeft`, `Description`, `Dialog`, `DialogPanel`,
`DialogTitle`, and `Settings` were imported but unused in the old file.
Pruned them along with the change rather than leave dead imports under
my touch. Standard cleanup, not a functional decision.

### Verification: manual test plan, no script committed

The plan said "manual test plan documented OR a small Vitest/Node
script under scripts/". The repo has no test runner configured
(`package.json` has no `test` script and no vitest/jest dep) and
`better-sqlite3` is a native module that the helper transitively
loads. Standing up a one-off test harness for one phase would add
infra weight that gets paid back only if the rest of the project
adopts the same runner. Documented the manual test plan instead:

1. Boot the app with two distinct OIDC users (or two distinct
   `users` rows manually inserted, with two session cookies issued
   by hand against the in-memory session store).
2. As user A: POST /api/chat with a new chatId. Confirm the chat is
   created with `userId=A`.
3. As user A: GET /api/chats. Confirm only A's chats are returned.
4. As user B: GET /api/chats. Confirm only B's chats are returned (no
   A's chat is visible).
5. As user B: GET /api/chats/<A's chatId>. Confirm 403
   `{"error":"forbidden"}`.
6. As user B: DELETE /api/chats/<A's chatId>. Confirm 403; confirm
   the chat is still present in the DB.
7. As user B: POST /api/chat with `chatId = A's chatId`. Confirm 403
   without the model registry being touched.
8. As user A: DELETE /api/chats/<A's chatId>. Confirm 200 and both the
   chat row and its messages are gone.
9. Remove the session cookie. GET /api/me. Confirm 401.
10. Hit a route directly without going through proxy (synthetic
    request without `x-vane-user-id`). Confirm 500
    `{"error":"server_misconfigured"}`. This case is unreachable in
    production but confirms the helper's contract.

### useCurrentUser handling of 401

Locked decision in the prompt: "useCurrentUser handles 401 by
redirecting or just returning null". Chose `null`. The proxy already
redirects unauthenticated *navigations* to `/login`; the hook fires on
an authenticated page (only authenticated pages render the Sidebar)
and only ever sees 401 if the session expires mid-session. Returning
`null` lets the Sidebar hide the badge until the next page navigation
re-runs the proxy's redirect. Triggering a navigation from inside the
hook would race the proxy.

---

## Phase 4: security headers + SearXNG secret (impl agent)

Date: 2026-06-01

### CSP is enforced from day one, not report-only

Locked by orchestrator. The cost of finding a missed directive late
is small (sites fail loud in dev), and report-only mode would have
required a `/api/csp-report` endpoint that we are explicitly told not
to build. Dev-mode verification on `/login` and the home redirect
showed no violations; the rest of the surface uses the same component
stack so it should pass too. If a real violation surfaces, the fix is
to widen the relevant directive, not flip to report-only.

### `'unsafe-inline'` accepted on both script-src and style-src

Two reasons, called out in code comments next.config.mjs:39 and :43.
1. Next.js 16 App Router still emits an inline hydration script and
   does not yet expose a server-rendered nonce hook. NextAuth-era
   tricks (manual nonce injection via middleware) don't apply to App
   Router's streamed RSC payload.
2. Headless UI, Floating UI, and Framer Motion inject inline styles
   for positioning and transitions. Replacing them is out of scope.

A nonce-based CSP is the future state and is left as a TODO in the
script-src comment. Not blocking Phase 4.

### `img-src` is permissive (`https:`) by design

Chat responses pull favicons and OG images from arbitrary search-result
domains. A specific allowlist would either break the product or require
runtime updates as users add providers. Tighter scoping is deferred and
documented as out-of-scope in the orchestrator prompt.

### CSP is built at config-load (effectively build-time)

Next bakes the value of `headers()` into `.next/routes-manifest.json`
at `next build`. That means `OIDC_ISSUER_URL` must be present during
the Docker image build for the IdP origin to land in `connect-src`
and `form-action`. If it is unset at build, the CSP is still valid
(omits the IdP origin) and a console warning prints. Implication for
the homelab deploy: the build pipeline either needs to pass
`OIDC_ISSUER_URL=https://id.atelier.house` as a build arg, or the IdP
host has to be added to the CSP via an alternative mechanism (e.g.
emit it from `proxy.ts` at request time, which would require
relocating the directive there). For now we accept the build-time
constraint; this is flagged for the orchestrator to surface in the PR
description so the deploy side knows.

The OIDC origin is resolved via `new URL(raw).origin` (not a manual
string split) so malformed URLs are caught at config load rather than
leaking a broken `connect-src` to clients.

### HSTS included, no `preload` directive

Two-year max-age plus `includeSubDomains` matches what most modern
deploys recommend. We deliberately do NOT emit `preload`: enrolling
in the HSTS preload list is effectively one-way (removal takes
months and a manual request to browser vendors) and should be a
conscious per-deploy decision, not a default the framework forces.

### No `/api/csp-report` endpoint

Locked by orchestrator. Adding one would defeat the point of running
CSP in enforce mode and would also pull in a violation-report parser
that we'd need to maintain.

### X-Frame-Options included alongside frame-ancestors

`frame-ancestors 'none'` is the modern equivalent and is what
compliant browsers enforce. `X-Frame-Options: DENY` is redundant for
those, but cheap, and covers older user agents that don't honor
frame-ancestors. No downside.

### SearXNG settings.yml is shipped in the image with a placeholder

The Dockerfile already copies `searxng/settings.yml` to
`/etc/searxng/settings.yml` during image build. Rather than generating
the whole settings file at runtime, we ship the template with a
`__SEARXNG_SECRET__` placeholder and let entrypoint.sh `sed` the real
value in at container start. Keeps the template under version control
and minimizes runtime file generation.

### Secret precedence: env > persisted file > generate

Generation only happens if both the env var is unset AND no persisted
file exists. The persisted file lives at `/home/vane/data/searxng.secret`
inside the data volume so the secret survives container rebuilds
without operator intervention. This is the smooth-upstream experience
called for in the orchestrator prompt: a user can `docker compose up`
and never see SearXNG complain about a missing secret.

### Persisted secret is 0600

Generated via `( umask 077 && printf ... )` so the file lands at
`0600` even on filesystems where post-hoc `chmod` is ignored (some
NFS / bind-mount setups). Followed by an idempotent `chmod 600` for
belt-and-braces. The secret is operator-only readable; SearXNG runs
as root via sudo and can read it.

### `sed` delimiter is `|` not `/`

The substituted value is a 64-char hex string with no `|` in it.
Using `|` as the delimiter avoids any chance of the substitution
choking on a `/` if the secret format ever changes (or if an operator
override contains a `/`).

### Did NOT take from rafaelfiguereod-stack PR

Per orchestrator: `/api/auth/login` password handler, `/auth/login`
password page, `/config` and `/config/setup-complete` first-run
routes (our existing /api/config routes predate that PR; left alone),
`VANE_AUTH_TOKEN` env var, `middleware.ts` (we use `proxy.ts` in
Next 16), the upload manager (separate PR), the scraper utility
(separate PR), and the `src/lib/config/*` index module tied to the
first-run flow. We also did not take the `SECURITY-AUDIT.md` or
`.agent-task.md` artifacts.

### Form of CSP value: single header line, joined with `; `

Multi-line CSP via header arrays is not how the HTTP spec works; the
final header is one line. We assemble directives as an array for
readability then `join('; ')`. The trailing-`;` debate (some examples
add one, the spec doesn't require it) is resolved by omitting it,
which matches the W3C example output and avoids a dangling-semicolon
parse quirk in older browsers.

## Phase 1: schema + migration 0004

### `users.isAdmin` defaults to false

The default is 0 (false) at the column level. Admin status is only ever
granted by an explicit path: the first-OIDC-user bootstrap, or an email
match against `OIDC_ADMIN_EMAILS` (both Phase 2). A `DEFAULT 1` here
would mean every brand-new row, including any synthetic future user
record we forget to set explicitly, ships with admin powers. That is
the wrong failure mode in a multi-user world.

### `providers.userId` is nullable; NULL means instance scope

We considered a separate boolean `isInstance` column with a NOT NULL
`userId` pointing at "whichever admin created it". Rejected because:

1. The single-query visibility filter we need on every list is
   `WHERE userId IS NULL OR userId = ?`. That maps cleanly onto a
   nullable column with a regular index.
2. An instance provider does not semantically belong to the admin who
   happened to create it. If that admin's account is later removed,
   the connection should remain. With nullable userId there is nothing
   to cascade.
3. SQLite's `REFERENCES users(id)` with no `ON DELETE` action is happy
   to hold a NULL forever; no extra constraint plumbing required.

### Legacy user is promoted to admin

`UPDATE users SET isAdmin=1 WHERE id='legacy'`. The legacy row already
owns every pre-OIDC chat (set by 0003) and, after Phase 2, will own
every pre-existing config.json entry as instance scope. Making it admin
keeps single-user homelab upgrades zero-config: the operator visits
the new connections page, sees their existing connections marked
Instance, and can edit them. When the first real OIDC user lands and
inherits the legacy chats, Phase 2's bootstrap logic also flags them
admin, so admin powers transfer cleanly.

### Seed-from-config.json runs in JS inside the migrate runner

The runner already special-cases `0001` and `0002` for data shuffling
that pure SQL cannot express; we follow the same pattern for `0004`.
The schema-change statements run as SQL (so the snapshot stays in
sync with drizzle-kit's expectations), then the JS block reads
`data/config.json` and inserts one `providers` row per
`modelProviders` entry with `userId = NULL`. Both the SQL and the JS
seed are gated by the same `ran_migrations` row keyed `0004`, so a
second invocation skips the whole block. ULIDs are generated per row.

Alternative considered: a generic startup-time "ensure providers seeded"
step keyed by a flag in `config.json`. Rejected because the seed is a
one-time data migration, not a steady-state idempotent reconciliation;
the migrations table is the right ledger.

### `data/config.json` is NOT rewritten by this migration

The `modelProviders` key stays in `config.json` for now. Removing it
mid-migration is risky: if Phase 1 lands and we have to roll back, the
existing `serverRegistry` / `configManager` code still expects the
key to be present. Phase 3 owns the refactor that stops reading the
key, and Phase 3's commit is the appropriate moment to delete it.
Phase 1 stays additive only: nothing existing changes behavior.

### Boolean column type uses Drizzle's `integer` with `mode: 'boolean'`

Drizzle's sqlite-core wraps the 0/1 storage and gives us a `boolean`
TS type at the schema layer. The migration SQL writes `INTEGER NOT
NULL DEFAULT 0` directly (no boolean keyword in SQLite). The
snapshot's `"default": false` mirrors Drizzle's representation.

### Provider `config` is a `text` column, not Drizzle JSON mode

We store the JSON blob as plain text and parse / stringify at the
application boundary. JSON mode in sqlite-core works, but the blob
includes secrets (`api_key`) that we want to be deliberate about
touching; keeping it opaque at the schema layer means every read site
has to think about parsing, which is a useful forcing function for
the access-control plumbing in Phase 4. Encryption at rest is out of
scope per the plan; the blob is plaintext but at least the column
type is explicit about being a serialised payload, not structured
data.

---

## Phase 2: admin assignment + auth helpers (impl agent, finished by orchestrator)

Date: 2026-06-02

The Phase 2 agent ran out of Anthropic API credits between Commit 1
(helpers) and Commit 2 (the upsertUserFromOIDC change). The
orchestrator picked up the in-flight users.ts edit (which the agent
had completed before crashing), verified yarn build clean, and
finished the remaining commits. No code from the agent was rejected;
this is a bookkeeping note rather than a code decision.

### isAdmin is set ONLY at user creation, not on returning-user refresh

The simpler alternative is to re-evaluate the rules every time
upsertUserFromOIDC runs on a returning user. We chose not to do that.

- Operator surprise: if OIDC_ADMIN_EMAILS is edited (e.g. a typo, or
  temporary admin rotation), every login would silently flip people
  in or out of admin. Today the operator sees the promotion log line
  exactly once at creation; isAdmin is stable thereafter.
- The bootstrap "first real user" rule should fire exactly once per
  deploy. Re-evaluating on every login means the moment any real
  admin is removed, the next person to log in becomes admin. Not
  what we want; admin removal should not trigger unintended
  succession.
- Manual promotion / demotion is explicit out-of-scope per the plan.
  A future admin UI would set isAdmin directly rather than fight
  the upsert path.

### "First real user" check excludes id='legacy'

Phase 1's migration sets isAdmin=1 on the synthetic legacy user so
the upgrade path for single-user homelabs is zero-config (instance
providers backfilled from config.json show up as admin-owned). A
naive "no admin exists" check would always return false because
legacy already trips it, and the first real OIDC user would never
be promoted. The check is explicit: WHERE isAdmin=1 AND id !=
'legacy'. LEGACY_USER_ID is reused so any future change to the
sentinel id flows through one place.

### Allowlist parsed per upsert, not at module load

parseAdminEmailAllowlist() reads process.env.OIDC_ADMIN_EMAILS on
every upsert rather than caching at module-load. The cost is one
env read per OIDC login (negligible). The benefit is operators can
update the env via a compose-level reload that swaps the running
container's env without forcing us through a build cycle to refresh
a module-scope constant.

### Allowlist comparison is case-insensitive and trim()'d

Emails are case-insensitive in practice. trim() covers the most
common config error of trailing whitespace in
OIDC_ADMIN_EMAILS=" justin@atelier.house ". Both happen on parse
and on the email-being-checked before the includes() call so they
cannot drift.

### AdminRequiredError + adminRequiredResponse colocated in scoped.ts

Same pattern as OwnershipError + ownershipErrorResponse from Phase 3
of the OIDC epic. Routes that need admin gating import a single
file. The canned response returns 403 with body
{error: 'admin_required'}, distinct from 'forbidden' (cross-user)
and 'unauthenticated' (no session). Three codes for three failure
modes keeps the client side easy to special-case.

### Phase 2 does not call requireAdmin from any route

Per the plan: Phase 4 owns the route refactor. The helpers exist
and are testable but no consumer code references them yet. Grep
confirms: rg 'requireAdmin\b' src/app returns no matches.

---

## Phase 3: ModelRegistry reads providers from DB (impl agent)

Date: 2026-06-02

### chatModels and embeddingModels split out of the config blob on read

Phase 1's seed folded chatModels and embeddingModels into the providers
row's config blob so the single TEXT column held the whole payload. The
existing in-memory shape (ConfigModelProvider) had them as siblings of
config, not inside it. We resolve the impedance mismatch on the read
side: src/lib/db/providers.ts destructures them off the parsed blob and
exposes them as sibling fields on the returned StoredProvider type.
Callers (ModelRegistry, the provider classes) see them where they
expect to. The on-disk row is left as-is so the migration code path is
not coupled to the shape this commit cares about.

Alternative considered: leave them folded and refactor every consumer to
read from config.chatModels / config.embeddingModels. Rejected because
the leak surface for api_key in the config blob is exactly the consumer
set; pulling models out at the boundary keeps every consumer accessing a
clean models field with no temptation to dump the whole blob.

### BaseModelProvider gains chatModels / embeddingModels as protected fields

Each subclass used to look itself up by id via
getConfiguredModelProviderById to fetch its own chatModels list. With
the DB as source of truth that lookup would have to take a userId and
re-query for every getModelList call, which is wasteful and re-creates
the visibility filter at a layer that should not own it. We hoist the
lookup once into the registry, which passes the resolved arrays through
the constructor to the base class.

The subclasses' redundant explicit constructors (each was just calling
super(id, name, config)) are removed; the base class signature with
default empty arrays covers them. Type-narrowed config types are
preserved because the subclasses still parameterise
BaseModelProvider<CONFIG>.

### Registry mutation methods are stubs that throw

ModelRegistry.addProvider / updateProvider / removeProvider /
addProviderModel / removeProviderModel all throw with a message
naming Phase 4 as the rewrite target. The original implementations
delegated to configManager which in turn wrote to config.json; both
those paths are gone now (configManager's matching methods also throw).
Stubbing rather than silently no-oping means the /api/providers POST /
PATCH / DELETE routes (which Phase 4 owns) get a loud error if anyone
exercises them before Phase 4 lands, rather than a 200 that pretends
the write succeeded.

The frontend currently does call these routes (Settings dialog "Add
Provider" et al.). They were already broken in Phase 1 from the moment
config.json stopped being the source of truth for reads; Phase 3 makes
the failure mode explicit rather than letting writes silently land in
a file that nothing reads anymore.

### serverRegistry.ts reduced to a SearXNG shim

getConfiguredModelProviders / getConfiguredModelProviderById are gone.
getSearxngURL stays because the SearXNG URL is a global server setting
that lives in data/config.json (it has no per-user concept) and is
unrelated to the providers refactor. The file is one line plus a
comment now; we keep it instead of moving the function elsewhere so
the existing src/lib/searxng.ts import path stays valid without
churning a separate file move.

### Config.modelProviders kept as optional on the type

Removing the field from the Config type would break unrelated
consumers (SetupConfig.tsx, AddProviderDialog.tsx, the /api/config GET
handler, ConfigManager.getCurrentConfig()'s consumers in general).
Marking it optional keeps types compiling while signalling the
deprecation. The /api/config GET handler still surfaces a populated
modelProviders field on the wire by building it from the DB via
ModelRegistry.getActiveProviders, so frontends that depend on that
payload continue to work.

### On-disk config.json cleanup runs from instrumentation, not lazily

src/lib/config/cleanup.ts ships a one-shot stripStaleModelProvidersKey
helper invoked from src/instrumentation.ts, AFTER the migration runner
and BEFORE the configManager import. Order matters: configManager
reads config.json into memory on import, so the cleanup has to land
first or the in-memory copy will briefly hold a key the on-disk file
no longer has (or vice versa).

The helper is idempotent: it reads, checks for the key, deletes if
present, writes back. A second invocation finds no key and returns
early. Tolerant of corrupt JSON (leaves it for ConfigManager's own
initializer to handle, rather than piling on a second rewrite) and
missing files (no-op).

Partial-state file question: what if a future binary runs that still
writes modelProviders to config.json after this PR has removed it?
The cleanup will just strip it again on the next boot. The cost is
one extra fsync per boot in the (impossible after this PR) case where
modelProviders is somehow back in the file. Cheap, safe, idempotent.

### Corrupt provider rows are skipped with a warning, not thrown

src/lib/db/providers.ts wraps JSON.parse in try/catch. A row whose
config blob fails to parse is dropped from the returned list with a
console.warn. The alternative (throw and fail the whole list) was
rejected because one bad row would lock the user out of every
provider including healthy ones, which is the wrong failure mode for
an operator who hand-edited the DB or hit a partial write. The
warning is loud enough that the row will get noticed at the next
investigation.

### Sync read intentionally, no async wrapper

better-sqlite3 is synchronous and the ModelRegistry constructor needs
to populate activeProviders without awaiting (the prompt locked
"constructor takes a userId"). getProvidersForUser uses drizzle's
.all() in sync mode, which matches the existing migrate.ts pattern.
Phase 4's route handlers can wrap it in async with no transformation
cost.

Considered exposing both sync and async variants. Rejected because
the only consumer that benefits from async would be a non-existent
one (every existing call site is fine with sync).

### Visibility filter is WHERE userId IS NULL OR userId = ?

Phase 1's seed used userId = NULL for instance providers (verified by
SELECT on the local DB: the single backfilled row has userId IS
NULL). The plan called this out as the desired shape, and the
implementation matches. No special-casing for 'legacy' is needed in
the visibility filter because legacy is just another user id and any
providers created by the legacy user would correctly be visible only
to legacy. The instance providers are NULL-owned, visible to all.

### Verified by running the migration and constructing a registry

The local dev DB had migrations 0000..0003 applied. Running the
migration runner from this branch picked up 0004 cleanly, seeded one
instance provider from data/config.json (transformers, the only entry
present), and stamped the ran_migrations row. Constructing
new ModelRegistry('test-user-id') and calling getActiveProviders
returned the seeded provider with its full default embedding model
list. Constructing with userId 'legacy' returned the same provider,
confirming the instance visibility rule. The on-disk cleanup helper
ran twice in sequence; the first invocation removed the key, the
second was a no-op. yarn build was clean after each commit.

---

## Phase 4: scope-aware /api/providers routes (impl agent)

Date: 2026-06-01

### Direct DB writes from route handlers, no registry mutation path

ModelRegistry's Phase 3 mutation stubs (addProvider, updateProvider,
removeProvider, addProviderModel, removeProviderModel) and
configManager's matching methods are removed outright rather than
rewritten. New CRUD helpers in src/lib/db/providers.ts (createProvider,
updateProviderRow, deleteProviderRow, getProviderById,
canUserSeeProvider, canUserMutateProvider) handle the writes, and the
/api/providers route handlers call them directly. Routing writes
through the registry would re-create the pre-Phase 1 pattern of
access control being diffuse across layers; keeping the route as the
single source of truth for ownership/admin checks makes the gate
trivially auditable in code review.

### 403 not 404 for cross-user provider id access

Matches the Phase 3 chats precedent: when the id exists but the
caller cannot see it, return 403. The plan text initially called this
out as 404 in one spot; the locked decision (and what shipped) is 403
to avoid leaking the existence of a provider id that belongs to
another user. A true 404 is returned only when the id does not exist
anywhere in the table.

### Two distinct 403 bodies: ownership vs admin_required

When a non-admin tries to mutate an instance row, the response is
adminRequiredResponse ({error: 'admin_required'}). When a non-admin
tries to mutate someone else's personal row, the response is
ownershipErrorResponse ({error: 'forbidden'}). Both are 403 with the
same HTTP semantics; only the body differs so the frontend can render
"This is an admin-managed connection" vs "This is another user's
connection" without a second roundtrip. Server-side log scraping
benefits too: an admin_required spike is a signal that a non-admin is
hitting admin-only paths repeatedly, which is a different operator
concern from cross-user probing.

### Visibility predicate is OR-of-rules, mutation predicate is AND-stricter

canUserSeeProvider returns true if the row is instance-scope OR the
caller is admin OR the caller owns the row. canUserMutateProvider
drops the first clause: instance-scope rows require admin to mutate
even though every user can see them. The asymmetry is the whole point
of the admin/user split, so it lives in two predicates rather than
being reconstructed inline at every call site.

### Secret endpoint visibility is narrower than list endpoint

/api/providers/[id]/secret returns 403 to non-admin non-owners even
for instance rows. The list endpoint hides the api_key in its response
shape, so a non-admin user can see "the OpenAI instance connection
exists" without seeing the api_key. The secret endpoint exists for
edit flows; admins get the full payload (for editing any row), owners
get the full payload (for editing their own). Instance visibility
does NOT grant secret-read access because that would let every
authenticated user read the shared admin-managed api_key, which
defeats the purpose of an admin scope.

### Type is immutable at PATCH; idempotent model add

The PATCH route does not accept a `type` field; callers wanting a
different provider type delete and recreate. Two reasons: the type
determines which Provider subclass parses the config blob, so a type
swap with a stale config would either crash on load or silently
ignore valid fields; and the only operator who would legitimately
want to "change type" is hand-fixing a typo, which is rare enough
that delete-and-recreate is fine.

The POST on /api/providers/[id]/models is idempotent on the model
`key`: re-POSTing the same key replaces the previous entry rather
than appending a duplicate. The previous flow (via configManager)
deduped at write time; preserving that behavior avoids surprising the
frontend on retries.

### chats has no providerId FK; no cascading delete needed

src/lib/db/schema.ts shows the chats table has no foreign key to
providers. Provider DELETE therefore cannot orphan a chat at the
schema level. Chat messages reference providers implicitly through
backendId fields stored inside the messages.responseBlocks JSON, but
those are content (the model that generated each block); deleting a
provider does not invalidate the historical content, it just means
the chat cannot be continued without configuring a new provider. No
cascade is implemented and none is required. If a future schema adds
chats.providerId we will need to revisit this decision; for now the
delete path is purely a single-row DELETE on providers.

### MinimalProvider gets optional type + scope fields

Adding required fields would break any direct consumer of the type
(at least one usage in src/lib/hooks/useChat.tsx). Marking them
optional lets the GET /api/providers response carry the new metadata
without churning callers that build a MinimalProvider locally. The
registry always populates both fields when shaping the response, so
in practice every wire payload has them.

### Unknown provider type returns 400 on POST, not stored

The POST handler validates that body.type is a known key in the
providers map before inserting. The plan text did not call this out,
but storing an unknown type would create a permanently broken row
(every read attempt would hit the "Invalid provider type" branch in
the registry and silently skip it). Failing fast at write time
matches the parseAndValidate pattern the existing provider classes
already use for config validation.

### Verification

`yarn build` clean across all six commits. Verification greps from
the orchestrator brief all return the expected results: no
`addProvider`/`updateProvider`/`removeProvider`/`addProviderModel`/
`removeProviderModel` references remain anywhere in src/; no
`configManager.(add|update|remove)Provider*` references remain (only
the unrelated `configManager.updateConfig` for generic config writes);
`api_key` does not appear in src/app/api/providers/route.ts (the list
response shape excludes it). The /api/providers/[id]/secret route is
visible in the build output's route table.

---

## Phase 5: provider list scope UI + admin scope selector (impl agent)

Date: 2026-06-01

### isAdmin plumbing through /api/me, not a separate /api/me/admin endpoint

The hook layer already had a single network call per page load
(useCurrentUser with a module-level Promise cache). Adding a parallel
admin endpoint would double the round trips during page bootstrap for
zero functional gain. /api/me already loads the user row out of SQLite
via getUserById, which now returns the isAdmin column the schema added
in Phase 1, so the marginal cost is zero. The flag is explicitly UX-only
and is documented as such in both the route comment and the hook type;
every server-side mutation re-checks via requireAdmin / isUserAdmin so
a tampered client cannot escalate.

### scope field on ConfigModelProvider is optional, not required

Marking it required would break the /api/config code path that builds
the ConfigModelProvider list from the file-system config (which never
carried scope), and would surface a noisy TypeScript error for a path
that is being phased out anyway. Optional + a defensive default in
the consumer (treat undefined as 'personal') is the smaller diff. The
default of personal is safe because the list endpoint already filters
to rows the caller can see: an undefined-scope row reaching the UI must
have already passed the visibility predicate, and treating it as
personal merely re-enables the edit/delete buttons the user would
already have been entitled to use under either scope assumption.

### Scope badge palette: muted zinc/gray for Instance, sky accent for Personal

The Instance badge uses the existing light-200/dark-200 surface tokens
the codebase already uses for inactive chrome (settings dividers, etc.)
so it reads as neutral meta information rather than a call to action.
The Personal badge reuses the sky tint already applied to the plug
icon and primary action buttons elsewhere in the provider list, so a
user scanning their own connections gets a subtle but consistent visual
anchor on the rows they own. Both badges use existing tokens; no new
Tailwind color was introduced.

### Add Provider modal scope default for admin: Instance

Locked decision per the prompt. The historical Add Provider flow (pre
admin/user split) always created what is now an instance row, so
defaulting admins back to Instance preserves the muscle memory of
existing operators. Personal is a one-click opt-in for admins who want
to add a key they pay for personally.

### Two-button toggle, not radio or Select

The choice is binary, and the codebase has no shared two-option toggle
component. A native radio group would have required custom styling to
match the existing dark-mode tokens; the Select component the modal
already uses for connection-type renders as a dropdown which felt
heavier than the choice warrants. Two side-by-side buttons make both
options visible at a glance, match the modal's existing button styling,
and add ~25 lines without pulling in a new dependency.

### 403 error mapping happens inline in the dialog, not in a shared util

Only one call site in the Phase 5 scope produces a user-facing 403
(POST /api/providers from the Add modal). UpdateProvider and
DeleteProvider can also 403 but their buttons are hidden for rows the
caller cannot mutate, so the practical paths that surface 403 to a
toast are limited to the modal. Inlining the mapping keeps the
exception-to-message translation co-located with the only handler that
needs it. If Phase 6 adds Personal/Instance settings panels with their
own POST/PATCH/DELETE flows, that is the moment to extract a shared
parseProviderErrorBody helper.

### Modal stays open on 403, closes on success

The original handler closed the modal in the `finally` block, which
discarded the form state even on errors. For a non-admin who hits
admin_required (a tampered or stale client state where the toggle was
shown despite isAdmin being false) the original behavior would have
lost their input and required re-typing the connection details. Moving
setOpen(false) into the success branch only is a strict UX improvement
with no security implication: the form remains client-side until the
user closes or retries.

### canMutate gating extends to per-model X buttons and AddModel button

The header edit/delete are the obvious affordances, but the per-model
delete X buttons and the AddModel button inside the panel both call
/api/providers/[id]/models, which is scoped the same way (admin or own
personal). Leaving those visible to non-admins on instance rows would
mean the user clicks an apparently-live button and gets a generic
toast error from the network layer. Gating all four affordances on the
same canMutate boolean makes the panel read consistently as
read-only or fully interactive, no half-states.

### Verification

`yarn build` clean. Grep audit
`rg "scope === 'instance'|scope === 'personal'" src/`
returns the expected hits in the providers route, the ModelProvider
component (badge + canMutate), and the AddProvider modal (toggle
styling branches). /api/me response now includes isAdmin and the
useCurrentUser hook surfaces it on the CurrentUser interface. Phase 6
(new Settings panels) and Phase 7 (welcome-screen removal) remain
untouched.

