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

There is a **second, smaller sync obligation**: the closed-seat deadlock
predicates `isSeatClosed` / `isDeadlocked` / `blockedSeat` exist in both
[`mobile/src/game/gating.js`](mobile/src/game/gating.js) and
[`frontend/src/utils/seats.js`](frontend/src/utils/seats.js) — the web copy is a
verbatim port carrying a stay-in-sync header comment. They must agree with each
other *and* with the server's `abandon` action, which derives the blocked seat
the same way. Change one, change all three.

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
| Backend | **421** | `python manage.py test game` (`backend/`, in-memory DB) |
| Web | **243** | `CI=true npm test -- --watchAll=false` (`frontend/`) |
| Mobile | **125** | `CI=true npx jest` (`mobile/`) |

All three suites were **green as of 2026-08-01** (421 / 243 / 125, 789 total, zero
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
- **`move_checker` is gone.** It applied a single move immediately and no client
  used it; both clients drive the staging → `confirm_turn` flow, which is now the
  only path that mutates a board. Nine tests that used it merely as a convenient
  one-shot rules harness were repointed at `confirm_turn` rather than deleted.
- **Seat/turn ownership is enforced server-side** on **five** actions —
  `roll_dice` / `confirm_turn` / `offer_double` / `respond_to_double` /
  `abandon`. `_seat_permission_error` in
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
  endless series of dead-on-arrival games. **No client calls `abandon` yet** —
  grep both clients and it appears only in tests — so today the survivor sees the
  explanation but still has no button. The exit is server-side only. Note the blocked seat is `current_turn`
  *except* with a double pending, where it is the responder.
- **Throttle counters are per-process *unless* `REDIS_URL` is set.** `CACHES` is
  env-driven: a set `REDIS_URL` selects `RedisCache` and makes limits global,
  unset falls back to `LocMemCache`, which is per-gunicorn-worker and wiped on
  restart. With the default 3 workers and no Redis, `login` 10/hour behaves like
  ~30/hour. Nothing is provisioned yet, so today the fallback is what runs.
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
  **Postgres is wired but unused** — `psycopg2-binary` and `dj-database-url` are
  installed and `DATABASE_URL` is honoured, yet every environment today still
  resolves to the dev SQLite file, and the migrations have only ever been applied
  against SQLite. Verify them on an empty Postgres before cutting over.
- **A hosted web client.** The plan is Vercel with `REACT_APP_API_BASE_URL` set at
  build time (mirroring `howl`), but nothing is deployed and no build pipeline for
  the web client exists.
- **WebSockets / real-time push.** There is no Channels/ASGI setup. Opponent moves
  are synced by **polling on both clients** (~3.5s), not pushed. A socket layer is
  future work.
- **Any client UI for password reset — and any way to *have* an email.** The
  backend flow is complete (`POST /api/auth/password-reset/` and `.../confirm/`,
  optional email on accounts), but the string `email` does not appear anywhere in
  either client's source: no register field, no profile field. So every account
  the shipped clients can create has a blank email, and the reset view only
  matches non-blank addresses. The flow has **nobody to reach**, which is a wider
  gap than the missing `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}` route.
  Collecting the address is the first half of that work.
- **Automated matchmaking.** No auto-pairing queue, ranking/ELO, or "quick play vs
  a random opponent." Online pairing is always player-initiated via link/code or the
  open-games list. See [overview.md](docs/architecture/overview.md#online-multiplayer).
- **Chat.** No chat feature exists anywhere.
- **httpOnly cookie auth.** Auth is JWT **Bearer** tokens stored in `localStorage`
  (web) and `expo-secure-store` (mobile). Cookie-based sessions are not implemented.
