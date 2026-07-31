# CLAUDE.md

Working context for Claude Code sessions on **The Best Backgammon App**. Read this
first, then reach for the deeper docs under [`docs/`](docs/) when you need them.

> **Ground rule for this file and all docs:** describe what *exists* in the code.
> Anything intended-but-unbuilt lives under a **Planned / Not Yet Implemented**
> section so a session can tell "work with this" from "don't assume it's there."

## Default working mode: delegate wide, keep the main thread thin

**This is how sessions on this repo are expected to run.** The main thread is a
coordinator, not a reader. Its context should hold the plan, the decisions, and
the final diff — not the raw material used to get there.

- **Delegate any task whose *inputs* are bigger than its *output*.** Surveying a
  directory, auditing docs against code, tracing a flow across both clients,
  running a test suite, checking whether a claim is still true — all of that is
  subagent work. The main thread receives the conclusion.
- **Give every agent exclusive file ownership.** Name the exact files it may
  edit and tell it which files other agents own. Parallel agents are safe only
  when their write sets are disjoint. Read overlap is fine.
- **Fan out in one message.** Independent agents launch in parallel; sequence
  them only on a real data dependency.
- **Cap the report.** Ask for a word limit (200–400) and specify exactly which
  facts must come back. An agent that returns file dumps has defeated the point.
- **Keep the integration work in the main thread.** Cross-cutting files that
  need a single coherent voice — this file, [`README.md`](README.md) — get
  edited by the coordinator after the reports land, never by a fan-out agent.

Do the work directly when it is genuinely small (one known file, a targeted
edit, a question you can answer from this file). Delegation has a fixed cost;
spending it to avoid reading two files is a loss.

## Who the docs are for

Optimise `docs/` for **agent consumption first**: dense, specific, verifiable,
heavy on relative source links and exact symbol names, with the ground rule
above enforced so nothing is trusted that isn't real. Human readability is a
secondary goal there and a *primary* one in [`README.md`](README.md) — that file
is the human's front door and should stay welcoming and prose-y.

## What this is

A full-stack backgammon app: one Django REST backend shared by **two clients** — a
React web app and a React Native (Expo) mobile app. It supports hotseat play,
online games via shareable links, user accounts with JWT auth, single games and
match play (first to N points), gammon/backgammon scoring, and the doubling cube
(with the Crawford rule in matches).

Both clients re-implement the same pure game logic locally (for legal-move
highlighting and tentative "staged" turns) and send committed turns to the
backend, which re-validates everything authoritatively.

## Tech stack

| Part | Stack |
|------|-------|
| Backend | Django 4.2 + Django REST Framework, `djangorestframework-simplejwt`, `django-cors-headers`. **SQLite** (dev). WSGI. |
| Web | React 18 (Create React App / `react-scripts` 5), `react-router-dom` 6. Dev server proxies `/api/*` to `:8000`. |
| Mobile | Expo SDK 56 (React Native 0.85, React 19), Expo Router (file-based), `react-native-svg` board, `expo-secure-store`. Landscape-locked. EAS build config present. |

## Repo structure

```
backend/    Django REST API (shared by both clients)
  backgammon/   settings (env-driven) + root urls + health.py
  game/         models.py, serializers.py, views.py, game_logic.py, urls.py, tests/
frontend/   React web client  (src/: api/ components/ hooks/ pages/ context/ utils/)
mobile/     Expo mobile client (app/: router screens; src/: api/ components/ game/ context/)
docs/       architecture/ + operations/ + legal/ + decisions/  (see below)
.github/    CI workflow running all three test suites
Dockerfile  Procfile  .dockerignore   deploy scaffolding (gunicorn, host-agnostic)
railway.json                          Railway builder + healthcheck config
README.md   user-facing setup & feature overview
```

The **canonical game engine** is [`backend/game/game_logic.py`](backend/game/game_logic.py).
It is ported to JS twice — [`frontend/src/utils/gameLogic.js`](frontend/src/utils/gameLogic.js)
and [`mobile/src/game/logic.js`](mobile/src/game/logic.js). **These three files must
stay in sync**; change one and mirror the others.

