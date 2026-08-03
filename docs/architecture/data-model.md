# Data Model

The persisted schema, as defined in [`backend/game/models.py`](../../backend/game/models.py)
and managed by Django migrations in `backend/game/migrations/`.

> **Every environment today resolves to SQLite** (`backend/db.sqlite3`). PostgreSQL
> is *wired* — `DATABASES` is built by `dj_database_url.config()` from
> `DATABASE_URL`, and `psycopg2-binary` is pinned in `requirements.txt` — but no
> environment sets that variable yet, so the migrations have only ever been applied
> against SQLite. See [Planned / Not Yet Implemented](#planned--not-yet-implemented).

## What is (and isn't) a model

There are **three app models — `Match`, `Game` and `UserPreferences`** — plus
Django's built-in `auth.User`. The first two are the game itself; the third is a
single optional row hanging off a user, and is described in
[`UserPreferences`](#userpreferences) below. Several concepts that sound like
tables are **not** persisted as models:

| Concept | How it's actually stored |
|---------|--------------------------|
| Players / accounts | Django's `auth.User`; games reference them via nullable FKs. Guests have no user row at all. |
| Per-account settings | `UserPreferences`, a **`OneToOneField`** on `User` — and **optional**: no row means "all defaults". See [`UserPreferences`](#userpreferences). |
| Board position | `Game.board_state` — a single **JSONField** (`points`/`bar`/`off`), not per-checker rows. |
| Dice for the turn | `Game.dice_values` — a JSONField list. |
| Pending / staged moves | **Not persisted.** Built client-side and sent in one `confirm_turn` call; the backend replays them against a copy and saves only the resulting board. |
| Seats / turn ownership | Derived from the `player1_user`/`player2_user` FKs at request time, not stored: server-side enforcement (`_seat_permission_error`) and the `viewer_seat` / `viewer_is_participant` serializer fields all read the FKs; mobile adds a **device-local** SecureStore registry. No `Seat` table. The one piece of seat state that *is* stored is closure — see [Closed seats](#closed-seats-player_deleted). |
| Cube ownership | `Game.cube_owner` / `double_offered_by` hold a **seat string** (`"p1"`/`"p2"`), not a user FK — a guest owning the cube has no User row to point at. |
| Player stats | **Computed on read** in `UserSerializer` by aggregating finished `Game` rows; nothing is denormalized. |
| "Game code" | The game's integer primary key, surfaced as a shareable code in the UI. No separate column. |

## `UserPreferences`

Per-account settings that are **not** part of identity. One row per user, at
most, and often none at all.

| Field | Type | Notes |
|-------|------|-------|
| `user` | **OneToOneField → `User`**, `CASCADE`, `related_name="preferences"` | the row dies with the account |
| `turn_reminder_emails` | Bool, **default `True`** | opt-out for `manage.py send_turn_reminders`. Writable at `PATCH /api/auth/me/` — see [api.md](api.md#patch-apiauthme) |
| `created_at`, `updated_at` | DateTime | auto |

Added by migration `0007_userpreferences`, with **no data migration**: the table
is created empty and stays that way until somebody changes a setting.

**Why a `OneToOneField` and not a column.** `AUTH_USER_MODEL` is Django's stock
`auth.User`. There is nowhere to hang a column on it without swapping the user
model out from under six migrations' worth of FKs — a change enormously larger
than one boolean is worth, and one that would touch every `Game` and `Match` seat
reference. A one-to-one side table is Django's standard answer and the least
invasive one: nothing that reads a `User` today has to change, and the next
non-identity setting is a field on this model rather than another migration
argument.

**The row is optional, and absence is a meaning, not a gap.** Every account
predating the table has none, and neither `User.objects.create_user` nor
`RegisterSerializer` creates one — registration is unchanged. **Absence means
"all defaults."** Two consequences follow and both are load-bearing:

- **Every field here must keep a sensible default**, because the default is what
  a missing row resolves to.
- **`UserPreferences.reminders_enabled(user)` is the single source of truth.** It
  answers `True` for a user with no row (catching `RelatedObjectDoesNotExist`),
  `False` for `None`, and **never writes** — it is read once per candidate game on
  every cron tick. Both readers go through it: the reminder command, and
  `UserSerializer.to_representation`.

The row is created **lazily**, by `UserPreferences.for_user()` from the first
`PATCH /api/auth/me/` that actually changes a preference. So no backfill has to
walk the user table, and a plain profile `GET` stays a read.

> **The trap this shape sets, which was a real bug caught by a test.**
> `UserSerializer` declares `turn_reminder_emails` with
> `source="preferences.turn_reminder_emails"`. DRF's `default=` applies on the
> way **in**, to deserialisation — so on the way *out* a dotted source with no
> related row simply reads `None`. Both clients render this as a checkbox and
> `None` is falsy, so every account that had never opened its settings — which is
> all of them, the row being lazy — would have been shown "turn reminders: off"
> while the command happily mailed them. A consent control that misreports
> consent is worse than none. The serializer therefore overrides
> `to_representation` to answer from `reminders_enabled`, the same helper the
> command asks, so the reported value cannot drift from the behaviour it
> describes. **Do not "simplify" that back into a `default=`.**

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
| `win_type` | Char, nullable | `normal` / `gammon` / `backgammon` / `drop` (conceded double) / `timeout` (opponent ran out the inactivity clock) / `abandoned` (deadlocked game closed out — no winner) |
| `points_value` | PositiveInt, nullable | points the win was worth — `win_points × cube_value` for board wins, the pre-double cube value for drops, `1 × cube_value` for timeouts, **`0`** when abandoned |
| `cube_value` | PositiveInt | doubling cube: 1 (default) → 64 |
| `cube_owner` | Char, nullable | seat `"p1"`/`"p2"`; null = centered. A seat, **not** a user FK — guests have no User row |
| `double_offered_by` | Char, nullable | seat of a pending, unanswered double offer; blocks gameplay while set |
| `crawford_game` | Bool | cube disabled for this game (first game after a player reaches match point) |
| `turn_started_at` | DateTime, nullable | when the **waiting seat** came on the inactivity clock. Null = no clock running. See [The turn clock](#the-turn-clock-turn_started_at) |
| `turn_reminder_sent_at` | DateTime, nullable | when `send_turn_reminders` last mailed the waiting seat about **this** turn. Null = not yet reminded. Cleared by `_begin_turn()`. See [The turn-reminder stamp](#the-turn-reminder-stamp-turn_reminder_sent_at) |
| `created_at`, `updated_at` | DateTime | `updated_at` drives both clients' poll-diffing |

Both models order by `["-created_at", "-id"]`. The four cube fields were added by
migration `0003_game_crawford_game_game_cube_owner_game_cube_value_and_more`;
existing rows default to a centered cube at value 1 with `crawford_game=False`.
The four `player*_deleted` flags (two per model) were added by
`0004_game_player1_deleted_game_player2_deleted_and_more`; existing rows default
to `False`, i.e. no seat is closed. `turn_started_at` arrived nullable in
`0005_game_turn_started_at`, which also backfills in-flight games — see
[the backfill](#the-turn-clock-turn_started_at) — and
`turn_reminder_sent_at` came last, nullable with no backfill, in
`0006_game_turn_reminder_sent_at`; null is the correct starting value for every
existing row, since nothing has been reminded about anything. `0007_userpreferences`
adds no `Game` field at all — it creates the [`UserPreferences`](#userpreferences)
table, empty.

`Game` also carries one derived property, `waiting_seat` — `current_turn` except
while `double_offered_by` is set, where it is the responder. It is the server's
single copy of that rule: `abandon`, `claim_timeout` and `GameSerializer` all
read it. Both clients mirror it as `blockedSeat`.

### Lifecycle

```
create ──► waiting ──(opponent joins)──► active ──(15 borne off)──► finished
   │                                            │                      │
   │                                            ├──(double dropped)────┤
   │                                            ├──(timeout claimed)───┤
   │                                            └──(abandoned)─────────┤
   └── hotseat (both names given at creation)                          │
       starts active                                                   ▼
                                          win_type / points_value / winner set;
                                          dice_values + double_offered_by cleared;
                                          Match score updated if part of a match
                                          (abandonment writes no score at all)
```

A game can therefore finish **without** anyone bearing off 15 checkers, by three
different routes:

- declining a double ends it immediately with `win_type="drop"` (see
  [game-logic.md](game-logic.md#doubling-cube));
- [`claim_timeout`](api.md#post-apigamesidclaim_timeout) awards the present
  player a **real win** over an opponent who left the game waiting on them past
  `turn_started_at + TURN_TIMEOUT_HOURS` — `win_type="timeout"`, `winner` set,
  `points_value = 1 × cube_value`, match score updated normally;
- [`abandon`](api.md#post-apigamesidabandon) closes out a game deadlocked by a
  closed seat with `winner=null`, `win_type="abandoned"`, `points_value=0` and no
  change to the match score.

The last two look similar and are opposites: a timeout scores because somebody
really won, an abandonment does not because nobody did. `claim_timeout` refuses a
closed seat outright so the two can never be confused
([ADR-002](../decisions/adr-002-inactivity-forfeit.md)). Every path runs through
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
sets `winner`, `win_type`, `points_value`, or `status="finished"` on its own, and no
match score moves — the game simply can never be advanced again. This is deliberate:
the opponent's record is preserved exactly as played rather than being credited
with a win they didn't earn. Only *unstarted* rows are removed on deletion —
`_purge_unjoined_lobby_entries` deletes the account's `waiting` games and
never-joined matches, which nobody else has played.

The survivor's escape hatch is [`POST /api/games/{id}/abandon/`](api.md#post-apigamesidabandon),
and it is **not a resign**: it writes `status="finished"`, `winner=null`,
`win_type="abandoned"`, `points_value=0`, leaves the match score untouched, and sets
the match `status="finished"` so `next_game` can't mint an endless series of games
dead on arrival. No points are invented for anybody. Both clients surface the
deadlock and offer the control to the surviving seat only
(`isDeadlocked`/`canAbandon`, see
[clients.md](clients.md#closed-seats-and-the-inactivity-clock-the-predicates-both-clients-share)).

> **A knock-on that has since been closed:** an abandoned game is
> `status="finished"` with `winner=null`, and `UserSerializer` derives `losses` as
> `total_games − wins` — so the row *used to* land in the survivor's **loss**
> column. `_stats` now excludes `win_type="abandoned"` from every stat. See
> [Stats derivation](#stats-derivation).

Pinned by [`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py).

## The turn clock (`turn_started_at`)

A nullable `DateTimeField` on `Game` recording when the **waiting seat** came on
the clock — the anchor for the inactivity-forfeit deadline
([ADR-002](../decisions/adr-002-inactivity-forfeit.md)).

**`updated_at` cannot substitute for it.** `auto_now` bumps on every write for
any reason, so it cannot tell "idle for 20 hours" from "rolled 20 hours ago then
walked away" from "someone joined a minute ago." That is the entire reason this
column exists.

It is written by one helper, `_begin_turn()` in
[`views.py`](../../backend/game/views.py) — which fuses the timestamp to the
`current_turn` write so the two cannot drift — called wherever the waiting seat
changes and nowhere else: creating a game or match that starts **`active`**,
`join` (activating a `waiting` one), `confirm_turn` (turn passes),
`offer_double` (the wait flips to the responder), `respond_to_double` on a
**take** (it flips back to the offerer), and `next_game`. **`roll_dice`
deliberately does not touch it** — the same seat is still on the clock, and one
deadline is meant to cover rolling *and* moving.

Two things read it, both derived rather than stored: `Game.timeout_deadline()`
(`turn_started_at + TURN_TIMEOUT_HOURS`, or `None` when a claim is impossible in
principle) and the `turn_deadline` / `turn_waiting_seat` serializer fields the
clients render from. It is in `read_only_fields` — writable, a client could park
its own deadline in the future and make itself un-timeoutable.

`GameSerializer` also emits **`server_now`**, which is *not* a column and not
derived from this one: it is simply the moment the response was serialized,
always present, so a client can correct its own clock before comparing it to
`turn_deadline`. See
[api.md](api.md#server_now--the-clients-clock-is-not-trusted).

**Null is a real state, not a gap** — it means "no clock running", and
`timeout_deadline()` and `claim_timeout` both refuse to act on it.

Migration
[`0005_game_turn_started_at.py`](../../backend/game/migrations/0005_game_turn_started_at.py)
adds the column and then backfills it with a `RunPython` step: `active` rows get
`turn_started_at = updated_at` (written with `.update()`, so reading the
`auto_now` field doesn't rewrite it); `waiting` rows are skipped, since nobody is
on the clock until `join`; `finished` rows are skipped. Reverse is a `noop`.

`updated_at` is only an **approximation** — it marks the last write of any kind —
but it errs in the safe direction: where the row was touched after the turn
flipped, it reads *later* than the truth and the deadline comes out **generous**.
An early deadline would hand out a win nobody had earned yet; a late one costs
only patience. In practice no deployment exists, so the only rows this touches
are local dev games.

## The turn-reminder stamp (`turn_reminder_sent_at`)

A second nullable `DateTimeField` on `Game`, and the entire reason the reminder
mail is safe to schedule aggressively.

`manage.py send_turn_reminders` emails the seat on the clock
`TURN_REMINDER_LEAD_HOURS` (**default 12**) before `timeout_deadline()`. It is
invoked by a **platform cron** — there is no Celery and no in-process scheduler —
so it runs on a fixed interval (ten minutes is the documented recommendation),
which means it will re-encounter the same eligible game over and over. Without
state, that is one email every ten minutes for twelve hours.

`turn_reminder_sent_at` is that state: the command's candidate query filters on
it being null, and it is stamped **before** the mail goes out (see
[Claim, then send](#claim-then-send)). **`_begin_turn()`
clears it back to null** — the same helper that stamps `turn_started_at`, at the
same six call sites, in the same indivisible write — so the two fields move
together and each new turn gets exactly one fresh reminder. Fusing reset and
stamp in one helper is what keeps them from drifting apart; a turn can never
inherit the previous turn's "already reminded" mark, and a turn flip that forgot
to clear it would silence the reminder for that game **permanently**.
(`_turn_start_fields`, used where a row is created rather than mutated, is built
by running `_begin_turn` against a throwaway `Game()` rather than restating the
assignments, so it cannot fall behind either.)

### Claim, then send

The stamp is written **before** `send_mail`, by a conditional UPDATE whose WHERE
clause re-asserts, inside the writing statement, everything that could have
changed since the row was read a few lines earlier:

```python
claimed = Game.objects.filter(
    pk=game.pk,
    turn_started_at=game.turn_started_at,   # still the turn we composed about
    turn_reminder_sent_at__isnull=True,     # nobody else has claimed it
    status="active",                        # still a live game
).update(turn_reminder_sent_at=now)
if not claimed:
    return False
```

`.update()`'s affected-row count is the whole concurrency story. The **database**
picks the winner, so two overlapping cron runs on the same row produce one mail
and one no-op, with no lock and no `SELECT FOR UPDATE` held across an SMTP round
trip. A `confirm_turn` that flips the turn mid-flight fails the
`turn_started_at` clause, so the *fresh* turn can never inherit an
already-reminded mark. `.update()` rather than `.save()` also keeps the write
from stamping the whole row back over whatever else changed concurrently.

> **The trade-off, stated plainly: at most one lost reminder, never a
> duplicate.** Past the claim, the row says "mailed" whether or not the send
> below it succeeds — a process killed mid-SMTP loses that reminder until the
> turn flips. Un-claiming on failure looks like a free improvement and is not:
> `send_mail` can raise *after* the message was accepted, so the retry would
> double-mail. The same reasoning covers handled SMTP errors, which are logged
> and counted but leave the row claimed. One player missing one warning beats
> every player getting two.

`--dry-run` never writes the stamp at all, so a preview run does not consume the
turn's one reminder.

An opted-out recipient is skipped **without** being stamped
([`UserPreferences`](#userpreferences)): the stamp means "already mailed for this
turn", and recording a mail that never happened would silence the turn if they
switched reminders back on a minute later. Re-checking on the next tick costs one
indexed read.

Nullable with **no backfill** (migration `0006_game_turn_reminder_sent_at`):
null means "not reminded about the current turn", which is the truth for every
row that existed before the command did.

Nothing else reads it — it is not serialized, not rendered, and not part of any
gameplay rule. See
[railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron)
for the scheduling half and
[ADR-002](../decisions/adr-002-inactivity-forfeit.md) for why the reminder is a
cron command rather than a side effect of a request.

## Relationships

```
User ──< Game  (player1_user / player2_user)
User ──< Match (player1_user / player2_user)
User ──1 UserPreferences (one-to-one, optional, CASCADE)
Match ──< Game (match, related_name="games")
```

All the **seat** FKs are nullable with `on_delete=SET_NULL`, so deleting a user or
match leaves game rows intact (with null references) rather than cascading. For
users that anonymisation is paired with the `player*_deleted` flags above, which
is what keeps an orphaned seat from being mistaken for a guest seat.

`UserPreferences` is the exception and is meant to be: it is `CASCADE`, because a
settings row for a deleted account is not history anybody wants preserved — and
unlike a seat, nothing points at it.

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

The derivation that shapes everything else: `wins` counts rows where `winner`
matches the seat, and `losses` is `total_games − wins` rather than a count of its
own. Two win types interact with that.

**Abandonment is excluded from every stat.** An abandoned game has no winner at
all, so leaving it in would inflate `total_games` and drop the row into the
surviving player's `losses` — charging them with a defeat nobody inflicted, which
is precisely the result `abandon` refuses to invent. `_stats` therefore
`.exclude(win_type="abandoned")` on both seats' querysets; dropping it from
`total_games` too keeps `wins + losses == total_games`, which `win_percentage`
assumes.

**Timeouts are deliberately *not* excluded.** A timeout has a real `winner`, so
`total − wins` already scores it correctly on both sides — a win for the claimant,
a loss for the player who walked away — and no stats code was written to support
it. It never counts as a gammon/backgammon, since those filter on `win_type`.

## Planned / Not Yet Implemented

- **PostgreSQL actually in use.** The wiring is there (`dj-database-url` reading
  `DATABASE_URL`, `psycopg2-binary` pinned), but nothing sets `DATABASE_URL`, so
  every environment resolves to the dev SQLite file and the migrations have never
  been applied against Postgres. Verify them on an empty database before cutting
  over.
- **A persisted `Seat`/participant model.** Seat ownership is derived from the user
  FKs at request time (which is also how server-side turn enforcement works); there
  is no dedicated table, and guest seats therefore carry no identity at all.
- **Move history / persisted pending moves.** Only the current board is stored; there
  is no per-move audit trail.
- **Denormalized stats.** Stats are recomputed on every read; there is no stored
  win/loss tally.
