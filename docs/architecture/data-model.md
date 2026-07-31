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
| Seats / turn ownership | Derived from the `player1_user`/`player2_user` FKs at request time, not stored: server-side enforcement (`_seat_permission_error`) and the `viewer_seat` / `viewer_is_participant` serializer fields all read the FKs; mobile adds a **device-local** SecureStore registry. No `Seat` table. The one piece of seat state that *is* stored is closure — see [Closed seats](#closed-seats-player_deleted). |
| Cube ownership | `Game.cube_owner` / `double_offered_by` hold a **seat string** (`"p1"`/`"p2"`), not a user FK — a guest owning the cube has no User row to point at. |
| Player stats | **Computed on read** in `UserSerializer` by aggregating finished `Game` rows; nothing is denormalized. |
| "Game code" | The game's integer primary key, surfaced as a shareable code in the UI. No separate column. |

## `Match`

A best-of-N-points series of games.

| Field | Type | Notes |
|-------|------|-------|
| `player1_user`, `player2_user` | FK → `User`, nullable | `SET_NULL`; null for guests |
| `player1_name`, `player2_name` | Char | `player2_name` blank until joined |
| `player1_deleted`, `player2_deleted` | Bool, default `False` | `True` = **closed seat**: its registered owner deleted their account. See [Closed seats](#closed-seats-player_deleted) |
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
| `player1_deleted`, `player2_deleted` | Bool, default `False` | `True` = **closed seat**: its registered owner deleted their account. See [Closed seats](#closed-seats-player_deleted) |
| `board_state` | **JSONField** | `{ points[24], bar{p1,p2}, off{p1,p2} }` |
| `current_turn` | Char | `"p1"` / `"p2"` |
| `dice_values` | **JSONField** (list) | remaining dice this turn; `[]` between turns |
| `status` | Char | `waiting` / `active` / `finished` |
| `winner` | Char, nullable | `"p1"` / `"p2"` |
| `win_type` | Char, nullable | `normal` / `gammon` / `backgammon` / `drop` (conceded double) |
| `points_value` | PositiveInt, nullable | points the win was worth — `win_points × cube_value` for board wins, the pre-double cube value for drops |
| `cube_value` | PositiveInt | doubling cube: 1 (default) → 64 |
| `cube_owner` | Char, nullable | seat `"p1"`/`"p2"`; null = centered. A seat, **not** a user FK — guests have no User row |
| `double_offered_by` | Char, nullable | seat of a pending, unanswered double offer; blocks gameplay while set |
| `crawford_game` | Bool | cube disabled for this game (first game after a player reaches match point) |
| `created_at`, `updated_at` | DateTime | `updated_at` drives mobile's poll-diffing |

Both models order by `["-created_at", "-id"]`. The four cube fields were added by
migration `0003_game_crawford_game_game_cube_owner_game_cube_value_and_more`;
existing rows default to a centered cube at value 1 with `crawford_game=False`.
The four `player*_deleted` flags (two per model) were added by
`0004_game_player1_deleted_game_player2_deleted_and_more`; existing rows default
to `False`, i.e. no seat is closed.

### Lifecycle

```
create ──► waiting ──(opponent joins)──► active ──(15 borne off)──► finished
   │                                            │                      │
   │                                            └──(double dropped)────┤
   └── hotseat (both names given at creation)                          │
       starts active                                                   ▼
                                          win_type / points_value / winner set;
                                          dice_values + double_offered_by cleared;
                                          Match score updated if part of a match
```

A game can therefore finish **without** anyone bearing off 15 checkers: declining
a double ends it immediately with `win_type="drop"` (see
[game-logic.md](game-logic.md#doubling-cube)). Both paths run through
`_apply_game_result` in [`views.py`](../../backend/game/views.py).

`board_state` is initialized by `get_initial_board_state()` to the standard opening
position. Each committed turn overwrites `board_state` and clears/refills
`dice_values`. There is no move history table — only the current position is kept.

## Closed seats (`player*_deleted`)

Account deletion (`DELETE /api/auth/me/` → `MeView.destroy` in
[`views.py`](../../backend/game/views.py)) **anonymises** seats rather than
destroying them: every user FK is `on_delete=SET_NULL` and the display name is a
plain `CharField`, so the seat keeps its name, board, winner, scores and match
history while the FK goes null. That alone would make a departed player's seat
indistinguishable from a **guest** seat — and guest seats are deliberately
playable by anonymous callers, because a guest has no identity to verify. Without
a marker, deleting your account would hand your live games to whoever knows the id.

`_close_deleted_account_seats(user)` supplies the missing state: immediately
before `user.delete()` it sets the flag on every `Game` and `Match` row where the
user held a seat. The three seat states are then distinguishable:

| Seat state | User FK | Flag | Who may act on it |
|------------|---------|------|-------------------|
| **Owned** | user id | `False` | only that user |
| **Guest** | null | `False` | anonymous callers, plus this game's registered participants (hotseat) |
| **Closed** | null | `True` | **nobody** |

Consequences, all in [`views.py`](../../backend/game/views.py):

- `_seat_permission_error` refuses a closed seat with **403** for *every* caller,
  including the surviving opponent — who would otherwise satisfy the
  "participant" rule on the orphaned seat and be able to play both sides.
- `_match_permission_error`'s anonymous fallback requires a seat that is null
  **and not closed**, so deleting an account doesn't quietly open every match you
  were in to anonymous callers. A registered opponent still qualifies via their
  own seat.
- `next_game` copies `player1_deleted` / `player2_deleted` from the `Match` onto
  the `Game` it creates, or the fresh game's orphaned seat would look like a
  guest seat again.
- Both flags are in `read_only_fields` on `GameSerializer` / `MatchSerializer`
  and are exposed in API output, so a client can say "this player deleted their
  account" instead of leaving the opponent waiting on a turn that never comes.

**A closed seat deadlocks an in-progress game; it does not forfeit it.** Nothing
sets `winner`, `win_type`, `points_value`, or `status="finished"`, and no match
score moves — the game simply can never be advanced again. This is deliberate:
the opponent's record is preserved exactly as played rather than being credited
with a win they didn't earn, and there is no resign/forfeit endpoint to invoke
(see [api.md](api.md#planned--not-yet-implemented)). Only *unstarted* rows are
removed on deletion — `_purge_unjoined_lobby_entries` deletes the account's
`waiting` games and never-joined matches, which nobody else has played.

Pinned by [`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py).

## Relationships

```
User ──< Game (player1_user / player2_user)
User ──< Match (player1_user / player2_user)
Match ──< Game (match, related_name="games")
```

All FKs are nullable with `on_delete=SET_NULL`, so deleting a user or match leaves
game rows intact (with null references) rather than cascading. For users that
anonymisation is paired with the `player*_deleted` flags above, which is what
keeps an orphaned seat from being mistaken for a guest seat.

## Stats derivation

`UserSerializer` computes, per request, over that user's finished games (as either
player): wins, losses, total games, gammons, backgammons, points won/lost, win % and
gammon rate. It caches the aggregate on the object for the duration of one
serialization. Nothing is stored — changing the stat definitions is a serializer
edit, not a migration.

Cube interaction: points won/lost sum `points_value`, which is **already
cube-multiplied**, so stats reflect cube stakes automatically. A `drop` win counts
as a win (and its points) but never as a gammon/backgammon, since those counts
filter on `win_type`.

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
