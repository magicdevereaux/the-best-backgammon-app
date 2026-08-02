# The Best Backgammon App

A full-stack backgammon app: a **Django REST** API with two clients — a **React**
web frontend and a **React Native (Expo)** mobile app. Supports hotseat play,
online games with shareable links, user accounts, match modes, and
gammon/backgammon detection. Both clients talk to the same backend.

## Features

- **Full backgammon rules** — bar entry, bearing off, hitting blots, doubles
- **Move staging** — tentative moves with legal-move highlighting before confirming a turn
- **Single game mode** — play until one player bears off all 15 checkers
- **Match mode** — first to reach 3, 5, 7, or 9 points wins the match
- **Gammon / backgammon detection** — worth 2 and 3 points respectively
- **Doubling cube** — offer/accept/drop before rolling, cube ownership, redoubles to 64, points multiplied by cube value, Crawford rule in match play
- **Game over screen** — shows win type, points awarded, and running match score
- **User accounts** — register/login, JWT auth, win/loss and stats tracking, and self-serve account deletion (your games are anonymised, not destroyed, so opponents keep their history)
- **Password recovery** — add an email address at signup or later on your profile, then reset a forgotten password by emailed link
- **Profile page** — lifetime stats: games, wins, losses, gammons, backgammons, points won/lost, win %, gammon rate
- **Online play** — create an online game, share a deep link, join by code, open-games list, with both clients polling for the opponent's moves
- **Turn-ownership security** — the server rejects gameplay actions (403) from anyone who doesn't own the current seat; online, the mobile app also gates its UI so a device only acts on the seat it owns and only on its turn (read-only "waiting"/"spectating" views otherwise)
- **Graceful exit from a dead game** — if your opponent deletes their account mid-game, both apps say so and offer to close the game out unscored rather than leaving you stuck
- **Mobile app** — native SVG board, tap-to-roll, per-move undo, pull-to-refresh, opponent move sync

## Project structure

```
backend/    Django REST API (shared by both clients)
frontend/   React web client
mobile/     React Native (Expo) mobile client
docs/       Architecture, operations, and decision records
```

## Documentation

This README is the setup and feature tour. Deeper reference lives in
[`docs/`](docs/README.md):

| Doc | What it answers |
|-----|-----------------|
| [overview.md](docs/architecture/overview.md) | How backend, web, and mobile fit together |
| [api.md](docs/architecture/api.md) | Every endpoint, payload, and error code |
| [clients.md](docs/architecture/clients.md) | Map of both client apps and the staged-turn flow |
| [game-logic.md](docs/architecture/game-logic.md) | The rules engine and move validation |
| [data-model.md](docs/architecture/data-model.md) | Django models and schema |
| [auth.md](docs/architecture/auth.md) | Accounts, JWT, token lifecycle |
| [going-live.md](docs/operations/going-live.md) | What's left before this can ship |
| [railway-deploy.md](docs/operations/railway-deploy.md) | Step-by-step Railway deployment runbook |
| [legal/](docs/legal/README.md) | Draft privacy policy and terms (need your details filled in) |

[`CLAUDE.md`](CLAUDE.md) is the working brief for AI coding sessions.

## Project status

Feature-complete for local and link-based online play, with **976 passing tests**
and CI running all three suites on every push. The backend suite is green on
Postgres as well as SQLite, so the database move for hosting is de-risked.

The app is now **deployable but not deployed** — the target is **Railway**, with
[`railway.json`](railway.json) committed and a
[step-by-step runbook](docs/operations/railway-deploy.md) written, but no deploy
has run yet. Settings are env-driven,
`manage.py check --deploy` passes clean, gunicorn/whitenoise/Postgres support and
a `Dockerfile`/`Procfile` are in place, and both clients can be pointed at a
remote backend. What's left genuinely needs decisions only you can make: choosing
a host, provisioning a database, a domain and TLS, and filling in the `[TODO]`
markers in the [legal drafts](docs/legal/README.md) before store submission. The
full checklist lives in [going-live.md](docs/operations/going-live.md).

**Local development still needs zero configuration** — no `.env` file required.

---

## Backend (Django REST API)

```bash
cd backend

python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API will be at `http://localhost:8000/api/`.

> To make the backend reachable from a phone or Android emulator, run
> `python manage.py runserver 0.0.0.0:8000` and add the device's host
> (your LAN IP, or `10.0.2.2` for the Android emulator) to `ALLOWED_HOSTS`
> in `backend/backgammon/settings.py`. For local dev you can set
> `ALLOWED_HOSTS = ["*"]`.

