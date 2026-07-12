# Data Model

The persisted schema, as defined in [`backend/game/models.py`](../../backend/game/models.py)
and managed by Django migrations in `backend/game/migrations/`.

> **Current database is SQLite** (dev, `backend/db.sqlite3`). PostgreSQL is the
> intended production target but is **not** configured — see
> [Planned / Not Yet Implemented](#planned--not-yet-implemented).

## What is (and isn't) a model

There are exactly **two app models — `Match` and `Game`** — plus Django's built-in
`auth.User`. Several concepts that sound like tables are **not** persisted as models:

| Concept | How it's actually stored |
|---------|--------------------------|
| Players / accounts | Django's `auth.User`; games reference them via nullable FKs. Guests have no user row at all. |
| Board position | `Game.board_state` — a single **JSONField** (`points`/`bar`/`off`), not per-checker rows. |
| Dice for the turn | `Game.dice_values` — a JSONField list. |
| Pending / staged moves | **Not persisted.** Built client-side and sent in one `confirm_turn` call; the backend replays them against a copy and saves only the resulting board. |
| Seats / turn ownership | Derived from the `player1_user`/`player2_user` FKs at request time, not stored: server-side enforcement (`_seat_permission_error`) and the `viewer_seat` serializer field both read the FKs; mobile adds a **device-local** SecureStore registry. No `Seat` table. |
| Player stats | **Computed on read** in `UserSerializer` by aggregating finished `Game` rows; nothing is denormalized. |
| "Game code" | The game's integer primary key, surfaced as a shareable code in the UI. No separate column. |

## `Match`

A best-of-N-points series of games.

| Field | Type | Notes |
|-------|------|-------|
| `player1_user`, `player2_user` | FK → `User`, nullable | `SET_NULL`; null for guests |
| `player1_name`, `player2_name` | Char | `player2_name` blank until joined |
| `target_points` | PositiveInt | 3 / 5 / 7 / 9 (validated in the view, default 5) |
| `player1_score`, `player2_score` | PositiveInt | running match score |
| `status` | Char | `active` / `finished` |
| `winner` | Char, nullable | `"p1"` / `"p2"` |
| `created_at`, `updated_at` | DateTime | auto |

A `Match` owns many `Game`s (`related_name="games"`). `MatchSerializer` adds a derived
`current_game_id` (the active game, else the most recent).

## `Game`

A single game to bearing off all 15 checkers. Can be standalone or part of a `Match`.

| Field | Type | Notes |
|-------|------|-------|
| `match` | FK → `Match`, nullable | `SET_NULL`; null for one-off games |
| `player1_user`, `player2_user` | FK → `User`, nullable | seat ownership; null for guests |
| `player1_name`, `player2_name` | Char | `player2_name` blank until joined |
| `board_state` | **JSONField** | `{ points[24], bar{p1,p2}, off{p1,p2} }` |
| `current_turn` | Char | `"p1"` / `"p2"` |
| `dice_values` | **JSONField** (list) | remaining dice this turn; `[]` between turns |
| `status` | Char | `waiting` / `active` / `finished` |
| `winner` | Char, nullable | `"p1"` / `"p2"` |
| `win_type` | Char, nullable | `normal` / `gammon` / `backgammon` |
| `points_value` | PositiveInt, nullable | points the win was worth (1/2/3) |
| `created_at`, `updated_at` | DateTime | `updated_at` drives mobile's poll-diffing |

Both models order by `["-created_at", "-id"]`.

### Lifecycle

```
create ──► waiting ──(opponent joins)──► active ──(15 borne off)──► finished
   │                                                                   │
   └── hotseat (both names given at creation) starts active            └── win_type / points_value / winner set;
                                                                            Match score updated if part of a match
```

`board_state` is initialized by `get_initial_board_state()` to the standard opening
position. Each committed turn overwrites `board_state` and clears/refills
`dice_values`. There is no move history table — only the current position is kept.

## Relationships

```
User ──< Game (player1_user / player2_user)
User ──< Match (player1_user / player2_user)
Match ──< Game (match, related_name="games")
```

All FKs are nullable with `on_delete=SET_NULL`, so deleting a user or match leaves
game rows intact (with null references) rather than cascading.

## Stats derivation

`UserSerializer` computes, per request, over that user's finished games (as either
player): wins, losses, total games, gammons, backgammons, points won/lost, win % and
gammon rate. It caches the aggregate on the object for the duration of one
serialization. Nothing is stored — changing the stat definitions is a serializer
edit, not a migration.

## Planned / Not Yet Implemented

- **PostgreSQL in production.** Only SQLite is configured today; no Postgres
  engine, driver, or connection settings exist.
- **A persisted `Seat`/participant model.** Seat ownership is derived from the user
  FKs at request time (which is also how server-side turn enforcement works); there
  is no dedicated table, and guest seats therefore carry no identity at all.
- **Move history / persisted pending moves.** Only the current board is stored; there
  is no per-move audit trail.
- **Denormalized stats.** Stats are recomputed on every read; there is no stored
  win/loss tally.
