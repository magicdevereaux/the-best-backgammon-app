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
- **Game over screen** — shows win type, points awarded, and running match score
- **User accounts** — register/login, JWT auth, win/loss and stats tracking
- **Profile page** — lifetime stats: games, wins, losses, gammons, backgammons, points won/lost, win %, gammon rate
- **Online play** — create an online game, share a deep link, join by code, open-games list
- **Turn-ownership gating** — online, a device may only act on the seat it owns and only on its turn (read-only "waiting"/"spectating" views otherwise)
- **Mobile app** — native SVG board, tap-to-roll, per-move undo, pull-to-refresh, opponent move sync

## Project structure

```
backend/    Django REST API (shared by both clients)
frontend/   React web client
mobile/     React Native (Expo) mobile client
```

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

### Backend (176 tests)

```bash
cd backend
source venv/Scripts/activate   # or venv\Scripts\activate on Windows
python manage.py test game.tests
```

The runner uses an in-memory database, so you don't need to reset the dev DB.

### Mobile (41 tests, Jest + React Native Testing Library)

```bash
cd mobile
npm test
```

Covers game logic, the `useGame` staged-turn hook, turn-ownership gating, the
device-local seat registry, and the game-over / match-score components.

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

frontend/src/          React web client (api/, components/, hooks/, pages/, context/)

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

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register/` | Create account |
| POST | `/api/auth/login/` | Get JWT tokens |
| POST | `/api/auth/refresh/` | Refresh access token |
| GET | `/api/auth/me/` | Current user + stats |
| GET/POST | `/api/games/` | List games / create game |
| GET | `/api/games/?status=waiting` | Open lobby games |
| GET | `/api/games/{id}/` | Game detail (includes `viewer_seat` / `viewer_is_participant` for the requester) |
| POST | `/api/games/{id}/join/` | Join a waiting game |
| POST | `/api/games/{id}/roll_dice/` | Roll dice for current turn |
| POST | `/api/games/{id}/confirm_turn/` | Commit staged moves (empty list = pass) |
| GET/POST | `/api/matches/` | List matches / create match |
| GET | `/api/matches/{id}/` | Match detail + current score |
| POST | `/api/matches/{id}/next_game/` | Start the next game in a match |
| POST | `/api/matches/{id}/join/` | Join a waiting match |

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
