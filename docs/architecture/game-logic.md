# Game Logic & Rules Engine

The backgammon engine, how legal moves are generated, how a turn is staged and
committed, how combined moves work, and how maximal dice usage is enforced.

## Where the engine lives

The **authoritative** engine is [`backend/game/game_logic.py`](../../backend/game/game_logic.py)
— pure functions, no Django models. It is ported to JavaScript twice for client-side
move highlighting and staged-turn previews:

- [`frontend/src/utils/gameLogic.js`](../../frontend/src/utils/gameLogic.js) (web)
- [`mobile/src/game/logic.js`](../../mobile/src/game/logic.js) (mobile)

**All three must stay in sync.** The JS ports exist so a client can show legal moves
and a tentative board without a server round-trip; the backend re-validates every
committed move, so a divergent client can never corrupt game state — it just shows
wrong hints.

## Board representation

```python
{
  "points": [int, ...],          # length 24; index = point - 1
  "bar":    {"p1": int, "p2": int},
  "off":    {"p1": int, "p2": int},
}
```

- Positive point values are **p1** checkers, negative are **p2**.
- `from_point == 0` → enter from the bar. `to_point == 25` → bear off.
- **p1** moves toward increasing points (home board 19–24); **p2** toward decreasing
  (home board 1–6).
- Bear-off distance: p1 = `25 − from_point`, p2 = `from_point`.

## Move generation — `get_legal_moves`

Returns a set of `(from_point, to_point, die)` tuples for the given board, player,
and remaining dice. Rules encoded:

- **Bar priority.** If the player has any checker on the bar, *only* bar-entry moves
  are returned — you must enter before doing anything else.
- **Landing rule.** A destination point is open if it holds ≤ 1 opposing checker
  (`value * sign >= -1`). Landing on a lone opposing blot is legal (it will be hit).
