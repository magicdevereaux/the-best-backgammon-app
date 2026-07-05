# Architecture Overview

How the three parts of the system relate, how a user authenticates, and how online
play works — **as currently built**. Intended-but-unbuilt pieces are collected under
[Planned / Not Yet Implemented](#planned--not-yet-implemented) at the end.

## The three parts

```
        ┌─────────────────┐         ┌─────────────────┐
        │  Web (React)    │         │ Mobile (Expo)   │
        │  localStorage   │         │ SecureStore     │
        │  JWT Bearer     │         │ JWT Bearer      │
        └────────┬────────┘         └────────┬────────┘
                 │  HTTP/JSON  (/api/*)       │
                 └─────────────┬──────────────┘
                               ▼
                   ┌───────────────────────┐
                   │  Django REST backend  │
                   │  DRF + SimpleJWT      │
                   │  SQLite (dev)         │
                   └───────────────────────┘
```

- **Backend** ([`backend/`](../../backend/)) is the single source of truth. It owns
  the game state, validates every committed turn, rolls dice, and computes stats. It
  exposes a plain JSON REST API under `/api/`.
- **Web client** ([`frontend/`](../../frontend/)) is a Create React App SPA using
  `react-router-dom`. In dev it proxies `/api/*` to `:8000`.
- **Mobile client** ([`mobile/`](../../mobile/)) is an Expo Router app with a native
  SVG board. It resolves the backend host from Metro's LAN IP at runtime
  ([`mobile/src/api/config.js`](../../mobile/src/api/config.js)).

Both clients contain a **local port of the game engine** so they can highlight legal
moves and preview a staged turn without a round-trip. The backend re-validates
everything on `confirm_turn`, so the local copies are advisory, not trusted. See
[game-logic.md](game-logic.md).

## Request/auth layer

Each client has a thin fetch wrapper that injects the bearer token and does a single
silent refresh-and-retry on a `401`:

- Web: [`frontend/src/api/apiClient.js`](../../frontend/src/api/apiClient.js) +
  [`authApi.js`](../../frontend/src/api/authApi.js) (tokens in `localStorage`).
- Mobile: [`mobile/src/api/client.js`](../../mobile/src/api/client.js) +
  [`tokenStore.js`](../../mobile/src/api/tokenStore.js) (tokens in `expo-secure-store`).

### Auth flow (JWT Bearer)

Authentication is **JSON Web Tokens via `djangorestframework-simplejwt`** — access +
refresh tokens in the request body/`Authorization` header. There are **no cookies or
server sessions** involved in the API auth path.

| Endpoint | Returns |
|----------|---------|
| `POST /api/auth/register/` | `{ user, access, refresh }` |
| `POST /api/auth/login/` | `{ access, refresh }` (SimpleJWT `TokenObtainPairView`) |
| `POST /api/auth/refresh/` | `{ access }` |
| `GET /api/auth/me/` | current user + computed stats |

Token lifetimes: **access 1 hour, refresh 7 days**
([`settings.py`](../../backend/backgammon/settings.py)). Storage differs by client:

- **Web** — `localStorage` keys `access` / `refresh`.
- **Mobile** — `expo-secure-store` keys `bg_access` / `bg_refresh`.

DRF's default permission is `AllowAny`, so most endpoints work for guests too; auth
only gates who "owns" a game seat (below) and the `/me/` stats.

## Online multiplayer

Games and matches are created and joined over the same REST endpoints; there is no
realtime channel. The flow:

1. **Create.** A logged-in user `POST /api/games/` with an empty body — the server
   fills `player1_name` from the account and sets `status = "waiting"`. (A game
   created with both names is hotseat and starts `active`.)
2. **Share.** The game is reachable at `/game/{id}` (web) or the `backgammon://`
   deep link (mobile). Mobile's waiting screen also shows the numeric **game id**
   labelled "Game code" and shares an invite message containing it.
3. **Join.** `POST /api/games/{id}/join/` sets the second player and flips the game
   to `active`. Authenticated users join by username; guests pass `player2_name`.
   - Web joins from the **open-games list** in the lobby.
   - Mobile joins from the open-games list **or** via a **"Join by code"** field
     that takes the numeric game id
     ([`mobile/app/index.jsx`](../../mobile/app/index.jsx)).

> **"Game code" is just the game's primary key.** There is no separate code/token
> column or generator on the backend — the id doubles as the shareable code. See
> [data-model.md](data-model.md).

### Whose turn is it? (seat ownership)

Two mechanisms exist, both **advisory / client-side** — the backend does *not*
enforce that the requesting user owns the current seat:

- **`viewer_seat`** — a `GameSerializer` field (`"p1"` / `"p2"` / `"p1p2"` / `null`)
  telling the *requesting authenticated user* which seat(s) they own, derived from
  the `player1_user` / `player2_user` FKs. Lets a fresh device (e.g. a deep link
  opened for the first time) gate correctly.
- **Device-local seat registry (mobile only)** —
  [`mobile/src/game/seatRegistry.js`](../../mobile/src/game/seatRegistry.js) records
  in SecureStore which seat this device took when it created/joined a game. This
  covers the case where the opponent is a *guest* (no FK), which `viewer_seat` can't
  distinguish from hotseat.

[`mobile/src/game/gating.js`](../../mobile/src/game/gating.js) combines these into
`canInteract` / `spectating` / `waitingForOpponent`. **The web client does not gate
turn ownership** — online, its board is interactive for whoever's turn it is.

> **Security note:** because `confirm_turn`/`roll_dice` run with `AllowAny` and only
> read `game.current_turn`, a crafted request can act on either seat. Turn ownership
> is a UX affordance today, not a server-enforced rule.

## Move sync

- **Mobile** polls `GET /api/games/{id}/` on a timer (~3.5s) while a game is active
  and the screen is focused, swapping in state only when `updated_at` changes
  ([`mobile/src/game/useGame.js`](../../mobile/src/game/useGame.js)).
- **Web** does **not** auto-poll; the game reloads on navigation or an explicit
  action. Opponent moves appear on the next reload.

## Planned / Not Yet Implemented

- **PostgreSQL (production).** Current config is SQLite only. Postgres is the
  intended production database but no driver/config exists yet.
- **WebSockets / realtime.** No Channels/ASGI layer. Sync today is mobile polling +
  web manual reload. Realtime push (and replacing the poller) is future work.
- **Chat.** Not implemented anywhere.
- **httpOnly cookie auth.** Auth is Bearer tokens in `localStorage`/SecureStore, not
  cookies.
- **Server-enforced seat/turn ownership.** Gating is client-side only today (and
  web has none); moving it server-side is future work.
- **Web turn-ownership gating and polling** to match the mobile experience.