### Resetting the dev database

The dev database is a local SQLite file. To reset it (e.g. after adding migrations):

1. Stop the Django dev server (Ctrl+C)
2. Delete `backend/db.sqlite3`
3. Run `python manage.py migrate` again

---

## Web frontend (React)

```bash
cd frontend
npm install
npm start
```

App will be at `http://localhost:3000`. Requests to `/api/*` are proxied to
Django automatically.

---

## Mobile app (React Native + Expo)

Expo SDK 56 (React Native 0.85, React 19), file-based routing via Expo Router,
SVG board, and `expo-secure-store` for JWT tokens.

### Run in development

```bash
cd mobile
npm install
npm start          # then press i (iOS sim) / a (Android) or scan the QR in Expo Go
```

The mobile client auto-detects the dev-machine LAN IP from Metro, so a physical
device hits the backend without hardcoding (override via `MANUAL_OVERRIDE` in
`src/api/config.js`). The backend must be reachable from the device — see the
backend note about `ALLOWED_HOSTS` / `runserver 0.0.0.0:8000`.

| Target | Backend host used | Extra setup |
|--------|-------------------|-------------|
| iOS simulator | `localhost` | none |
| Android emulator | `10.0.2.2` | add `"10.0.2.2"` to `ALLOWED_HOSTS` |
| Physical device (Expo Go) | LAN IP | add LAN IP to `ALLOWED_HOSTS`; `runserver 0.0.0.0:8000` |

### Building for the App Store / Play Store (EAS)

App icons, splash, bundle identifiers (`com.magicdevereaux.backgammon`), and build
profiles are configured in `mobile/app.json` and `mobile/eas.json`. Branded
icons are generated from `mobile/scripts/generate_icons.py` (pure Python, no
dependencies — `python scripts/generate_icons.py` regenerates the asset set).

```bash
cd mobile
npm install -g eas-cli
eas login
eas init                       # links the project (writes the EAS project id)

eas build --profile preview --platform android    # internal APK to share
eas build --profile production --platform ios      # store-ready build
eas build --profile production --platform android

eas submit --profile production --platform ios     # upload to App Store Connect
eas submit --profile production --platform android # upload to Play Console
```

`eas.json` profiles: **development** (dev client, internal), **preview**
(internal distribution; Android builds an APK), **production** (store builds,
auto-incrementing version).

---

## Running tests

### Backend (474 tests)

```bash
cd backend
source venv/Scripts/activate   # or venv\Scripts\activate on Windows
python manage.py test game.tests
```

The runner uses an in-memory database, so you don't need to reset the dev DB.

### Web frontend (312 tests, Jest + React Testing Library)

```bash
cd frontend
npm test
```

Covers the game-logic port, the `useGame` staged-turn hook and its poller, the
closed-seat helpers in `utils/seats.js`, the board / dice / controls components,
the lobby-adjacent pages (game, profile), and the auth stack (token storage,
`register`/`login`/`fetchMe`/refresh, the 401 refresh-retry, and the login,
register, forgot-password and reset-password pages).

### Mobile (190 tests, Jest + React Native Testing Library)

```bash
cd mobile
npm test
```

Covers game logic, the `useGame` staged-turn hook, turn-ownership gating and
closed-seat handling, the device-local seat registry, the game-over / match-score /
abandon / email / delete-account components, and the auth stack (SecureStore token
store, `register`/`login`/`fetchMe`, the 401 refresh-retry).

---

## Layout

```
backend/
  backgammon/          Django project (settings, root urls)
  game/
    models.py          Game and Match models
    serializers.py     DRF serializers (GameSerializer incl. viewer_seat, MatchSerializer, UserSerializer)
    views.py           ViewSets — GameViewSet, MatchViewSet, auth views
    game_logic.py      Pure game logic (moves, bear-off, win detection, gammon detection)
    urls.py            Router wiring
    tests/             Endpoint, auth, lobby, match, serializer, model, and logic tests

frontend/src/          React web client (api/, components/, hooks/, pages/, context/,
                       utils/ — the game-logic port and the closed-seat helpers)

mobile/
  app/                 Expo Router screens (index lobby, login, profile, game/[id])
  src/
    api/               Fetch client (JWT + silent refresh), games/matches/auth, friendly errors
    components/        Board, Dice, GameControls, GameOverScreen, MatchScore (native SVG)
    game/              logic.js, useGame.js, gating.js, seatRegistry.js
    context/           AuthContext
  assets/              App icons, adaptive icons, splash (generated)
  scripts/             generate_icons.py — dependency-free icon generator
  app.json / eas.json  Expo + EAS build config
```