- **Bearing off** is only offered when `can_bear_off` is true (all of the player's
  checkers are home and none on the bar). A die bears a checker off when it exactly
  matches the bear-off distance, **or** when the die is larger than the distance and
  that checker sits on the **furthest-back** occupied home point — i.e. its
  distance equals the largest bear-off distance on the board (the "overage" rule). The
  higher-die-must-be-used refinement is not a move-generation rule at all — it is
  applied at confirm time, anywhere on the board, see
  [the higher-die rule](#higher-die-rule--higher_die_required_moves).

`apply_move` mutates the board for one hop: it removes the source checker (or
decrements the bar), and either increments `off`, hits a blot (sending the opponent
to the bar), or stacks on the destination.

## The staging model

A turn is not sent move-by-move. Instead the client builds a list of **pending
moves** against a *local copy* of the board and commits them all at once.

- Each pending move is a single `{from_point, to_point}` that consumes **exactly one
  die**. So `len(pendingMoves)` equals the number of dice used — a fact several
  checks rely on.
- Web: [`frontend/src/hooks/useGame.js`](../../frontend/src/hooks/useGame.js);
  Mobile: [`mobile/src/game/useGame.js`](../../mobile/src/game/useGame.js).
- Committing calls `POST /api/games/{id}/confirm_turn/` with `{ moves: [...] }`. An
  empty list is a legal **pass** (used when the roll has no legal play).

The backend's [`confirm_turn`](../../backend/game/views.py) deep-copies the board,
replays each pending move through `_apply_single_move` (which re-derives legal moves
and rejects anything illegal), enforces maximal dice usage, then either passes the
turn or finishes the game. The whole request is atomic — one illegal move rejects the
entire turn and saves nothing.

> **`confirm_turn` is the only endpoint that moves a checker.** There is no
> move-at-a-time route: a turn reaches the server as one list or not at all, so
> the atomicity above is a property of the API, not just of the clients.

## Combined (multi-die) moves — a client-side DFS

The UI lets a player move one checker several dice in a single gesture (e.g. play a
5 and a 3 as one 8-point slide through a legal intermediate). This is a **purely
client-side convenience**: `getCombinedMoves` runs a depth-first search from each of
the player's checkers, stepping through legal single hops and consuming a die at each
step, recording each reachable `[from, to, path]` where `path` is the ordered list
of `{ to, die }` sub-moves. Destinations are deduped per `from → to`, so a
destination reachable both a-then-b and b-then-a is offered once, via whichever
path the search found first.

When the player picks a combined move, the client **expands `path` into individual
pending moves** — so what reaches the backend is an ordinary sequence of single hops
it already knows how to validate. The backend has **no concept of a combined move**.

Scope: combined moves cover regular point-to-point chains only; bar entry and bearing
off stay single-die actions. For a non-double roll `[a,b]` the DFS yields the
`+(a+b)` destination through legal intermediates; for doubles it yields `+2x/+3x/+4x`
as far as dice and open points allow.

The rationale for doing this in the client rather than adding a combined-move concept
to the backend is recorded in
[ADR-001](../decisions/adr-001-combined-moves.md).

## Maximal dice usage — `max_moves_usable`

Backgammon requires a player to use **as many dice as legally possible**. Enforcing
this needs a search, because move *order* matters: one order can strand a die that a
different order would have used.

`max_moves_usable(board, player, dice)` computes the maximum number of dice
consumable from a position by recursion:

```
if no dice or no legal moves: return 0
best = 0
for each legal single move:
    play it, remove that die
    best = max(best, 1 + max_moves_usable(new_board, player, remaining_dice))
    stop early if best == len(dice)   # can't beat using every die
return best
```

Because it recurses over single moves in every order, it inherently accounts for both
combined sequences and order-dependent stranding.

### Why it lives on the server

`confirm_turn` compares the dice the player actually consumed
(`len(original_dice) − len(remaining)`) against `max_moves_usable` of the **pre-turn**
board and original roll. If the player used fewer dice than were playable, the turn
is rejected with a clear error. **This is the authoritative rule** — a client can't
bypass it by crafting a request.

The same function is **ported to both clients**
(`maxMovesUsable` in the JS logic files) purely to drive a UX affordance: the Confirm
button is disabled, with a hint, while more dice could still be played. The clients
compute it from the pre-turn board (not the current staged position) so they catch
the "wrong move order stranded a die" case exactly as the server does — but the
client check is convenience only; the server decides.

## Higher-die rule — `higher_die_required_moves`

With a non-double roll, when exactly one die can legally be played
(`max_moves_usable == 1`) but *either* die individually has a legal move, the player
must play the **higher** die. The rule is **general** — it applies anywhere on the
board: entering from the bar, an ordinary blocked mid-board position, and bear-off
alike.

`higher_die_required_moves(board, player, dice)` returns the permitted move set when
the rule applies (else `None`). It short-circuits on doubles, on rolls that aren't
exactly two dice, when `max_moves_usable != 1`, and when only one of the two dice has
any legal move at all (there is then no choice to restrict). Otherwise it prefers, in
order:

1. the higher die's **exact bear-off** (`die == distance`), if one exists;
2. otherwise its **oversized bear-off** (which `get_legal_moves` only ever emits from
   the furthest-back checker);
3. otherwise **any** legal higher-die move — the rule pins the *die*, not the
   destination.

Clauses 1–2 can only fire while bearing off, since `get_legal_moves` emits
`to_point == 25` only then.

`confirm_turn` rejects a turn whose single move isn't in that set:

> `"When only one die can be played, you must play the higher die (N)."`

The check runs *after* the maximal-usage check, which guarantees exactly one staged
move whenever the rule is active (`max_usable == 1`) — so it only ever inspects
`moves[0]`. Cost is bounded by the `len(dice_values) == 2` guard: `max_moves_usable`
never recurses more than two plies here.

Two properties of the move generator, verified by exhaustive search over small
bear-off positions, shape the bear-off branch:

- During an open bear-off race the rule never bites — both dice are sequentially
  playable and maximal usage already governs. It takes **opponent anchors** blocking
  within-board moves to reach `max_usable == 1`.
- When the higher die's required move is an *oversized* bear-off, the lower die
  necessarily targets the same `(from, to)` (the last checker) — so that branch pins
  which **die** is consumed rather than changing the board outcome.

**Ported to both clients** as `higherDieRequiredMoves` in the two JS logic files
(returning an array of `[from, to, die]` triples, or `null`). Each `useGame` computes
it from the **pre-turn** board and original roll — exactly the inputs the server
uses — exposes `mustPlayHigherDie` when the first staged move isn't in the permitted
set, and blocks Confirm with a hint ("Only one die can be played this turn — it must
be the higher one."). As with maximal usage, the client copy is an affordance; the
server decides.

Related detail: a bear-off `(from, 25)` can match both dice (exact + oversized), so
`_apply_single_move` consumes the **smallest matching die** deterministically.

## Win detection & scoring

- `check_winner` — a player who has borne off all 15 checkers wins.
- `detect_win_type` — `normal` (1 pt), `gammon` (loser bore off none; 2 pts), or
  `backgammon` (loser bore off none **and** still has a checker on the bar or in the
  winner's home board; 3 pts).
- Board-win points are **multiplied by the doubling-cube value** (below).

A game can also end **off** the board, and `game_logic.py` knows nothing about
these — they are endpoint-driven in [`views.py`](../../backend/game/views.py).
Every path converges on `_apply_game_result`:

| Path | `win_type` | Winner | Points |
|------|-----------|--------|--------|
| bear off all 15 | `normal` / `gammon` / `backgammon` | the player who bore off | `win_points(win_type) × cube_value` |
| decline a double | `drop` | the offerer | the **pre-double** `cube_value` |
| opponent runs out the clock ([`claim_timeout`](api.md#post-apigamesidclaim_timeout)) | `timeout` | the claimant | `1 × cube_value` |
| deadlocked by a closed seat ([`abandon`](api.md#post-apigamesidabandon)) | `abandoned` | **none** | `0`, and the match score is untouched |

**`timeout` and `abandoned` are opposites, deliberately.** A timeout is a real
win over a player who exists and stopped playing, so it scores and counts in
stats; an abandonment closes out a game nobody can play because a seat ceased to
exist, so it invents nothing and is excluded from stats entirely. `claim_timeout`
refuses a closed seat for exactly that reason. See
[ADR-002](../decisions/adr-002-inactivity-forfeit.md).

A timeout is capped at a **single** point before the cube multiplier: you cannot
prove a gammon the opponent never let you play.

- In match mode, points accumulate on the `Match` until a player reaches
  `target_points`; the game winner goes first in the next game.

## Doubling cube

Cube state lives on `Game` (see [data-model.md](data-model.md)): `cube_value`
(1 → 64), `cube_owner` (**seat** `"p1"`/`"p2"`/null — null = centered; not a user
FK, since guests have no server identity), `double_offered_by` (seat of a pending,
unanswered offer), and `crawford_game`. The flow is endpoint-driven in
[`views.py`](../../backend/game/views.py), not in `game_logic.py`:

- **`offer_double`** — legal on your turn *before rolling*, when the cube is
  centered or yours, outside the Crawford game, below 64, and with no offer already
  pending. Seat-enforced against `current_turn` like the gameplay actions (403).
  Sets `double_offered_by`; while set, `roll_dice` / `confirm_turn` and a second
  `offer_double` are all blocked (400) until the opponent answers. Because the
  game is now waiting on the *responder*, this also restarts the inactivity clock
  (`turn_started_at`) — see [api.md](api.md#the-turn-clock-fields).
- **`respond_to_double`** (`{"accept": bool}`) — answered by the *offerer's
  opponent* (seat-enforced with the same 403 pattern as gameplay actions; the
  responder is not the current-turn player, so the permission check takes an
  explicit seat). **Accept:** cube doubles, ownership transfers to the acceptor,
  play continues with the offerer still to roll. **Drop:** the responder concedes —
  the game finishes with `win_type="drop"` and the offerer scores the
  **pre-double** cube value.
- **Scoring:** board wins award `win_points(win_type) × cube_value` (gammon at
  cube 4 = 8, backgammon at cube 4 = 12). This multiplied value is what lands in
  `points_value`, the match score, and (by aggregation) user stats. Every ending
  goes through `_apply_game_result`, which also clears `dice_values` and any
  pending offer. A **timeout** is scored the same way at `1 × cube_value`, so a
  player who walks away from a doubled game loses the doubled stake.
- **Crawford rule:** `next_game` marks the first game after either player reaches
  `target_points − 1` as `crawford_game=True` (cube disabled for that one game);
  `match.games.filter(crawford_game=True).exists()` prevents a second one, so
  doubling resumes in later games.

Clients mirror only the *visibility* logic (`canOfferDouble` in each `useGame`) and
render the cube + accept/drop prompt; the server enforces every rule.

## Planned / Not Yet Implemented

- A shared engine artifact instead of three hand-synced copies (e.g. generating the
  JS ports from the Python source, or a shared spec) — today they are maintained in
  parallel by hand.
