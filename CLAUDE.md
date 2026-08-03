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

## The engine exists three times over

The **canonical game engine** is [`backend/game/game_logic.py`](backend/game/game_logic.py).
It is ported to JS twice — [`frontend/src/utils/gameLogic.js`](frontend/src/utils/gameLogic.js)
and [`mobile/src/game/logic.js`](mobile/src/game/logic.js). **These three files must
stay in sync**; change one and mirror the others.

There is a **second, smaller sync obligation**: the seat predicates
`isSeatClosed` / `isDeadlocked` / `blockedSeat` — and now **`canClaimTimeout`** —
exist in both [`mobile/src/game/gating.js`](mobile/src/game/gating.js) and
[`frontend/src/utils/seats.js`](frontend/src/utils/seats.js) — the web copy is a
verbatim port carrying a stay-in-sync header comment. They must agree with each
other *and* with the server, which derives the same seat in `abandon`,
`claim_timeout`, and the `Game.waiting_seat` property. Change one, change all
three.

`canClaimTimeout` carries an extra rule: **it must never re-derive eligibility.**
Whether a claim is possible at all (active game, no closed seat, no guest seat, a
clock recorded) is decided *only* by the server returning a non-null
`turn_deadline`. A client that second-guesses that will drift from the server the
moment either changes.

## Configuration (all env-driven, dev needs none)

**Nothing needs configuring for local dev** — every var has a working default and
no `.env` file is required. That property is load-bearing; preserve it. The vars
themselves are documented in [`backend/.env.example`](backend/.env.example). Two
behaviours you can't read off that file:

- **`SECRET_KEY` falls back to the old dev key only under `DEBUG`.** With
  `DEBUG=False` a missing key raises `ImproperlyConfigured` at startup.
- **The security settings are gated on `DEBUG`.** SSL redirect, HSTS, secure
  cookies, nosniff, and `X_FRAME_OPTIONS` apply only when `DEBUG=False`.
  `manage.py check --deploy` reports **0 issues** in that mode.
- **`TURN_TIMEOUT_HOURS` (default 48)** is how long a seat may sit on the clock
  before its opponent can claim a forfeit. Env-driven, defaulted, so dev needs no
  `.env`. See [ADR-002](docs/decisions/adr-002-inactivity-forfeit.md).
- **`ADMIN_URL` moves the Django admin off its predictable path**, defaulting to
  `"admin"` so dev still needs no `.env`. `env_url_path()` in
  [`settings.py`](backend/backgammon/settings.py) strips slashes and whitespace
  and falls back to the default on a blank value, so the admin can never end up
  mounted at the site root. Obscurity, not security — it removes the app from
  automated `/admin/` scanners and nothing more. DRF throttles still do **not**
  cover the admin login form.

Client-side API host resolution lives in [`frontend/CLAUDE.md`](frontend/CLAUDE.md)
and [`mobile/CLAUDE.md`](mobile/CLAUDE.md), which load when you work in those
directories.

`/healthz/` ([`health.py`](backend/backgammon/health.py)) is unauthenticated and
does a `SELECT 1`; it returns 503 if the DB is unreachable. The root
`Dockerfile` and `Procfile` run gunicorn and stay host-agnostic; the Dockerfile
`CMD` binds Railway's injected `$PORT` and runs `migrate` before `exec`-ing
gunicorn as PID 1.

Deploy target is **Railway** — runbook and its traps in
[railway-deploy.md](docs/operations/railway-deploy.md) (or the `railway-deploy` skill).

## Tests

| Suite | Count | Command (cwd) |
|-------|-------|---------------|
| Backend | **531** | `python manage.py test game` (`backend/`, in-memory DB) |
| Web | **364** | `CI=true npm test -- --watchAll=false` (`frontend/`) |
| Mobile | **247** | `CI=true npx jest` (`mobile/`) |

All three suites were **green as of 2026-08-02** (531 / 364 / 247, 1142 total, zero
failures). If you see a failure, it is yours — the baseline is clean.

> **Use `backend/venv/Scripts/python.exe`**, not bare `python` — the system
> interpreter has no `dj_database_url` and dies at import.

> **The backend suite is also green on Postgres 16**, not just SQLite — all 35
> migrations apply clean to an empty database and all 531 tests pass there, and
> the `0005` backfill was exercised against real rows. See
> [postgres-readiness.md](docs/operations/postgres-readiness.md).

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
- **`move_checker` is gone.** It applied a single move immediately and no client
  used it; both clients drive the staging → `confirm_turn` flow, which is now the
  only path that mutates a board. Nine tests that used it merely as a convenient
  one-shot rules harness were repointed at `confirm_turn` rather than deleted.
