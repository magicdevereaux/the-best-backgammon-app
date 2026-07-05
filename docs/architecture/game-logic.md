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
  that checker is on the highest occupied home point (the "overage" rule). The
  higher-die-must-be-used refinement is **not** enforced — see [Known gaps](#known-gaps).

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

> There is also a `move_checker` endpoint that applies a single move immediately.
> **No client uses it** — both drive the staging/`confirm_turn` path. Treat it as
> legacy.

## Combined (multi-die) moves — a client-side DFS

The UI lets a player move one checker several dice in a single gesture (e.g. play a
5 and a 3 as one 8-point slide through a legal intermediate). This is a **purely
client-side convenience**: `getCombinedMoves` runs a depth-first search from each of
the player's checkers, stepping through legal single hops and consuming a die at each
step, recording every reachable `[from, to, path]` where `path` is the ordered list
of `{ to, die }` sub-moves.

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

## Win detection & scoring

- `check_winner` — a player who has borne off all 15 checkers wins.
- `detect_win_type` — `normal` (1 pt), `gammon` (loser bore off none; 2 pts), or
  `backgammon` (loser bore off none **and** still has a checker on the bar or in the
  winner's home board; 3 pts).
- In match mode, points accumulate on the `Match` until a player reaches
  `target_points`; the game winner goes first in the next game.

## Known gaps

- **Higher-die rule.** When only one die can be played and either die is individually
  playable, the rules require playing the **higher** one. We enforce the *count* of
  dice used (via `max_moves_usable`) but not *which* die — a player may legally play
  the lower single die today. Closing this needs a "which specific die" check
  alongside the count check.

## Planned / Not Yet Implemented

- Server-enforced **higher-die** selection (see above).
- A shared engine artifact instead of three hand-synced copies (e.g. generating the
  JS ports from the Python source, or a shared spec) — today they are maintained in
  parallel by hand.
