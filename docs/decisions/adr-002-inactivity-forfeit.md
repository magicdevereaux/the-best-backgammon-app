# ADR-002: Inactivity forfeit, and why clocks come later

**Status: accepted, not implemented.** Agreed 2026-08-02. Nothing described
under "The design" exists in the code yet — there is no `turn_started_at`, no
claim endpoint, no clock state. Read this before building any of it.

## Context

A player who walks away from an online game stalls it forever. There is no
timeout, no forfeit, and no clock. The opponent's only exit is to stop playing.

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

## The design

- **A per-turn deadline, evaluated on a pull-based claim.** There is no
  scheduler in this stack — no Celery, no cron — so a deadline can only be
  evaluated when someone hits the API. The opponent claims the win via a new
  action; nothing sweeps in the background. This is how chess.com daily works
  too, and for live games the opponent's ~3.5s poll effectively *is* the sweeper.
- **Registered seats only.** A claim requires both the claimant's seat and the
  idle seat to have real user FKs. Guest and hotseat games keep the existing
  non-scoring exit. A guest seat is unverifiable, so without this rule anyone
  holding a game id could claim — including a hotseat player farming their own
  second seat. Guest games have no stats to corrupt anyway.
- **A timeout win is a single game at the current cube value.** `win_points = 1`
  multiplied by `cube_value`, scored into the match normally. You cannot prove a
  gammon the opponent never let you play, so a single is the defensible floor.
- **New `win_type = "timeout"` with a real `winner` set.** Deliberately *not*
  added to the stats `exclude` list. `_stats` derives `losses = total - wins`, so
  a real winner makes a timeout score correctly on both sides with **zero**
  changes to the stats code.
- **The deadline is env-configurable**, so it can be tuned in production without
  a deploy.

### The blocking prerequisite

**Nothing currently records when the current turn began.** `Game.updated_at` is
`auto_now` and is bumped by every write for any reason, so it cannot distinguish
"idle for 20 hours" from "rolled 20 hours ago then walked away" from "someone
joined a minute ago." This needs an explicit `turn_started_at`, set everywhere
`current_turn` changes — `confirm_turn`, `respond_to_double` on a take, and
`next_game` — plus a decision about what value to backfill for games already in
flight.

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
clock *display*. Polling only reconciles. That is how real clock UIs work.

## Consequences

Build in two layers. The substrate — `turn_started_at`, the deadline, and the
claim endpoint — delivers correspondence play on its own and is the exact
foundation a clock sits on. Total clocks, increment, mode selection at game
creation, and clock UI in both clients are a second, larger push that should wait
until presence exists.

Both clients will need a claim control. It slots in naturally beside the existing
abandon panels (`AbandonGamePanel` on web, `AbandonGameSection` on mobile), and
the same care applies: the two clients' seat predicates must stay in sync.

See [ADR-001](adr-001-combined-moves.md) for the other standing decision.
