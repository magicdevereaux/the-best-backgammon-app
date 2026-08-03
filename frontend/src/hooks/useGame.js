import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  fetchGame,
  rollDice as apiRollDice,
  confirmTurn as apiConfirmTurn,
  offerDouble as apiOfferDouble,
  respondToDouble as apiRespondToDouble,
  abandonGame as apiAbandonGame,
  claimTimeout as apiClaimTimeout,
} from "../api/gameApi";
import {
  getLegalMoves,
  getCombinedMoves,
  applyMove,
  maxMovesUsable,
  higherDieRequiredMoves,
} from "../utils/gameLogic";
import { canAbandon, isDeadlocked, isOnlineGame, serverClockOffset } from "../utils/seats";
import { isTimeoutClaimedError } from "../api/errors";

// How often to re-fetch the game to pick up the opponent's moves. Matches the
// mobile client's cadence (mobile/src/game/useGame.js).
const POLL_MS = 3500;

// Smallest change in the server/device clock offset worth re-rendering for.
// Every poll re-derives the offset and network latency jitters it by tens of
// milliseconds; adopting each of those would re-render the tree every 3.5s and
// undo the "identical payload changes nothing" guarantee below. One second is
// also the countdown's own resolution, so a smaller correction is invisible
// anyway. Mirrored in mobile/src/game/useGame.js.
const OFFSET_EPSILON_MS = 1000;

function cloneBoard(boardState) {
  return {
    points: [...boardState.points],
    bar: { ...boardState.bar },
    off: { ...boardState.off },
  };
}

/**
 * Hook that manages the state for a single game, including a "staged turn":
 * tentative moves the player is trying out before committing them. Staged
 * moves update a local copy of the board and dice but are not sent to the
 * backend until `confirmTurn` is called.
 *
 * `viewerUserId` (the logged-in user's id, or undefined for a guest) is only
 * used to tell an online game from a single-device hotseat one, which decides
 * whether polling makes any sense — see utils/seats.isOnlineGame.
 */
