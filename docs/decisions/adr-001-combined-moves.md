# ADR-001: Combined moves as client-side DFS chains

- **Status:** Accepted — reflects the current implementation.
- **Date:** 2026-07 (documenting an existing decision).
- **Related:** [game-logic.md](../architecture/game-logic.md).

## Context

Players expect to move one checker several dice in a single gesture — e.g. play a 5
and a 3 as one slide of 8 pips through a legal intermediate point, rather than
tapping the two hops separately. We wanted this "combined move" affordance in both
clients.

The backend already had a clean, well-tested turn model:

- Legal moves are generated as **single** `(from, to, die)` hops.
- A committed turn is a list of single moves, replayed one at a time by
  `confirm_turn` / `_apply_single_move`, each re-validated against the board.
- Each move consumes exactly one die, and the whole turn is atomic.

The question was **where** the notion of a multi-die move should live: teach the
backend about combined moves, or synthesize them in the client on top of the existing
single-move primitives.

## Decision

Implement combined moves **entirely in the clients** as a depth-first search over
legal single hops, and **expand them into ordinary single moves before sending**.

`getCombinedMoves` (in each client's game-logic port) walks, from each of the
player's checkers, every chain of legal single steps that consumes the available
dice, and records each reachable destination together with its `path` — the ordered
list of `{ to, die }` sub-moves. When the player selects a combined move, the client
stages each sub-move as a normal pending move.

The backend is **not modified**: it still only ever sees a list of single hops, which
it validates exactly as before. It has no `combined move` concept.

## Rationale

- **Preserves the authoritative validation path unchanged.** The security- and
  correctness-critical code (`confirm_turn`, `_apply_single_move`,
  `get_legal_moves`) keeps operating on single moves. A combined move is, by
  construction, just a sequence the backend already knows how to check — there is no
  new server code path to get wrong.
- **Combined moves are a UI convenience, not a rule.** Whether the player takes two
  hops as one gesture or two is invisible to the rules of backgammon. Modelling it as
  presentation (client) rather than domain (server) matches where the concern
  actually lives.
- **One consistent invariant.** "Each pending move consumes exactly one die, and
  `len(pendingMoves)` == dice used" holds for combined and single moves alike, which
  keeps the staging hook and the maximal-dice check simple on both ends.
- **No schema or API change.** The `confirm_turn` contract (`{ moves: [...] }`) is
  untouched, so the two clients and the backend stay decoupled.

## Consequences

**Positive**

- The backend stayed small and its test suite kept meaning.
- Combined-move logic is testable in the JS suites without a server.
- `max_moves_usable` (maximal-dice enforcement) needed no special-casing for combined
  moves — recursing over single moves already covers them.

**Negative / trade-offs**

- **The DFS is duplicated** across the two JS ports and must be kept in sync with each
  other and with the backend's single-move rules. This is the same three-way-sync
  burden the whole engine already carries (see game-logic.md), but combined moves add
  surface area to it.
- **The backend can't distinguish** a combined move from the player having made the
  same hops individually — fine today, but if we ever want move-grouping in history or
  animations server-side, the information isn't transmitted.
- **Scope is limited by design:** bar entry and bearing off are excluded from
  combined moves; they remain single-die actions. Extending combined moves to those
  would mean more client DFS cases.

## Alternatives considered

1. **Add a combined-move endpoint / representation to the backend.** Rejected: it
   duplicates rule logic already expressed as single moves, adds a second validation
   path to keep correct, and changes the API for a purely presentational feature.
2. **Expand combined moves inside `confirm_turn`** (accept a combined move and split
   it server-side). Rejected for the same reason — it puts UI-shaped logic in the
   authoritative validator without benefit, since the client can expand just as
   easily before sending.

## Planned / Not Yet Implemented

- No current plan to move combined-move handling server-side. If move history,
  server-driven animation, or move-grouping is added later, revisit whether the
  grouping information should be transmitted rather than discarded at expansion time.