## Running locally

**Backend** (from `backend/`, with the venv active):
```bash
python manage.py migrate
python manage.py runserver          # http://localhost:8000/api/
```
The venv lives at `backend/venv/`; Django is invoked as
`backend/venv/Scripts/python.exe` directly.

**Node on this Windows machine.** POSIX nvm is cloned at `~/.nvm` (Node v22.9.0
and v20.3.0, `default` alias → `node`). As of 2026-07-25 it is wired up: `~/.bashrc`
sources `nvm.sh` and `~/.profile` sources `~/.bashrc`, and Node's bin directory is
on the Windows user PATH. Practical consequences:

- A **fresh** shell (new terminal, new session) has `node`/`npm` — just run them.
- A **login** bash shell always works: `bash -lc 'node -v'`.
- `$NVM_DIR` is only set *after* the profile loads — don't write
  `. "$NVM_DIR/nvm.sh"` blind; it silently no-ops in a shell that hasn't sourced
  the profile. Use `. "$HOME/.nvm/nvm.sh"` or the explicit PATH prefix
  `export PATH="$HOME/.nvm/versions/node/v22.9.0/bin:$PATH"` as the fallback.

**Web** (from `frontend/`): `npm install && npm start` → http://localhost:3000
(requests to `/api/*` proxy to Django).

**Mobile** (from `mobile/`): `npm install && npm start`, then `i`/`a` or scan in
Expo Go. The client auto-detects the dev-machine LAN IP from Metro; the backend
must be reachable (`runserver 0.0.0.0:8000` and add the host to `ALLOWED_HOSTS`).
Override the host via `MANUAL_OVERRIDE` in [`mobile/src/api/config.js`](mobile/src/api/config.js).

See [`README.md`](README.md) for the full device matrix and EAS build commands.

## Configuration (all env-driven, dev needs none)

**Nothing needs configuring for local dev** — every var has a working default and
no `.env` file is required. That property is load-bearing; preserve it.