- **Seat/turn ownership is enforced server-side** on **six** actions —
  `roll_dice` / `confirm_turn` / `offer_double` / `respond_to_double` /
  `abandon` / `claim_timeout`. `_seat_permission_error` in
  [`views.py`](backend/game/views.py) returns **403** when the current-turn seat is
  owned by a registered user and the requester isn't that user, and when another
  logged-in account touches a guest seat. It normally checks `current_turn`, but
  `respond_to_double` passes an explicit seat — the *offerer's opponent* — since
  answering a double isn't the offerer's turn, and `claim_timeout` likewise
  passes the *claimant* seat, i.e. the opponent of whoever is on the clock. **Guest seats (null user FK) are
  unverifiable** — anonymous requests on them are allowed by design (hotseat/guest
  play). Client gating on top of that is UX: mobile hides controls via
  [`gating.js`](mobile/src/game/gating.js) + a device-local seat registry; the
  **web UI does not gate** (unauthorized clicks surface the server's 403).
  Note `next_game` is **not** covered — see Known gaps.
- **Both clients now poll ~3.5s**, web included
  ([`useGame.js`](frontend/src/hooks/useGame.js),
  [`mobile/src/game/useGame.js`](mobile/src/game/useGame.js)). A tick is skipped
  while moves are staged, when the game is finished or deadlocked, and for local
  games. Web still **does not gate controls** the way mobile does, so an
  out-of-turn action there surfaces as the server's 403 — that half of the old
  "doubly degraded" warning stands. Web also has no seat registry, so
  `isOnlineGame` in [`seats.js`](frontend/src/utils/seats.js) infers online-ness
  from the payload and deliberately errs toward *not* polling; a logged-in player
  whose opponent joined as a guest is indistinguishable from hotseat.
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
- **Every mutating action runs in `transaction.atomic()` and locks its row
  first.** `RowLockingMixin._locked_object()` in
  [`views.py`](backend/game/views.py) does `get_object()` (unchanged 404
  semantics) then re-reads under `select_for_update()`. **The guards are then run
  against the freshly-locked row — that ordering is the whole point.** A guard
  checked *before* the lock is worthless, so never hoist one out. Lock order is
  **game → match** everywhere; `next_game` is the only match-first path and never
  goes on to lock a game, so there is no ABBA deadlock. `_apply_game_result`
  takes the match lock itself and assumes its callers already hold the game lock
  inside their own transaction — don't wrap it in a second atomic block. This
  fixed two live bugs, not just theoretical ones: a double-submitted `next_game`
  inserted a permanent second game, and a replayed winning `confirm_turn` could
  score a match twice.

## Known gaps

> Security- and launch-blocking items are catalogued with file/line evidence in
> [going-live.md](docs/operations/going-live.md). The list below is what a coding
> session needs to keep in mind day to day.

- **`GET /api/games/` bounds enumeration, not access.** The `list` action is now
  scoped by `_list_scope_q` in [`views.py`](backend/game/views.py) to open lobby
  games + the requester's own + fully-guest games (that last clause is what keeps
  guest hotseat resume working without an account, and such rows carry no PII).
  But **`retrieve` by id is still open to everyone** — link sharing is how online
  games are joined at all — so anyone holding a game id can still read its full
  state. Deliberate; the scoping stops the anonymous walk of the whole table.
- **A closed seat deadlocks its game — now explained, with an exit.** Account
  deletion sets `player1_deleted`/`player2_deleted` on `Game` and `Match`, and
  seat enforcement 403s that seat for *everyone*, including the surviving
  opponent, who would otherwise play both sides. The game genuinely cannot
  proceed; that still beats auto-forfeit, which would award points nobody won and
  corrupt match scores. Both clients now read the flags, replace the turn banner
  with an explanation, and stop polling, and
  **`POST /api/games/{id}/abandon/`** gives the survivor a non-scoring exit
  (`win_type="abandoned"`, no winner, no score change). It also finishes the
  match, because `next_game` copies the closure flags and would otherwise mint an
  endless series of dead-on-arrival games. Both clients offer the control to the
  surviving seat only. Note the blocked seat is `current_turn` *except* with a
  double pending, where it is the responder — all three of `gating.js`,
  `seats.js` and the server's `abandon` derive it the same way.
