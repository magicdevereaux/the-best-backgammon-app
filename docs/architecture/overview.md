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
| `PATCH /api/auth/me/` | set/clear the account's email (the recovery address) |
| `DELETE /api/auth/me/` | delete the account (password re-check; seats close) |
| `POST /api/auth/password-reset/` | mails a reset link; flat body either way |
| `POST /api/auth/password-reset/confirm/` | `{uid, token, new_password}` → new password |

Token lifetimes: **access 1 hour, refresh 7 days**
([`settings.py`](../../backend/backgammon/settings.py)). Storage differs by client:

- **Web** — `localStorage` keys `access` / `refresh`.
- **Mobile** — `expo-secure-store` keys `bg_access` / `bg_refresh`.

DRF's default permission is `AllowAny`, so most endpoints work for guests too; auth
only gates who "owns" a game seat (below) and the `/me/` stats. The full auth flow,
token lifecycle, and test coverage live in [auth.md](auth.md).

## Online multiplayer

Online play is **link/code + lobby based**, not automated matchmaking: players
create a game and invite a specific opponent (share a link/code) or pick one from the
open-games list. There is no queue that auto-pairs two strangers who both press
"find a game" (see [Planned / Not Yet Implemented](#planned--not-yet-implemented)).
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

The backend **enforces** seat/turn ownership on every player action — `roll_dice`,
`confirm_turn`, the cube actions `offer_double` / `respond_to_double`, and
`abandon` — via `_seat_permission_error` in
[`views.py`](../../backend/game/views.py). Enforcement is only as strong as the
`player1_user` / `player2_user` FKs — a **guest seat (null FK) has no server
identity to verify**. The policy:

| Current-turn seat | Requester | Result |
|---|---|---|
| Owned by a user | that user | allowed |
| Owned by a user | the other participant | **403** "It's not your turn." |
| Owned by a user | any other account / anonymous | **403** not a participant / log in |
| Guest (no FK) | anonymous, or a participant of this game | allowed (guest devices + hotseat) |
| Guest (no FK) | any other logged-in account | **403** not a participant |

Fully-guest games (no FKs at all) are unrestricted — there is nothing to verify.
Violations return **403** with the message in `{ "error": ... }`; both clients
surface it via their normal action-error path.

The check normally runs against `game.current_turn`, but it takes an explicit
seat where the actor isn't the current player: `respond_to_double` checks the
**offerer's opponent**, so the offerer can't answer their own double, and
`abandon` checks the **surviving** seat (the closed one is the blocked player).

> **Residual gap:** a logged-in attacker can log *out* and act on a guest seat
> anonymously — a guest seat is inherently unverifiable without a guest-token
> concept (see Planned).

On top of that server rule, two client-side signals drive the *UX* (hiding
controls rather than eating 403s):

- **`viewer_seat`** — a `GameSerializer` field (`"p1"` / `"p2"` / `"p1p2"` / `null`)
  telling the *requesting authenticated user* which seat(s) they own, derived from
  the user FKs. Lets a fresh device (e.g. a deep link opened for the first time)
  gate correctly. A companion boolean `viewer_is_participant` is just
  `viewer_seat is not null`.
- **Device-local seat registry (mobile only)** —
  [`mobile/src/game/seatRegistry.js`](../../mobile/src/game/seatRegistry.js) records
  in SecureStore which seat this device took when it created/joined a game. This
  covers the case where the opponent is a *guest* (no FK), which `viewer_seat` can't
  distinguish from hotseat.

[`mobile/src/game/gating.js`](../../mobile/src/game/gating.js) combines these into
`canInteract` / `spectating` / `waitingForOpponent`. **The web client does not gate
turn ownership in its UI** — its board is interactive for whoever's turn it is, and
an unauthorized click is caught by the server's 403.

### Deadlock derivation (shared by both clients)

One slice of that logic *is* mirrored on the web. `isSeatClosed` / `otherSeat` /
`blockedSeat` / `isDeadlocked` exist twice —
[`mobile/src/game/gating.js`](../../mobile/src/game/gating.js) and
[`frontend/src/utils/seats.js`](../../frontend/src/utils/seats.js) — as a
**must-stay-in-sync pair** (today they are character-for-character identical). The
server's `abandon` action derives the blocked seat the same way: `current_turn`,
except when `double_offered_by` is set, where it is the offerer's opponent. All three
have to agree on when a game can no longer move.

Both clients use it to show "your opponent deleted their account — this game can't
continue", to stop polling (nobody is coming), and to offer the abandon control to
the surviving seat only (`canAbandon` in each file). Mobile's gating layer *proper*
— which seats this device may touch — is still deliberately not ported.

## Move sync

**Both clients now poll** `GET /api/games/{id}/` on a ~3.5 s timer, swapping in state
only when `updated_at` changes, so a stream of identical responses causes no
re-render:

- **Mobile** ([`mobile/src/game/useGame.js`](../../mobile/src/game/useGame.js)) polls
  while the game is active, the screen is focused (`useFocusEffect`) and the app is
  foregrounded (`AppState`).
- **Web** ([`frontend/src/hooks/useGame.js`](../../frontend/src/hooks/useGame.js))
  polls only when `isOnlineGame(game, viewerUserId)` says the other seat lives on
  another device — a hotseat board can only be changed here, so polling it would be
  pure churn. That predicate is web-only: it substitutes for the device-local seat
  registry the web client doesn't have, and its blind spot is a logged-in player
  whose opponent joined as a *guest* (a payload identical to a hotseat game), which
  falls to the conservative side and doesn't poll.

Both skip a tick while the local player has staged moves (a refresh must never
clobber a turn in progress), when the game is `finished`, and when it is deadlocked
on a closed seat. Web also has an explicit `reload()`; mobile adds pull-to-refresh.

The same applies to a **pending double**: an offer sets `double_offered_by` and
blocks play until answered, so the opponent sees the accept/drop prompt on the next
poll of either client.

## Planned / Not Yet Implemented

- **PostgreSQL in use.** The wiring exists — `dj-database-url` reads `DATABASE_URL`
  and `psycopg2-binary` is pinned — but every environment today still resolves to
  the dev SQLite file, and the migrations have only ever been applied against
  SQLite. Verify them on an empty Postgres before cutting over.
- **WebSockets / realtime.** No Channels/ASGI layer. Sync today is HTTP polling on
  both clients. Realtime push (and retiring the pollers) is future work.
- **Automated matchmaking.** Online play today is manual: create + share a
  link/code, or join from the open-games list. There is no matchmaking queue or
  `/api/matchmaking/` endpoint that auto-pairs two waiting players, no ranking/ELO,
  and no "quick play against a random opponent" button. Pairing is always
  player-initiated against a chosen or listed game.
- **Chat.** Not implemented anywhere.
- **httpOnly cookie auth.** Auth is Bearer tokens in `localStorage`/SecureStore, not
  cookies.
- **Guest seat identity.** Guest seats are enforced only against *other logged-in
  accounts*; anonymous requests on a guest seat can't be verified. A guest
  token/session concept would close this.
- **Web turn-ownership gating.** Web now polls like mobile, but it still renders
  every control for whoever is sitting at the browser: there is no web counterpart
  to mobile's `computeGating` / `seatRegistry` (only the closed-seat predicates are
  shared). The server already rejects unauthorized web actions with 403; the web UI
  just doesn't hide the controls.
