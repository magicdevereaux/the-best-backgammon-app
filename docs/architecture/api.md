# HTTP API Reference

Every endpoint the backend actually exposes, as wired in
[`backgammon/urls.py`](../../backend/backgammon/urls.py) →
[`game/urls.py`](../../backend/game/urls.py). Request/response shapes come from
[`views.py`](../../backend/game/views.py) and
[`serializers.py`](../../backend/game/serializers.py); status codes are the ones
asserted in [`backend/game/tests/`](../../backend/game/tests/).

Anything intended-but-unbuilt is under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

Related: [auth.md](auth.md) (token lifecycle), [data-model.md](data-model.md)
(fields), [game-logic.md](game-logic.md) (the rules the validators enforce).

## Conventions

- **Base path:** `/api/`. All routes end with a trailing slash.
- **Content type:** JSON in, JSON out.
- **Auth:** JWT bearer — `Authorization: Bearer <access>`. Configured as the
  only authentication class in
  [`settings.py`](../../backend/backgammon/settings.py)
  (`rest_framework_simplejwt.authentication.JWTAuthentication`).
- **Default permission is `AllowAny`.** `/api/auth/me/` (`MeView`, both `GET`
  and `DELETE`) is the *only* route with `IsAuthenticated`. Everything else
  accepts anonymous requests —
  guest play depends on it. Authorization for gameplay is per-action seat
  enforcement, not a permission class (see [Seat enforcement](#seat-enforcement)).
- **Token lifetimes** (`SIMPLE_JWT`): access **1 hour**, refresh **7 days**.
  `ROTATE_REFRESH_TOKENS` and `BLACKLIST_AFTER_ROTATION` are both on, backed by
  the `rest_framework_simplejwt.token_blacklist` app.
- **CORS** (`django-cors-headers`): `CORS_ALLOWED_ORIGINS` defaults to
  `["http://localhost:3000"]` — the CRA dev server only — and is overridable by
  env var. Credentials are not enabled. Native clients (Expo)
  send no `Origin` and are unaffected; a browser served from a LAN IP would be
  blocked until that origin is added.
- **Pagination without an envelope.** `BareListPagination` caps every list
  response at **100** items (`?page=N`, `?page_size=` up to **200**) but returns
  a **bare JSON array**, not DRF's `{count, next, previous, results}` — both
  clients consume these endpoints as arrays.
- **Throttling is on.** DRF's `anon`/`user` rates apply globally
  (`120/min` / `240/min` by default), plus scoped rates on the auth views:
  `login` `10/hour`, `register` `5/hour`, `refresh` `60/hour`. All rates are
  env-overridable and are **disabled while running the test suite**. Over the
  limit → **429**.
- **Ordering:** both `Game` and `Match` use `Meta.ordering = ["-created_at", "-id"]`,
  so lists are newest-first.
- **Error bodies:** custom actions return `{"error": "<message>"}`. DRF's own
  machinery returns `{"detail": ...}` (404/401) or a field-keyed dict
  (`{"username": ["Username already taken."]}`) for serializer validation.
- The router is a `DefaultRouter`, so `GET /api/` returns a browsable index of
  `games` and `matches`.

## Endpoint index

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/register/` | none |
| `POST` | `/api/auth/login/` | none |
| `POST` | `/api/auth/refresh/` | none (refresh token in body) |
| `GET` | `/api/auth/me/` | **required** |
| `DELETE` | `/api/auth/me/` | **required** (+ password in body) |
| `GET` | `/api/games/` | optional |
| `POST` | `/api/games/` | optional |
| `GET` | `/api/games/{id}/` | optional |
| `PUT`/`PATCH`/`DELETE` | `/api/games/{id}/` | **not routed** — 405 |
| `POST` | `/api/games/{id}/join/` | optional |
| `POST` | `/api/games/{id}/roll_dice/` | seat-enforced |
| `POST` | `/api/games/{id}/move_checker/` | seat-enforced (legacy) |
| `POST` | `/api/games/{id}/confirm_turn/` | seat-enforced |
| `POST` | `/api/games/{id}/offer_double/` | seat-enforced |
| `POST` | `/api/games/{id}/respond_to_double/` | seat-enforced (responder seat) |
| `GET` | `/api/matches/` | optional |
| `POST` | `/api/matches/` | optional |
| `GET` | `/api/matches/{id}/` | optional |
| `PUT`/`PATCH`/`DELETE` | `/api/matches/{id}/` | **not routed** — 405 |
| `POST` | `/api/matches/{id}/next_game/` | participant-enforced |
| `POST` | `/api/matches/{id}/join/` | optional |

One route sits outside `/api/`: `GET /healthz/` (wired in
[`backgammon/urls.py`](../../backend/backgammon/urls.py) →
[`health.py`](../../backend/backgammon/health.py)), no auth, for platform health
checks. **200** `{"status": "ok", "database": "ok"}`, or **503** with
`"status": "error"` when the DB is unreachable.

---

## Auth

### `POST /api/auth/register/`

`RegisterView` + `RegisterSerializer`. Creates the account **and mints a token
pair immediately** — no second login round-trip.

| Field | Type | Required |
|-------|------|----------|
| `username` | string, ≤ 150 chars, unique | yes |
| `password` | string, ≥ 8 chars (write-only) | yes |

**201** → `{ "user": <UserSerializer>, "refresh": "<jwt>", "access": "<jwt>" }`

**400** — username taken (`"Username already taken."`), password shorter than 8
characters, or any failure from Django's `AUTH_PASSWORD_VALIDATORS`, which
`RegisterSerializer.validate` runs explicitly (`create_user` does not) and
re-raises keyed on `"password"` as a normal DRF field error.

### `POST /api/auth/login/`

Stock SimpleJWT `TokenObtainPairView`. Body `{ "username", "password" }`.

**200** → `{ "access", "refresh" }` · **401** on bad credentials.

### `POST /api/auth/refresh/`

Stock SimpleJWT `TokenRefreshView`. Body `{ "refresh" }`.

**200** → `{ "access", "refresh" }` · **401** if the refresh token is
invalid/expired or has been blacklisted. Rotation is on: each call mints a
**new** refresh token and blacklists the one it replaced, so a refresh token is
single-use.

### `GET /api/auth/me/`

`MeView`, `IsAuthenticated`. Returns `UserSerializer` for the bearer's user.

**200** → `id`, `username`, plus stats **computed on read** (never stored):
`wins`, `losses`, `total_games`, `total_gammons`, `total_backgammons`,
`total_points_won`, `total_points_lost`, `win_percentage`, `gammon_rate`.
Only `status="finished"` games count, across both seats.

**401** when the header is missing or the token is invalid/expired.

### `DELETE /api/auth/me/`

`MeView.destroy` + `AccountDeleteSerializer`, `IsAuthenticated`. Permanently
deletes **the bearer's own** account — `get_object` returns `request.user`, so
the endpoint is structurally incapable of naming someone else's account (extra
`username`/`id` keys in the body are ignored).

| Field | Type | Required |
|-------|------|----------|
| `password` | string (write-only) | yes — the caller's *current* password |

The password re-check is deliberate: a bearer token proves only that a session is
open, not that the person is present. In order, `destroy` then blacklists every
outstanding refresh token for the user, deletes their **unstarted** lobby entries
(`waiting` games, never-joined matches), flags every remaining seat they hold as
**closed** (`player*_deleted`), and finally calls `user.delete()`.

Everything else survives: user FKs are `on_delete=SET_NULL`, so each seat is
*anonymised* — names, boards, winners, scores and match history stay intact and
the opponent's stats are unchanged. See
[data-model.md](data-model.md#closed-seats-player_deleted) for what a closed seat
means and why such a game deadlocks rather than forfeiting.

**204** → no body. The account is gone; access tokens 401 immediately (the user
row no longer resolves) and refresh tokens 401 as blacklisted.

| Status | Trigger |
|--------|---------|
| 400 | `{"password": ["Password is incorrect."]}` — wrong password; nothing is deleted or blacklisted |
| 400 | `{"password": ["This field is required."]}` — password omitted |
| 401 | missing/invalid bearer token |

Covered by
[`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py).

---

## Games

### The `Game` payload

`GameSerializer` is `fields = "__all__"` over the `Game` model plus two computed
fields. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | |
| `match` | int \| null | read-only; set only by the match flow |
| `player1_user` / `player2_user` | int \| null | read-only; null = guest seat |
| `player1_name` / `player2_name` | string | the only writable fields |
| `player1_deleted` / `player2_deleted` | bool | read-only; `true` = **closed seat** (its registered owner deleted their account) |
| `board_state` | object | `{ "points": int[24], "bar": {p1,p2}, "off": {p1,p2} }` |
| `current_turn` | `"p1"` \| `"p2"` | read-only |
| `dice_values` | int[] | `[]` = not rolled; doubles are 4 identical values |
| `status` | `"waiting"` \| `"active"` \| `"finished"` | read-only |
| `winner` | `"p1"` \| `"p2"` \| null | read-only |
| `win_type` | `"normal"`/`"gammon"`/`"backgammon"`/`"drop"` \| null | read-only |
| `points_value` | int \| null | `win_points(win_type) × cube_value`, or the pre-double cube value on a drop |
| `cube_value` | int | 1…64, read-only |
| `cube_owner` | `"p1"`/`"p2"`/null | seat, not a user FK; null = centered |
| `double_offered_by` | `"p1"`/`"p2"`/null | a pending, unanswered offer |
| `crawford_game` | bool | cube disabled for this game |
| `created_at` / `updated_at` | ISO datetime | read-only |
| `viewer_seat` | `"p1"`/`"p2"`/`"p1p2"`/null | computed per request |
| `viewer_is_participant` | bool | `viewer_seat is not None` |

Everything except `player1_name`/`player2_name` is in `read_only_fields`, so a
write request can only ever set those two. `player1_deleted`/`player2_deleted`
are exposed so a client can show "this player deleted their account" instead of
leaving the opponent waiting on a turn that never comes, but they are read-only
like the rest — writable, a caller could close a seat at create time and grief
the other player.

**`viewer_seat` semantics.** Computed by matching the *requesting authenticated
user's* id against `player1_user_id` / `player2_user_id`:

- `"p1"` / `"p2"` — the requester owns that seat.
- `"p1p2"` — the requester owns **both** seats (a logged-in hotseat game).
- `null` — the requester is anonymous, or is authenticated but owns neither
  seat. Guests always get `null`; they have no server identity.

It is an authoritative server-side ownership signal usable on a fresh device
with no local seat record (e.g. a deep link opened for the first time). Guests
fall back to the client's device-local seat registry. Covered by `ViewerSeatTest`
in [`test_lobby.py`](../../backend/game/tests/test_lobby.py).

### `GET /api/games/`

**200** → array of games. Optional filter `?status=waiting|active|finished`
(exact match on `status`; any other query param is ignored). `?status=waiting`
is the lobby / open-games list. Paginated at 100 per page (bare array — see
[Conventions](#conventions)).

### `POST /api/games/`

| Field | Type | Required |
|-------|------|----------|
| `player1_name` | string | no — defaults to the authenticated username, else `"Player 1"` |
| `player2_name` | string | no — omit/blank to open a lobby game |

Server sets `board_state` to the initial position, `current_turn="p1"`,
`dice_values=[]`, and `player1_user` to the authenticated user (or null).

- Both names present → `status="active"` (hotseat / guest).
- Only player 1 → `status="waiting"` (waiting for an opponent).

**201** → the created game.

### `GET /api/games/{id}/`

**200** → the game (including `viewer_seat` for this requester).
**404** → `{"detail": "Not found."}` for an unknown id.

### `PUT` / `PATCH` / `DELETE /api/games/{id}/`

**Not routed — 405.** `GameViewSet` is deliberately assembled from the create /
list / retrieve mixins rather than being a `ModelViewSet`: the generic write
verbs were previously exposed with no seat check at all, letting any caller
overwrite a board mid-game or delete someone else's game. All state changes go
through the custom actions below, which enforce seat ownership.

### `POST /api/games/{id}/join/`

Join a waiting game as player 2.

| Field | Type | Required |
|-------|------|----------|
| `player2_name` | string | required for guests; authenticated users default to their username |

On success sets `player2_user` (or null), `player2_name`, and
`status="active"`. **200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | `"Game is not open to join."` — `status != "waiting"` |
| 400 | `"player2_name is required when joining as a guest."` — anonymous and no name |
| 404 | unknown id |

### `POST /api/games/{id}/roll_dice/`

No body. Rolls for `current_turn`; doubles produce four identical values. The
roll is recorded **even when it leaves no legal move** — the client then calls
`confirm_turn` with an empty `moves` list to pass.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement (see below) — checked first |
| 400 | `"Game is not active."` |
| 400 | `"A double has been offered. The opponent must accept or drop first."` |
| 400 | `"Dice have already been rolled for this turn."` (`dice_values` non-empty) |
| 404 | unknown id |

### `POST /api/games/{id}/move_checker/` (legacy)

**No client uses this** — both clients stage moves locally and commit via
`confirm_turn`. It still exists, is tested, and applies exactly one move.

| Field | Type | Required |
|-------|------|----------|
| `from_point` | int, 1–24 (`0` = enter from the bar) | yes |
| `to_point` | int, 1–24 (`25` = bear off) | yes |

Applies the move, then: if the position is a win, finishes the game; else if no
dice or no legal moves remain, passes the turn and clears the dice; else stores
the remaining dice. When a bear-off matches several dice, the **smallest**
matching die is consumed, keeping larger dice free for later oversized bear-offs.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement |
| 400 | pending double |
| 400 | `"from_point and to_point are required."` |
| 400 | `"Game is not active."` |
| 400 | `"Illegal move."` — not in `get_legal_moves` (includes the "no dice rolled" case) |

Note the check order: a missing `from_point`/`to_point` is rejected *before* the
game-active check. Unlike `confirm_turn`, this endpoint enforces **neither**
maximal dice usage nor the higher-die rule.

### `POST /api/games/{id}/confirm_turn/`

The live path. Commits a whole staged turn atomically and passes it on.

```json
{ "moves": [ { "from_point": 1, "to_point": 3 }, { "from_point": 3, "to_point": 8 } ] }
```

`moves` defaults to `[]` (a pass). Each entry consumes exactly one die — the
clients expand a combined multi-die drag into sequential single hops before
sending; the server has no notion of a combined move
([ADR-001](../decisions/adr-001-combined-moves.md)).

Moves are applied to a deep copy; **if any check fails nothing is saved** and
the pre-turn `board_state`, `dice_values`, and `current_turn` are intact
(asserted in [`test_seat_security.py`](../../backend/game/tests/test_seat_security.py)).
On success the turn passes to the opponent with `dice_values=[]`, or the game
finishes if the last checker came off.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement — checked first |
| 400 | `"Game is not active."` |
| 400 | pending double (`"...accept or drop first."`) |
| 400 | `"No dice rolled for this turn."` — `dice_values` empty |
| 400 | `"moves must be a list."` |
| 400 | `"Each move requires from_point and to_point."` |
| 400 | `"Illegal move."` — any single hop is not legal |
| 400 | **maximal dice usage** (below) |
| 400 | **higher-die bear-off rule** (below) |
| 404 | unknown id |

**Maximal dice usage.** After replaying the staged moves the view compares dice
consumed against `max_moves_usable(pre_turn_board, player, dice)` — a recursive
search over every order of play. If a longer legal sequence existed:

> `"You must use as many dice as possible. A legal move remains for an unused die."`

This is what makes passing with an empty `moves` list legal *only* when the roll
is genuinely dead (`max_usable == 0`). Clients mirror it as a Confirm-button
affordance; the server is authoritative.

**Higher-die rule (bear-off only).** `higher_die_required_moves` applies when the
roll is a non-double two-die roll, the player can bear off, exactly one die is
playable (`max_usable == 1`), and *either* die individually has a legal move. The
single staged `(from_point, to_point)` must be in the returned permitted set, or:

> `"When only one die can be played, you must play the higher die (N)."`

Outside bear-off the official general rule is **not** enforced — see
[game-logic.md](game-logic.md) and Known gaps in [CLAUDE.md](../../CLAUDE.md).

### `POST /api/games/{id}/offer_double/`

No body. Sets `double_offered_by` to the current-turn seat. While that is set,
`roll_dice`, `move_checker`, and `confirm_turn` all return 400 until the offer is
answered.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement against `current_turn` (opponent gets `"It's not your turn."`) |
| 400 | `"Game is not active."` |
| 400 | `"The doubling cube is disabled during the Crawford game."` |
| 400 | `"A double has already been offered."` |
| 400 | `"You can only double before rolling."` — `dice_values` non-empty |
| 400 | `"Your opponent owns the cube — only they may double."` |
| 400 | `"The cube is already at its maximum value (64)."` |

A centered cube (`cube_owner = null`) may be doubled by either player; the cube
owner may redouble.

### `POST /api/games/{id}/respond_to_double/`

| Field | Type | Required |
|-------|------|----------|
| `accept` | boolean (strictly `true`/`false`) | yes |

- **Accept** → `cube_value *= 2`, `cube_owner = responder`,
  `double_offered_by = null`. The offerer then rolls as normal.
- **Drop** → the game finishes immediately: `winner = double_offered_by`,
  `win_type = "drop"`, `points_value = cube_value` (the **pre-double** value),
  and the linked match score updates.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | `"Game is not active."` |
| 400 | `"No double has been offered."` |
| 403 | seat enforcement against the **responder** seat (`opponent(double_offered_by)`) — the offerer answering their own double gets `"It's not your turn."` |
| 400 | `"accept must be true or false."` — missing or non-boolean |

Check order is unusual here: game-state validation runs **before** the
permission check, so a non-participant hitting a finished game gets 400, not 403.

---

## Matches

### The `Match` payload

`MatchSerializer`, `fields = "__all__"` plus `current_game_id`:
`id`, `player1_user`, `player2_user`, `player1_name`, `player2_name`,
`player1_deleted`, `player2_deleted`,
`target_points`, `player1_score`, `player2_score`,
`status` (`"active"`/`"finished"`), `winner` (`"p1"`/`"p2"`/null),
`created_at`, `updated_at`, `current_game_id`.

`current_game_id` resolves to the match's first `status="active"` game, falling
back to its most recent game, else null. Writable fields: `player1_name`,
`player2_name`, `target_points` — everything else is read-only, including the
two `player*_deleted` closed-seat flags (same meaning as on `Game`).

`MatchSerializer` has **no `viewer_seat`**; that field is game-only.

### `GET /api/matches/`

**200** → array of matches. No `?status` filter (unlike games); paginated at 100
per page like `/api/games/`.

### `POST /api/matches/`

| Field | Type | Required |
|-------|------|----------|
| `player1_name` | string | no — defaults to the authenticated username, else `"Player 1"` |
| `player2_name` | string | no — omit for an online/link match |
| `target_points` | int, one of **3, 5, 7, 9** | no — defaults to 5 |

Creates the match **and its first game** in one call (initial board,
`current_turn="p1"`), `active` if `player2_name` was given, else `waiting`.

**201** → the match (use `current_game_id` to reach the game).
**400** → `{"error": "target_points must be 3, 5, 7, or 9."}` for any other value.

### `POST /api/matches/{id}/next_game/`

No body. Starts the next game after the previous one finished. The previous
winner moves first (`"p1"` if there is no finished game yet).

Assigns `crawford_game=True` when a player has just reached match point
(`target_points − 1` equals either score) **and** no game in the match is already
flagged Crawford — exactly one Crawford game per match. It also copies the
match's `player1_deleted` / `player2_deleted` onto the new game, so a closed seat
stays closed instead of reappearing as a guest seat on a fresh board.

**201** → the new game (`GameSerializer`).

| Status | Trigger |
|--------|---------|
| 403 | `_match_permission_error` (see below) — checked first |
| 400 | `"Match is already finished."` |
| 400 | `"A game is already in progress."` — an `active` or `waiting` game exists |
| 404 | unknown id |

**Participant enforcement.** `_match_permission_error` is the match-level lift of
the seat rule: a request is allowed if the caller could act for *either* seat.

| Requester | Result |
|-----------|--------|
| a registered participant (owns either seat) | allowed |
| any other logged-in account | 403 `"You are not a participant in this match."` |
| anonymous, ≥ 1 seat null **and not closed** | allowed (guest/hotseat matches) |
| anonymous, both seats registered *or* closed | 403 `"This match belongs to registered players. Log in to continue it."` |

A **closed** seat does not count as a guest seat despite its null FK — otherwise
deleting an account would silently open every match you were in to anonymous
callers.

### `POST /api/matches/{id}/join/`

Join a match as player 2 (online match links).

| Field | Type | Required |
|-------|------|----------|
| `player2_name` | string | required for guests; authenticated users default to their username |

Sets the match's `player2_user`/`player2_name` and promotes the match's first
`waiting` game to `active` with the same player-2 identity.

**200** → the updated match.

| Status | Trigger |
|--------|---------|
| 400 | `"Match already has two players."` — `player2_name` already set |
| 400 | `"player2_name is required for guest join."` |
| 404 | unknown id |

---

## Seat enforcement

`_seat_permission_error` in [`views.py`](../../backend/game/views.py) guards the
five gameplay actions (`roll_dice`, `move_checker`, `confirm_turn`,
`offer_double`, `respond_to_double`). It checks the seat being acted for —
`game.current_turn` by default, or the explicit responder seat for
`respond_to_double`. On rejection: **403** with `{"error": "<message>"}`.

| Seat FK | Requester | Result |
|---------|-----------|--------|
| **null + `player*_deleted`** (closed) | **anyone, including the surviving opponent** | **403** `"This player deleted their account — their seat is closed."` |
| registered user | that user | allowed |
| registered user | the other participant | 403 `"It's not your turn."` |
| registered user | another logged-in account | 403 `"You are not a participant in this game."` |
| registered user | anonymous | 403 `"This seat belongs to a registered player. Log in as them to play it."` |
| null (guest) | anonymous | **allowed** |
| null (guest) | a participant of this game | allowed (covers hotseat) |
| null (guest) | another logged-in account | 403 `"You are not a participant in this game."` |

The closed-seat row is checked **first**, before every other branch. A seat is
closed when its flag is true *and* its FK is null — i.e. a registered player was
there and deleted their account (`DELETE /api/auth/me/`). Without it the null FK
would fall through to the guest rule and the seat would become anonymously
playable by anyone holding the game id. The surviving opponent is refused too:
they satisfy the participant test on the orphaned seat and could otherwise play
both sides of the board. Consequence: such a game **deadlocks** — no action on
the closed seat ever succeeds and nothing auto-forfeits it. See
[data-model.md](data-model.md#closed-seats-player_deleted).

Consequences worth knowing:

- **Fully-guest games are unrestricted** — no FKs means nothing to verify.
- Enforcement is exactly as strong as the seat FKs: a guest seat is
  unverifiable, so an attacker can log out and act on one anonymously. See
  [auth.md](auth.md#security-note-current-limitations).
- The **web UI does not gate** locally — an unauthorized click surfaces the
  server's 403. Mobile hides controls via
  [`gating.js`](../../mobile/src/game/gating.js) as UX on top of the same rules.
- `next_game` is guarded by the separate `_match_permission_error`
  ([above](#post-apimatchesidnext_game)); `join` on either resource is **not**
  guarded at all, and `PUT`/`PATCH`/`DELETE` are no longer routed.

Covered by [`test_seat_security.py`](../../backend/game/tests/test_seat_security.py),
the permission tests in [`test_cube.py`](../../backend/game/tests/test_cube.py),
and the closed-seat tests in
[`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py).

---

## Planned / Not Yet Implemented

Not in the code today — do not assume them:

- **Filtering beyond `?status`.** No ordering param and no search. (Pagination
  *does* exist — see [Conventions](#conventions).)
- **A "my games" endpoint.** Nothing filters by the requesting user; clients
  fetch by id or list everything.
- **Real-time push.** No WebSockets/Channels/ASGI and no long-poll endpoint.
  Mobile polls the game detail route (~3.5s in
  [`useGame.js`](../../mobile/src/game/useGame.js)); web has no auto-refresh.
- **Matchmaking / lobby queue endpoints.** Pairing is manual via
  `?status=waiting` plus `join`. No queue, ranking, or auto-pairing route.
- **Resign / abandon / rematch endpoints.** A game can only end on the board or
  by dropping a double — which is also why a closed seat leaves a game
  permanently stuck rather than forfeited.
- **Chat.** No endpoint exists.
- **A logout endpoint.** The blacklist app *is* installed and is used by refresh
  rotation and by account deletion, but no route revokes a token on demand —
  clients just discard them.
- **Password reset / change, or any email flow.** Account *deletion* exists
  (`DELETE /api/auth/me/`); nothing else mutates credentials.
- **API versioning and an OpenAPI/schema endpoint.** Paths are unversioned and
  no schema generator is installed; the browsable `DefaultRouter` root is the
  only self-description.
