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