- **Backend** reads env via `os.environ` in [`settings.py`](backend/backgammon/settings.py)
  (with optional `.env` loading through `python-dotenv`). Vars are documented in
  [`backend/.env.example`](backend/.env.example): `SECRET_KEY`, `DEBUG`,
  `ALLOWED_HOSTS`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`,
  `CSRF_TRUSTED_ORIGINS`, `THROTTLE_RATE_*`, `LOG_LEVEL`, and serving vars
  (`PORT`, `WEB_CONCURRENCY`). `SECRET_KEY` falls back to the old dev key **only**
  under `DEBUG`; with `DEBUG=False` a missing key raises `ImproperlyConfigured`.
- **Security settings are gated on `DEBUG`.** SSL redirect, HSTS, secure cookies,
  nosniff, and `X_FRAME_OPTIONS` apply only when `DEBUG=False`.
  `manage.py check --deploy` reports **0 issues** in that mode.
- **Database** resolves through `dj-database-url` from `DATABASE_URL`, defaulting
  to the same SQLite file as before. Postgres needs only the env var — the driver
  is already installed.
- **Web** resolves its API base from `REACT_APP_API_BASE_URL`
  ([`frontend/src/api/config.js`](frontend/src/api/config.js)), defaulting to `""`
  so the CRA dev proxy is unchanged.
- **Mobile** resolves in this order: `MANUAL_OVERRIDE` → `EXPO_PUBLIC_API_URL` →
  `expoConfig.extra.apiUrl` → Metro `hostUri` (dev only) → loopback (dev only) →
  hard configuration error ([`mobile/src/api/config.js`](mobile/src/api/config.js)).
  A release build with no configured host now **throws a readable error at the
  first API call** instead of silently pointing at localhost, and rejects
  non-`https` production URLs.

`/healthz/` ([`health.py`](backend/backgammon/health.py)) is unauthenticated and
does a `SELECT 1`; it returns 503 if the DB is unreachable. The root
`Dockerfile` and `Procfile` run gunicorn and stay host-agnostic; the Dockerfile
`CMD` binds Railway's injected `$PORT` and runs `migrate` before `exec`-ing
gunicorn as PID 1.

**Deploy target is Railway** (decided 2026-07-31; the owner's `howl` project runs
there). [`railway.json`](railway.json) pins the **Dockerfile** builder — *not*
Railpack, which is what `howl` uses — sets `healthcheckPath: /healthz/`, and
scopes `watchPatterns` to `backend/**` so client- and docs-only commits don't
redeploy the API. The runbook is
[railway-deploy.md](docs/operations/railway-deploy.md). Two traps recorded there:
Railway probes the health check from an internal host, so `ALLOWED_HOSTS` needs
`healthcheck.railway.app` alongside `${{RAILWAY_PUBLIC_DOMAIN}}` or the probe
400s while logs look healthy; and the filesystem is **ephemeral**, so SQLite
would be wiped every deploy — Postgres is mandatory there, not optional.

## Tests

| Suite | Count | Command (cwd) |
|-------|-------|---------------|
| Backend | **314** | `python manage.py test game` (`backend/`, in-memory DB) |
| Web | **207** | `CI=true npm test -- --watchAll=false` (`frontend/`) |
| Mobile | **114** | `CI=true npx jest` (`mobile/`) |

CI runs all three on push and PR — [`.github/workflows/ci.yml`](.github/workflows/ci.yml),
one job per suite.

Backend tests live in [`backend/game/tests/`](backend/game/tests/) (models, views,
auth, lobby, match, serializers, logic). Web tests sit beside sources in
`__tests__/` dirs; mobile likewise under `src/**/__tests__/`.

Auth has full client + server coverage: backend `test_auth.py`; web
`api/__tests__/authApi.test.js` + `apiClient.test.js` + `pages/__tests__/LoginPage.test.jsx`;
mobile `api/__tests__/{tokenStore,auth,client}.test.js`. See [auth.md](docs/architecture/auth.md)
for the map.

All three suites were **green as of 2026-07-31** (314 / 207 / 114, 635 total, zero
failures). If you see a failure, it is yours — the baseline is clean.

> **Throttling is disabled under test** (`"test" in sys.argv` in
> [`settings.py`](backend/backgammon/settings.py)), so auth tests don't trip the
> rate limiter. Tests that need it re-enable it with `@override_settings`; see
> `OptionalScopedRateThrottle` in [`views.py`](backend/game/views.py), which
> reads rates live because DRF otherwise binds `THROTTLE_RATES` at import time.

> **The two JS suites take different invocations, and swapping them fails
> confusingly.** `frontend/` is Create React App: the Babel/jest transform only
> exists inside `react-scripts test`, so bare `npx jest` there fails *all* suites
> with `SyntaxError: Cannot use import statement outside a module` and runs zero
> tests. Use `npm test --`. `mobile/` is the opposite — bare `npx jest` is
> correct. The web run also emits harmless React Router v7 future-flag
> deprecation warnings; ignore them.

## Coordinate conventions (critical — get these right)

Board is `points[24]` (index = point − 1), plus `bar` and `off` counts per player.

- Positive values = **p1** checkers, negative = **p2**.
- `from_point == 0` = enter from the bar; `to_point == 25` = bear off.
- **p1** moves toward increasing points (home = 19–24); **p2** toward decreasing
  (home = 1–6).
- Bear-off distance: p1 = `25 − from_point`, p2 = `from_point`.

## Key conventions & non-obvious decisions

- **Staging model.** A turn is built up as tentative "pending moves" against a
  local board copy, then committed in one `confirm_turn` call. Each pending move
  consumes exactly one die, so `len(pendingMoves)` == dice used. See
  [game-logic.md](docs/architecture/game-logic.md).
- **Combined (multi-die) moves are client-only.** The UI lets you drag one checker
  several dice at once; the client expands that into sequential single moves before
  sending. The backend has no notion of a combined move — it re-validates each
  single hop. See [ADR-001](docs/decisions/adr-001-combined-moves.md).
- **Maximal dice usage is enforced server-side** in `confirm_turn` via
  `max_moves_usable` (a recursive search over move orders), and mirrored on the
  clients purely as a Confirm-button affordance. The server is authoritative.
- **`move_checker` endpoint exists but no client uses it.** Both clients drive the
  staging → `confirm_turn` flow. It still has API wrappers and tests; treat it as
  legacy, not the live path.
- **Seat/turn ownership is enforced server-side** on **five** actions —
  `roll_dice` / `move_checker` / `confirm_turn` / `offer_double` /
  `respond_to_double`. `_seat_permission_error` in
  [`views.py`](backend/game/views.py) returns **403** when the current-turn seat is
  owned by a registered user and the requester isn't that user, and when another
  logged-in account touches a guest seat. It normally checks `current_turn`, but
  `respond_to_double` passes an explicit seat — the *offerer's opponent* — since
  answering a double isn't the offerer's turn. **Guest seats (null user FK) are
  unverifiable** — anonymous requests on them are allowed by design (hotseat/guest
  play). Client gating on top of that is UX: mobile hides controls via
  [`gating.js`](mobile/src/game/gating.js) + a device-local seat registry; the
  **web UI does not gate** (unauthorized clicks surface the server's 403).
  Note `next_game` is **not** covered — see Known gaps.
- **Web online play is doubly degraded**: no auto-refresh *and* no client-side
  gating. A web player must reload manually to see an opponent's move or a
  pending double, and discovers an out-of-turn action only as a 403 error.
  Mobile has both polling and gating. Treat web online play as the weaker path.
- **Confirming zero pending moves is the pass mechanism** (`confirm_turn` with an
  empty list). It is accepted *only* when `max_moves_usable == 0` — otherwise
  400. Mobile relabels the button "Pass Turn" when appropriate; web does not.
- **Doubling cube state is seat-based.** `Game.cube_owner` and
  `double_offered_by` hold `"p1"`/`"p2"`/null (like `current_turn`/`winner`), *not*
  user FKs — guests have no User row. A pending offer (`double_offered_by` set)
  blocks all gameplay actions until answered via `respond_to_double`. A dropped
  double finishes the game with `win_type="drop"` at the pre-double cube value;
  board wins score `win_points × cube_value`. Crawford games are flagged per-game
  (`crawford_game`), assigned in `next_game` when a player first reaches
  match point (`match.games.filter(crawford_game=True)` marks it already played).
- **Stats are computed on read**, not stored — see `UserSerializer` in
  [`serializers.py`](backend/game/serializers.py).

## Known gaps

> Security- and launch-blocking items are catalogued with file/line evidence in
> [going-live.md](docs/operations/going-live.md). The list below is what a coding
> session needs to keep in mind day to day.

- **`GET /api/games/` is still unauthenticated and unscoped.** Pagination now
  bounds each response, but an anonymous caller can page through every game row
  (board state, player names, user ids). Scoping the list to open games or the
  requester's own would break guest hotseat resume, so it was left open
  deliberately — see [going-live.md](docs/operations/going-live.md).
- **A closed seat deadlocks its game, and no client says so.** Account deletion
  now sets `player1_deleted`/`player2_deleted` on `Game` and `Match`, and seat
  enforcement 403s that seat for *everyone* — including the surviving opponent,
  who would otherwise be able to play both sides. The deliberate consequence: an
  in-progress game **cannot proceed** once it is the closed seat's turn. That
  beats auto-forfeit, which would award points nobody won and corrupt match
  scores. What's missing is the product half — neither client reads the flags to
  say "your opponent deleted their account", and there is no abandon/resign
  endpoint for the survivor.
- **Throttle counters are per-process.** No `CACHES` entry, so DRF falls back to
  `LocMemCache` and limits are per-gunicorn-worker, not global.
- **Clients don't model the higher-die rule**, so a client can happily stage a
  bear-off turn that the server then rejects with 400.
- **Higher-die rule enforced only during bear-off.** `higher_die_required_moves`
  (server-only, no JS port) forces the higher die at `confirm_turn` when exactly
  one die is playable while bearing off. The official rule is *general* — in
  blocked non-bear-off positions the lower single die is still accepted. See
  [game-logic.md](docs/architecture/game-logic.md).
- **App store submission pending.** EAS build/submit profiles are configured
  (`mobile/eas.json`, bundle id `com.magicdevereaux.backgammon`) but no store
  submission has happened.
- **Guest seats are unverifiable.** Server-side seat enforcement (see above) can't
  authenticate a guest seat — a logged-out attacker can act on one anonymously.
  Closing this needs a guest token/session concept.
- **No automated matchmaking.** Online play is manual: create a game and share its
  link/code, or join one from the open-games list. There is no matchmaking queue /
  auto-pairing / ranking. Documented in
  [overview.md](docs/architecture/overview.md#planned--not-yet-implemented) and
  listed under Planned below.

## Deeper docs

Index with contribution rules: [docs/README.md](docs/README.md).

- [docs/architecture/overview.md](docs/architecture/overview.md) — how web, mobile,
  and backend relate; auth; online multiplayer; sync.
- [docs/architecture/api.md](docs/architecture/api.md) — **full HTTP reference**:
  every route, request/response shape by serializer, per-endpoint error tables
  with real codes and messages, the seat-permission matrix. Check here before
  reading `views.py`.
- [docs/architecture/clients.md](docs/architecture/clients.md) — map of both
  clients: counterpart file table, staged-turn flow with real state names,
  routes, token storage, gating, rendering, engine duplication.
- [docs/architecture/auth.md](docs/architecture/auth.md) — accounts, JWT endpoints,
  client token lifecycle + refresh-retry, auth test map, security limitations.
- [docs/architecture/game-logic.md](docs/architecture/game-logic.md) — the rules
  engine, combined-move DFS, maximal-dice enforcement.
- [docs/architecture/data-model.md](docs/architecture/data-model.md) — Django
  models and schema.
- [docs/operations/going-live.md](docs/operations/going-live.md) — production
  readiness: blocked-on-owner, still-open-in-code, and done, with file/line
  evidence. **Start here** before any launch work.
- [docs/operations/railway-deploy.md](docs/operations/railway-deploy.md) —
  step-by-step Railway runbook: service creation, Postgres plugin and
  `DATABASE_URL`, every env var, migrations, superuser, domain, smoke test.
- [docs/legal/](docs/legal/README.md) — **draft** privacy policy and terms, written
  against what the code actually collects. Full of `[TODO]` markers needing the
  owner's real details; both stores require the policy at a live public URL.
- [docs/decisions/adr-001-combined-moves.md](docs/decisions/adr-001-combined-moves.md).

## Planned / Not Yet Implemented

These are intended but **do not exist in the code today** — don't assume them:

- **A running deployment.** Nothing is hosted yet. The app is *deployable* and
  the target is chosen (Railway, with `railway.json` committed), but **no deploy
  has run**: no service, no domain, no TLS, no production env values.
  **Postgres is wired but unused** — `psycopg2-binary` and `dj-database-url` are
  installed and `DATABASE_URL` is honoured, yet every environment today still
  resolves to the dev SQLite file, and the migrations have only ever been applied
  against SQLite. Verify them on an empty Postgres before cutting over.
- **A hosted web client.** The plan is Vercel with `REACT_APP_API_BASE_URL` set at
  build time (mirroring `howl`), but nothing is deployed and no build pipeline for
  the web client exists.
- **WebSockets / real-time push.** There is no Channels/ASGI setup. Opponent moves
  are synced by **mobile polling** (~3.5s in [`mobile/src/game/useGame.js`](mobile/src/game/useGame.js));
  the **web client has no auto-refresh** (manual reload). A socket layer is future work.
- **Automated matchmaking.** No auto-pairing queue, ranking/ELO, or "quick play vs
  a random opponent." Online pairing is always player-initiated via link/code or the
  open-games list. See [overview.md](docs/architecture/overview.md#online-multiplayer).
- **Chat.** No chat feature exists anywhere.
- **httpOnly cookie auth.** Auth is JWT **Bearer** tokens stored in `localStorage`
  (web) and `expo-secure-store` (mobile). Cookie-based sessions are not implemented.