- **A walked-away player no longer strands a game.** `Game.turn_started_at` is
  written by `_begin_turn` wherever the *waiting* seat changes — game activation,
  `confirm_turn`, `offer_double`, `respond_to_double` on a take, and `next_game`.
  It deliberately does **not** reset on `roll_dice`; one deadline covers
  roll-and-move together, or a player could roll and then stall forever on a
  fresh clock. After `TURN_TIMEOUT_HOURS` the opponent may
  `POST /api/games/{id}/claim_timeout/` for a `win_type="timeout"` win worth
  `1 × cube_value`. **Registered seats only** — a guest seat is unverifiable, so
  otherwise anyone with the game id could claim. A closed seat 400s and is sent
  to `abandon` instead, so a deadlock can never be laundered into a scoring win.
  **One account may not hold both seats**, enforced in two places: both `join`
  actions 400 a self-join, and `Game.timeout_deadline` independently refuses a
  same-account row. That belt-and-braces is deliberate — with two registered
  seats the row *is* claimable and `_seat_permission_error` passes the claim,
  because the idle seat's user is the requester, so the account would farm
  timeout wins against itself. Hotseat is unaffected: those games are created
  with both names, start `active`, and leave p2 a guest seat, so they never
  reach `join`.
  **Three residual gaps, all known and deliberate:**
  1. **Nothing notifies a player that their clock is running** — no push, no
     email. The clients show a countdown, but only while the app is open.
  2. **No server clock reference is sent.** `turn_deadline` goes out but
     `server_now` does not, so both clients compare it against the *device*
     clock. A device running hours fast shows the claim button early and then
     eats a 400 that reads like a server bug, or tells a player their time is up
     when it isn't. Fix is to serialise `server_now` and apply the offset — the
     clients already isolate the comparison, so it is a contained change.
  3. **The claim-vs-move race gives the mover a misleading error.** `claim_timeout`
     takes the row lock first, so a `confirm_turn` arriving in the same instant
     blocks, then reads `status="finished"` and gets `400 "Game is not active."` —
     i.e. the player who *did* move in time sees a confusing message and then
     polls into a loss. Correct, but poor copy; neither client special-cases it.
     (The reverse order is graceful and the UI is not stuck in either client.)
- **Throttle counters are per-process *unless* `REDIS_URL` is set.** `CACHES` is
  env-driven: a set `REDIS_URL` selects `RedisCache` and makes limits global,
  unset falls back to `LocMemCache`, which is per-gunicorn-worker and wiped on
  restart. With the default 3 workers and no Redis, `login` 10/hour behaves like
  ~30/hour. Nothing is provisioned yet, so today the fallback is what runs.
- **The higher-die rule is now general and modelled everywhere.**
  `higher_die_required_moves` fires at `confirm_turn` in any position — mid-board
  and bar-entry included, not just bear-off — whenever exactly one die is usable
  and both are individually playable. It is ported to both JS engines as
  `higherDieRequiredMoves`, so the clients gate Confirm on it instead of staging
  turns the server would 400. The server remains authoritative. See
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

Annotated index with contribution rules: [docs/README.md](docs/README.md) — start
there. Two entries are worth naming here:
[api.md](docs/architecture/api.md) is the full HTTP reference (read it before
`views.py`), and [going-live.md](docs/operations/going-live.md) is the production
readiness ledger — start there before any launch work.

## Planned / Not Yet Implemented

These are intended but **do not exist in the code today** — don't assume them:

- **A running deployment.** Nothing is hosted yet. The app is *deployable* and
  the target is chosen (Railway, with `railway.json` committed), but **no deploy
  has run**: no service, no domain, no TLS, no production env values.
  **Postgres is wired and now verified, but still unused** — `psycopg2-binary`
  and `dj-database-url` are installed, `DATABASE_URL` is honoured, and the
  migrations and full suite have been run green against a real Postgres 16
  ([postgres-readiness.md](docs/operations/postgres-readiness.md)). But every
  environment today still resolves to the dev SQLite file, so nothing is *running*
  on Postgres yet.
- **A hosted web client.** The plan is Vercel with `REACT_APP_API_BASE_URL` set at
  build time (mirroring `howl`), but nothing is deployed and no build pipeline for
  the web client exists.
- **WebSockets / real-time push.** There is no Channels/ASGI setup. Opponent moves
  are synced by **polling on both clients** (~3.5s), not pushed. A socket layer is
  future work.
- **A mobile deep link for the reset email.** Password reset is built end to end:
  both clients collect an optional email and can request a reset, and the web
  client serves `/forgot-password` and `/reset-password/:uid/:token`. But the
  emailed link is built from `FRONTEND_BASE_URL`, i.e. the **web** client, and
  there is no app deep link — so a mobile user finishes the reset in a browser.
- **Automated matchmaking.** No auto-pairing queue, ranking/ELO, or "quick play vs
  a random opponent." Online pairing is always player-initiated via link/code or the
  open-games list. See [overview.md](docs/architecture/overview.md#online-multiplayer).
- **Live game clocks.** The *per-turn deadline* is built (see Known gaps), but
  reserve-time clocks are not: no accumulated per-player time, no increment or
  delay, no mode selection at game creation, no clock UI beyond the deadline
  countdown. [ADR-002](docs/decisions/adr-002-inactivity-forfeit.md) explains why
  this waits — sudden death is the wrong clock shape for backgammon (tournaments
  use delay/Bronstein because so many turns carry no decision), and live play
  needs a **presence** concept that does not exist, or it would forfeit players
  who never knew the game had started.
- **A background sweeper.** Timeouts are claimed, never swept. With no Celery and
  no cron, an expired game simply sits finished-in-waiting until its opponent
  asks for the win. Deliberate, and it matches how chess.com daily behaves.
- **Chat.** No chat feature exists anywhere.
- **httpOnly cookie auth.** Auth is JWT **Bearer** tokens stored in `localStorage`
  (web) and `expo-secure-store` (mobile). Cookie-based sessions are not implemented.
