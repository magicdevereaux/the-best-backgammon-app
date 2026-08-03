# ADR-002: Inactivity forfeit, and why clocks come later

**Status: accepted and implemented.** Agreed and built 2026-08-02. Everything
under [The design](#the-design) exists in the code: `Game.turn_started_at`,
`TURN_TIMEOUT_HOURS`, the `turn_waiting_seat` / `turn_deadline` serializer
fields, `POST /api/games/{id}/claim_timeout/`, and a claim control plus a
countdown on both clients. The endpoint reference is
[api.md](../architecture/api.md#post-apigamesidclaim_timeout).

**[Why live clocks are deferred](#why-live-clocks-are-deferred) is still a
statement about the future** — reserve time, increment, mode selection and clock
UI do **not** exist, and the presence layer they depend on does not either.

## Context

A player who walks away from an online game stalled it forever. There was no
timeout, no forfeit, and no clock; the opponent's only exit was to stop playing.
That is what this ADR set out to fix.

## The trap: `abandon` is not the thing to extend

`POST /api/games/{id}/abandon/` looks like the natural home for this. **It is
not.** That action exists solely for the *closed-seat deadlock*: a player deleted
their account, so seat enforcement 403s that seat for everyone and the game
genuinely cannot proceed. It ends the game `win_type="abandoned"` with **no
winner and no score change**, and such games are excluded from user stats.

That is the correct outcome for that case and it should stay non-scoring —
nobody walked away, the seat ceased to exist. Awarding a win there would invent
points nobody won and corrupt match scores. **Inactivity forfeit is a separate,
additive feature.** Do not conflate them, and do not "fix" `abandon` to score.

The shipped code holds that line mechanically: `claim_timeout` **400s on a closed
seat** and sends the caller to `abandon`, so a deadlock can never be laundered
into a scoring win, and `abandon` still writes `winner=null`, `points_value=0`
and no match score.

## The design

All of this is built. Endpoint reference:
[api.md](../architecture/api.md#post-apigamesidclaim_timeout).

- **A per-turn deadline, evaluated on a pull-based claim.** There is no
  scheduler in this stack — no Celery, no cron — so a deadline can only be
  evaluated when someone hits the API. The opponent claims the win via
  `POST /api/games/{id}/claim_timeout/`; nothing sweeps in the background. This
  is how chess.com daily works too, and for live games the opponent's ~3.5s poll
  effectively *is* the sweeper.
- **Registered seats only.** A claim requires both the claimant's seat and the
  idle seat to have real user FKs. Guest and hotseat games keep the existing
  non-scoring exit. A guest seat is unverifiable, so without this rule anyone
  holding a game id could claim — including a hotseat player farming their own
  second seat. Guest games have no stats to corrupt anyway.
- **A timeout win is a single game at the current cube value.** `win_points = 1`
  multiplied by `cube_value`, scored into the match through `_apply_game_result`
  like any other win. You cannot prove a gammon the opponent never let you play,
  so a single is the defensible floor; multiplying by the live cube keeps the
  stake the two players had actually agreed to.
- **New `win_type = "timeout"` with a real `winner` set.** Deliberately *not*
  added to the stats `exclude` list — which now holds `"abandoned"` alone.
  `_stats` derives `losses = total - wins`, so a real winner makes a timeout
  score correctly on both sides with **zero** changes to the stats code, and that
  is exactly what happened.
- **The deadline is env-configurable** — `TURN_TIMEOUT_HOURS`, **default 48** —
  so it can be retuned on a running deployment without a code change. Defaulted,
  because local dev must keep needing no `.env` file.

### The prerequisite, as built

**Nothing recorded when the current turn began.** `Game.updated_at` is `auto_now`
and is bumped by every write for any reason, so it could not distinguish "idle
for 20 hours" from "rolled 20 hours ago then walked away" from "someone joined a
minute ago."

`Game.turn_started_at` (nullable `DateTimeField`) is that missing state. It is
written by a single `_begin_turn()` helper, called wherever the **waiting seat
changes** — and only there:

| Action | Why the waiting seat changed |
|---|---|
| create a game/match that starts `active` | both names given at creation (hotseat/guest); p1 is owed a move immediately |
| `join` (game or match) | a `waiting` game becomes `active`; p1 is now on the clock. Not at creation — a lobby advert may have sat unjoined for days |
| `confirm_turn` | the turn passes to the opponent |
| `offer_double` | play blocks until the **responder** answers |
| `respond_to_double` — *take* | the wait flips back to the offerer, who must roll |
| `next_game` | a fresh game, a fresh clock |

**`roll_dice` deliberately does not reset it.** The same seat is still on the
clock, and one deadline covers roll-and-move together; resetting there would let
a player roll and then stall forever on a fresh deadline — reintroducing the
exact problem this ADR exists to solve. `respond_to_double` on a **drop** does
not reset it either: the game is over.

The waiting seat itself is `current_turn` **except** while a double is pending,
where it is the responder — the derivation `abandon`, `gating.js` and `seats.js`
already shared. It now lives on the model as `Game.waiting_seat` so the server
has one copy of it rather than two.

### The backfill decision: `updated_at`, for `active` games only

The open question when this ADR was written was what to write for games already
in flight. **The answer taken:** migration
[`0005_game_turn_started_at.py`](../../backend/game/migrations/0005_game_turn_started_at.py)
adds the nullable column and then runs a `RunPython` step setting
`turn_started_at = updated_at` on every `status="active"` row — via
`.update()` rather than `.save()`, so recording it does not itself rewrite the
`auto_now` field it is reading. `waiting` rows are skipped (nobody is on the
clock yet; `join` starts it) and `finished` rows are skipped (they are done).
Reversing is a `noop` — dropping the column loses nothing.

**`updated_at` is an approximation, and the direction of its error is the
justification.** It marks the last write of any kind, not the moment the current
seat came on the clock. For a row whose last write *was* the turn flip it is
exact; where the waiting player has since rolled, or a join or cube action
touched the row, it reads *later* than the truth, so the deadline lands
**generous**. That is the right side to be wrong on: an early deadline would hand
someone a win they had not yet earned, while a late one costs nothing but
patience. Backfilling from `now()` was rejected as a plainly fabricated fact that
would also reset itself on any migration replay.

Nothing is materially at stake either way — no deployment exists, so the only
rows this can touch are local dev games.

**Null remains a first-class "no clock running" state** and the migration does
not try to eliminate it: `turn_deadline` serialises as `null`, both clients
render no countdown and no claim button, and `claim_timeout` 400s. Any row that
ends up null heals on its own at the next waiting-seat change.

## Why live clocks are deferred

The original request was chess.com-style live play (a ~30 minute clock, 20–30s
per-move forfeit) alongside correspondence. Deferred for three reasons:

1. **Sudden death is the wrong clock for backgammon.** Tournament play uses a
   **delay/Bronstein or Fischer-increment** clock, because a large share of
   backgammon turns involve no decision at all — forced moves, single-legal-play
   rolls, and the roll itself. A sudden-death clock bleeds time for non-decisions
   and rewards fast clicking over good checker play. The right shape is reserve
   time plus a per-turn delay, e.g. 10 minutes + 12 seconds.
2. **A per-turn deadline needs one timestamp; a total clock needs much more** —
   accumulated per-player time in new fields, updated server-side on every
   action, plus a live countdown rendered in both clients. Very different sizes
   of change.
3. **Live mode's hidden prerequisite is presence.** There are no WebSockets and
   no push notifications; both clients simply poll ~3.5s. There is no way to tell
   a player that a game has started or that a clock is running, so live mode
   would forfeit people who never knew it had begun. Presence and a ready-check
   have to come first.

One non-blocker worth recording, because it looks like one: a countdown can be
**extrapolated client-side** from a server timestamp, so 3.5s polling is fine for
clock *display*. Polling only reconciles. That is how real clock UIs work — and
it is how the shipped countdown works: both clients tick locally against
`turn_deadline`, and a poll response merely corrects the anchor.

## Consequences

The plan was two layers, and **layer one is done**. The substrate —
`turn_started_at`, the deadline, and the claim endpoint — delivers correspondence
play on its own and is the exact foundation a clock sits on. Total clocks,
increment, mode selection at game creation, and reserve-time UI in both clients
remain a second, larger push that should wait until presence exists.

Both clients grew a claim control, beside the existing abandon panels
(`AbandonGamePanel` on web, `AbandonGameSection` on mobile). The care that
applies to those applies here: **`canClaimTimeout` is now a third member of the
`seats.js` / `gating.js` stay-in-sync obligation**, alongside the closed-seat
predicates — see
[clients.md](../architecture/clients.md#closed-seats-and-the-inactivity-clock-the-predicates-both-clients-share).

See [ADR-001](adr-001-combined-moves.md) for the other standing decision.