## API overview

Full reference — request/response shapes, every error code, and the
seat-permission rules — lives in
[`docs/architecture/api.md`](docs/architecture/api.md). Summary:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/` | Browsable API root (DRF `DefaultRouter`) |
| POST | `/api/auth/register/` | Create account |
| POST | `/api/auth/login/` | Get JWT tokens |
| POST | `/api/auth/refresh/` | Refresh access token |
| POST | `/api/auth/password-reset/` | Email yourself a reset link |
| POST | `/api/auth/password-reset/confirm/` | Set a new password from that link's `uid` + `token` |
| GET | `/api/auth/me/` | Current user + stats |
| PATCH | `/api/auth/me/` | Set or clear your email address (send `""` to clear) |
| DELETE | `/api/auth/me/` | Delete your account (requires your password) |
| GET/POST | `/api/games/` | List games visible to you / create game |
| GET | `/api/games/?status=waiting` | Open lobby games |
| GET | `/api/games/{id}/` | Game detail (includes `viewer_seat` / `viewer_is_participant` for the requester) |
| POST | `/api/games/{id}/join/` | Join a waiting game |
| POST | `/api/games/{id}/roll_dice/` | Roll dice for current turn |
| POST | `/api/games/{id}/confirm_turn/` | Commit staged moves; an empty list passes the turn, but only when no legal move exists (otherwise 400) |
| POST | `/api/games/{id}/offer_double/` | Offer to double the stakes (before rolling) |
| POST | `/api/games/{id}/respond_to_double/` | Accept (`{"accept": true}`) or drop a pending double |
| POST | `/api/games/{id}/abandon/` | Close out a game deadlocked by a deleted opponent — no winner, no points |
| GET/POST | `/api/matches/` | List matches visible to you / create match (also creates the match's first game; `target_points` must be 3, 5, 7, or 9) |
| GET | `/api/matches/{id}/` | Match detail + current score |
| POST | `/api/matches/{id}/next_game/` | Start the next game in a match (seat-enforced) |
| POST | `/api/matches/{id}/join/` | Join a match that has no second player yet |
| GET | `/healthz/` | Health check — DB connectivity, no auth |

Games and matches expose only list / retrieve / create plus the seat-enforced
custom actions; `PUT` / `PATCH` / `DELETE` are not routed at all (405). List
endpoints are paginated (`?page=`, `?page_size=`) but still return a bare JSON
array, so clients need no envelope handling.

Both list endpoints are **scoped to the requester**: you see the open lobby (games
only), your own rows, and fully-guest rows that carry no account details. Fetching a
single game or match **by id** stays open to anyone who has the link — that's how
sharing an invite works at all.

`viewer_seat` (`"p1"` / `"p2"` / `"p1p2"` / `null`) is a server-side ownership
signal: it tells the requesting authenticated user which seat they own so a
client can gate turns even on a fresh device with no local record (e.g. a deep
link opened for the first time). Guests have no server identity, so the mobile
client also keeps a device-local seat registry as a fallback.

## Gammon / backgammon rules

A **gammon** is worth 2 points: the winner bore off all 15 checkers before the loser bore off any.

A **backgammon** is worth 3 points: the loser still has a checker on the bar or in the winner's home board when the winner finishes.

A normal win is worth 1 point.

In match mode, games continue until one player accumulates enough points to reach the target. The winner of each game goes first in the next.

All win values are multiplied by the **doubling cube**: a gammon at cube value 4 is worth 8 points, a backgammon 12. Dropping a double concedes the game at the pre-double cube value. Under the **Crawford rule**, the first game after a player reaches match point is played without the cube; doubling resumes afterwards.

---

_Last updated 2026-08-02. Test counts (474 / 312 / 190 = 976) verified green on that
date, on both SQLite and Postgres 16. The most recent pass made every mutating
endpoint transactional and row-locked, made the Django admin path configurable,
and corrected two false statements in the legal drafts. Earlier the same day: the
higher-die rule went general and was mirrored in both clients, `GET /api/matches/`
was scoped, the password-reset and abandon UIs shipped, web gained polling, and
the dead `move_checker` endpoint was removed._
