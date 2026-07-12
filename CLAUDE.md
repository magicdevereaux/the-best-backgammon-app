# CLAUDE.md

Working context for Claude Code sessions on **The Best Backgammon App**. Read this
first, then reach for the deeper docs under [`docs/`](docs/) when you need them.

> **Ground rule for this file and all docs:** describe what *exists* in the code.
> Anything intended-but-unbuilt lives under a **Planned / Not Yet Implemented**
> section so a session can tell "work with this" from "don't assume it's there."

## What this is

A full-stack backgammon app: one Django REST backend shared by **two clients** — a
React web app and a React Native (Expo) mobile app. It supports hotseat play,
online games via shareable links, user accounts with JWT auth, single games and
match play (first to N points), and gammon/backgammon scoring.

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
  backgammon/   project settings + root urls (SQLite, JWT, CORS)
  game/         models.py, serializers.py, views.py, game_logic.py, urls.py, tests/
frontend/   React web client  (src/: api/ components/ hooks/ pages/ context/ utils/)
mobile/     Expo mobile client (app/: router screens; src/: api/ components/ game/ context/)
docs/       architecture/ + decisions/  (see below)
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
The venv lives at `backend/venv/`. On Windows, Node/npm are **not on PATH** in the
default shell — use the Bash tool with nvm sourced (`. "$NVM_DIR/nvm.sh"`) for the
JS clients. Django uses `backend/venv/Scripts/python.exe` directly.

**Web** (from `frontend/`): `npm install && npm start` → http://localhost:3000
(requests to `/api/*` proxy to Django).

**Mobile** (from `mobile/`): `npm install && npm start`, then `i`/`a` or scan in
Expo Go. The client auto-detects the dev-machine LAN IP from Metro; the backend
must be reachable (`runserver 0.0.0.0:8000` and add the host to `ALLOWED_HOSTS`).
Override the host via `MANUAL_OVERRIDE` in [`mobile/src/api/config.js`](mobile/src/api/config.js).

See [`README.md`](README.md) for the full device matrix and EAS build commands.

## Tests

| Suite | Count | Command (cwd) |
|-------|-------|---------------|
| Backend | **193** | `python manage.py test game` (`backend/`, in-memory DB) |
| Web | **157** | `CI=true npm test -- --watchAll=false` (`frontend/`) |
| Mobile | **74** | `CI=true npx jest` (`mobile/`) |

Backend tests live in [`backend/game/tests/`](backend/game/tests/) (models, views,
auth, lobby, match, serializers, logic). Web tests sit beside sources in
`__tests__/` dirs; mobile likewise under `src/**/__tests__/`.

Auth has full client + server coverage: backend `test_auth.py`; web
`api/__tests__/authApi.test.js` + `apiClient.test.js` + `pages/__tests__/LoginPage.test.jsx`;
mobile `api/__tests__/{tokenStore,auth,client}.test.js`. See [auth.md](docs/architecture/auth.md)
for the map.

> On Windows, Node isn't on PATH; run JS suites from the Bash tool with node added,
> e.g. `export PATH="$HOME/.nvm/versions/node/v22.9.0/bin:$PATH"` (nvm-windows layout).

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
- **Seat/turn ownership is enforced server-side** on the gameplay actions
  (`roll_dice` / `move_checker` / `confirm_turn`): `_seat_permission_error` in
  [`views.py`](backend/game/views.py) returns **403** when the current-turn seat is
  owned by a registered user and the requester isn't that user, and when another
  logged-in account touches a guest seat. **Guest seats (null user FK) are
  unverifiable** — anonymous requests on them are allowed by design (hotseat/guest
  play). Client gating on top of that is UX: mobile hides controls via
  [`gating.js`](mobile/src/game/gating.js) + a device-local seat registry; the
  **web UI does not gate** (unauthorized clicks surface the server's 403).
- **Stats are computed on read**, not stored — see `UserSerializer` in
  [`serializers.py`](backend/game/serializers.py).

## Known gaps

- **Higher-die rule not enforced.** When only one die is playable, backgammon
  requires playing the *higher* one if possible. We enforce the *count* of dice
  used (maximal usage), not *which* die. Documented in
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

- [docs/architecture/overview.md](docs/architecture/overview.md) — how web, mobile,
  and backend relate; auth; online multiplayer; sync.
- [docs/architecture/auth.md](docs/architecture/auth.md) — accounts, JWT endpoints,
  client token lifecycle + refresh-retry, auth test map, security limitations.
- [docs/architecture/game-logic.md](docs/architecture/game-logic.md) — the rules
  engine, combined-move DFS, maximal-dice enforcement.
- [docs/architecture/data-model.md](docs/architecture/data-model.md) — Django
  models and schema.
- [docs/decisions/adr-001-combined-moves.md](docs/decisions/adr-001-combined-moves.md).

## Planned / Not Yet Implemented

These are intended but **do not exist in the code today** — don't assume them:

- **PostgreSQL in production.** Dev and current config are SQLite only
  ([`settings.py`](backend/backgammon/settings.py)); no Postgres driver or config
  is present.
- **WebSockets / real-time push.** There is no Channels/ASGI setup. Opponent moves
  are synced by **mobile polling** (~3.5s in [`mobile/src/game/useGame.js`](mobile/src/game/useGame.js));
  the **web client has no auto-refresh** (manual reload). A socket layer is future work.
- **Automated matchmaking.** No auto-pairing queue, ranking/ELO, or "quick play vs
  a random opponent." Online pairing is always player-initiated via link/code or the
  open-games list. See [overview.md](docs/architecture/overview.md#online-multiplayer).
- **Chat.** No chat feature exists anywhere.
- **httpOnly cookie auth.** Auth is JWT **Bearer** tokens stored in `localStorage`
  (web) and `expo-secure-store` (mobile). Cookie-based sessions are not implemented.