export function useGame(gameId, viewerUserId) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Transient feedback from the last roll/move action (e.g. "Illegal move."),
  // kept separate from `error` so it doesn't replace the whole page.
  const [actionError, setActionError] = useState(null);

  const [stagedBoard, setStagedBoard] = useState(null);
  const [stagedDice, setStagedDice] = useState([]);
  const [pendingMoves, setPendingMoves] = useState([]);

  const [reloadToken, setReloadToken] = useState(0);

  // How far this browser's clock is behind the server's, from the `server_now`
  // on the last payload we saw. Every countdown and every claim check is made
  // against `Date.now() + clockOffset`, never the raw device clock — see
  // utils/seats.serverClockOffset. Zero until the first payload lands, and zero
  // again for any payload without a usable `server_now`.
  const [clockOffset, setClockOffset] = useState(0);

  // The opponent's inactivity claim beat this player's move to the server.
  // Sticky for the life of this game view: the game is over, and the calm
  // explanation replaces the raw 400 (see api/errors.js).
  const [timeoutClaimed, setTimeoutClaimed] = useState(false);

  // Re-anchor the clock from a payload that has just arrived, then adopt it.
  // Split out because every path that produces a game — the initial load, a
  // poll tick, and each action's response — has to re-anchor, not just the load.
  const syncClock = useCallback((payload) => {
    setClockOffset((cur) => {
      const next = serverClockOffset(payload);
      return Math.abs(next - cur) >= OFFSET_EPSILON_MS ? next : cur;
    });
  }, []);

  const adoptGame = useCallback(
    (payload) => {
      syncClock(payload);
      setGame(payload);
    },
    [syncClock]
  );

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setTimeoutClaimed(false);
    fetchGame(gameId)
      .then(adoptGame)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId, reloadToken, adoptGame]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // Shared failure path for the *gameplay* actions — roll, confirm, and the two
  // cube actions. Any of them can lose a race to the opponent's inactivity
  // claim, in which case the server's 400 is not the player's fault and is
  // about to be contradicted by a finished game; swap it for the explanation
  // and pull the finished state immediately, so the screen never shows a live
  // board under a message saying the game is over.
  //
  // `claimTimeout` deliberately does NOT route through here: its own refusals
  // talk about claims and clocks too, and mean something quite different.
  const handleActionError = useCallback(
    (err) => {
      if (isTimeoutClaimedError(err)) {
        setTimeoutClaimed(true);
        setActionError(null);
        fetchGame(gameId).then(adoptGame).catch(() => {});
        return;
      }
      setActionError(err.message);
    },
    [gameId, adoptGame]
  );

  // The turn sits on a seat closed by account deletion: nothing on the server
  // can change it, so the banner says so and the poll below stops.
  const deadlocked = isDeadlocked(game);

  // Keep refs of the bits the poller reads so the interval can stay stable (one
  // subscription for the life of the game) without disrupting a staged turn.
  const pendingRef = useRef(0);
  const statusRef = useRef(null);
  const pollableRef = useRef(false);
  pendingRef.current = pendingMoves.length;
  statusRef.current = game?.status;
  pollableRef.current = isOnlineGame(game, viewerUserId) && !deadlocked;

  // Poll for the opponent's moves and doubles. Skips a tick whenever the local
  // player has staged moves (a refresh must never clobber their turn), when the
  // game is finished, when it's deadlocked on a closed seat (nobody is coming —
  // see seats.isDeadlocked), and entirely for hotseat games, where this device
  // is the only thing that can change the board. Only state that actually
  // changed is swapped in (by updated_at), so a stream of identical responses
  // causes no re-render and no flicker.
  //
  // Note none of those guards fires on the case inactivity forfeit cares about —
  // an active online game where the *opponent* is idle. That keeps polling, so a
  // move by the idle player retracts the claim control within a tick. The
  // countdown itself does not depend on this: TurnClock extrapolates locally
  // from `turn_deadline`, and polling only reconciles it — plus the `server_now`
  // anchor that keeps this browser's clock honest.
  useEffect(() => {
    if (!gameId) return;
    const interval = setInterval(() => {
      if (!pollableRef.current) return;
      if (statusRef.current === "finished" || pendingRef.current > 0) return;
      fetchGame(gameId)
        .then((fresh) => {
          // Re-anchor the clock even when the payload is otherwise identical:
          // `server_now` is fresh on every response, and it is the only thing
          // keeping the countdown honest on a device whose clock drifts.
          syncClock(fresh);
          setGame((cur) => (cur && fresh.updated_at === cur.updated_at ? cur : fresh));
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [gameId, syncClock]);

  // Whenever the authoritative game state changes (initial load, a dice
  // roll, or a confirmed turn), start a fresh staged turn from it.
  useEffect(() => {
    if (!game) return;
    setStagedBoard(cloneBoard(game.board_state));
    setStagedDice([...game.dice_values]);
    setPendingMoves([]);
  }, [game]);

  const rollDice = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiRollDice(gameId);
      adoptGame(updated);
    } catch (err) {
      handleActionError(err);
    }
  }, [gameId, adoptGame, handleActionError]);

  // Single-die moves plus combined (multi-die) moves through legal
  // intermediates. Combined entries carry an array `path` as their third
  // element; single moves carry a numeric die.
  const legalMoves = useMemo(() => {
    if (!game || !stagedBoard) return [];
    const player = game.current_turn;
    return [
      ...getLegalMoves(stagedBoard, player, stagedDice),
      ...getCombinedMoves(stagedBoard, player, stagedDice),
    ];
  }, [game, stagedBoard, stagedDice]);

  // Maximum dice that can be legally consumed this turn, computed once from the
  // pre-turn (authoritative) board and the original roll — independent of how
  // the player has staged moves. Mirrors the server's must-use-maximum-dice
  // rule; unlike a staged-position check it catches move orders that strand a
  // die (where the staged board shows no moves left but another order used both).
  const maxDiceUsable = useMemo(() => {
    if (!game) return 0;
    return maxMovesUsable(game.board_state, game.current_turn, game.dice_values);
  }, [game]);

  // Each pending move consumes exactly one die, so the staged-move count is the
  // number of dice used so far. More dice must be played while it falls short.
  const mustUseMoreDice = pendingMoves.length < maxDiceUsable;

  // Higher-die rule: when only one die can be played this turn but either die
  // individually has a legal move, it must be the higher one. Like maxDiceUsable
  // this is computed from the pre-turn board and the original roll; null means
  // the rule doesn't apply. Mirrors the server's confirm_turn check exactly.
  const higherDieMoves = useMemo(() => {
    if (!game) return null;
    return higherDieRequiredMoves(game.board_state, game.current_turn, game.dice_values);
  }, [game]);

  // The staged turn plays the wrong die. (When the rule applies only one die is
  // usable, so the server likewise judges the first staged move.)
  const mustPlayHigherDie = Boolean(
    higherDieMoves &&
      pendingMoves.length > 0 &&
      !higherDieMoves.some(
        (m) => m[0] === pendingMoves[0].from_point && m[1] === pendingMoves[0].to_point
      )
  );

  const stageMove = useCallback(
    (fromPoint, toPoint) => {
      if (!game || !stagedBoard) return;
      const match = legalMoves.find(
        (m) => m[0] === fromPoint && m[1] === toPoint
      );
      if (!match) return;

      const player = game.current_turn;

      // Combined move: play each sub-move in order, consuming each die. The
      // backend re-validates these as ordinary sequential single moves.
      if (Array.isArray(match[2])) {
        let board = stagedBoard;
        const newDice = [...stagedDice];
        const newMoves = [];
        let cur = fromPoint;
        for (const step of match[2]) {
          board = applyMove(board, player, cur, step.to);
          newDice.splice(newDice.indexOf(step.die), 1);
          newMoves.push({ from_point: cur, to_point: step.to });
          cur = step.to;
        }
        setStagedBoard(board);
        setStagedDice(newDice);
        setPendingMoves((prev) => [...prev, ...newMoves]);
        return;
      }

      // Single-die move.
      const die = match[2];
      const newDice = [...stagedDice];
      newDice.splice(newDice.indexOf(die), 1);

      setStagedBoard(applyMove(stagedBoard, player, fromPoint, toPoint));
      setStagedDice(newDice);
      setPendingMoves((prev) => [...prev, { from_point: fromPoint, to_point: toPoint }]);
    },
    [game, stagedBoard, stagedDice, legalMoves]
  );

  const resetTurn = useCallback(() => {
    if (!game) return;
    setStagedBoard(cloneBoard(game.board_state));
    setStagedDice([...game.dice_values]);
    setPendingMoves([]);
  }, [game]);

  const confirmTurn = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiConfirmTurn(gameId, pendingMoves);
      adoptGame(updated);
    } catch (err) {
      handleActionError(err);
    }
  }, [gameId, pendingMoves, adoptGame, handleActionError]);

  const offerDouble = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiOfferDouble(gameId);
      adoptGame(updated);
    } catch (err) {
      handleActionError(err);
    }
  }, [gameId, adoptGame, handleActionError]);

  const respondToDouble = useCallback(
    async (accept) => {
      try {
        setActionError(null);
        const updated = await apiRespondToDouble(gameId, accept);
        adoptGame(updated);
      } catch (err) {
        handleActionError(err);
      }
    },
    [gameId, adoptGame, handleActionError]
  );

  // Close out a game that can never move again. The 400 ("not abandoned") and
  // 403 (not the survivor) both arrive as ordinary `{ error }` bodies, so they
  // land in `actionError` alongside every other rejected action.
  const abandonGame = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiAbandonGame(gameId);
      adoptGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId, adoptGame]);

  // Claim the win against an opponent who let the turn clock run out. Scores
  // normally, unlike abandonGame. The 400s (too early, wrong game state, guest
  // seat) and the 403 (not your seat) all land in `actionError` like every other
  // rejected action, and the game is left untouched so the control can retry.
  // "Too early" should now be rare rather than chronic — the control is gated on
  // the server-corrected clock (`clockOffset`), not this browser's — but the
  // server still owns the deadline, so the message must never be swallowed.
  //
  // Deliberately no `canClaimTimeout` here to match `canAbandon`: the answer
  // depends on the wall clock, so it would be stale the moment it was computed.
  // components/TurnClock.jsx owns the 1s tick and calls the predicate itself.
  const claimTimeout = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiClaimTimeout(gameId);
      adoptGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId, adoptGame]);

  // Doubling is legal on your turn before rolling, with the cube centered or
  // yours, outside the Crawford game and below the 64 cap. The server
  // enforces all of this — this mirrors it for button visibility.
  const canOfferDouble = Boolean(
    game &&
      game.status === "active" &&
      (!game.dice_values || game.dice_values.length === 0) &&
      !game.double_offered_by &&
      !game.crawford_game &&
      (game.cube_value ?? 1) < 64 &&
      (game.cube_owner == null || game.cube_owner === game.current_turn)
  );

  return {
    game,
    loading,
    error,
    actionError,
    rollDice,
    stagedBoard,
    stagedDice,
    pendingMoves,
    legalMoves,
    mustUseMoreDice,
    mustPlayHigherDie,
    stageMove,
    resetTurn,
    confirmTurn,
    offerDouble,
    respondToDouble,
    canOfferDouble,
    deadlocked,
    abandonGame,
    canAbandon: canAbandon(game),
    claimTimeout,
    clockOffset,
    timeoutClaimed,
    reload,
  };
}
