import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  fetchGame,
  rollDice as apiRollDice,
  confirmTurn as apiConfirmTurn,
  offerDouble as apiOfferDouble,
  respondToDouble as apiRespondToDouble,
  abandonGame as apiAbandonGame,
} from "../api/gameApi";
import { getLegalMoves, getCombinedMoves, applyMove, maxMovesUsable } from "../utils/gameLogic";
import { canAbandon, isDeadlocked, isOnlineGame } from "../utils/seats";

// How often to re-fetch the game to pick up the opponent's moves. Matches the
// mobile client's cadence (mobile/src/game/useGame.js).
const POLL_MS = 3500;

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

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    fetchGame(gameId)
      .then(setGame)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

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
  useEffect(() => {
    if (!gameId) return;
    const interval = setInterval(() => {
      if (!pollableRef.current) return;
      if (statusRef.current === "finished" || pendingRef.current > 0) return;
      fetchGame(gameId)
        .then((fresh) => {
          setGame((cur) => (cur && fresh.updated_at === cur.updated_at ? cur : fresh));
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [gameId]);

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
      setGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId]);

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
      setGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId, pendingMoves]);

  const offerDouble = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiOfferDouble(gameId);
      setGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId]);

  const respondToDouble = useCallback(
    async (accept) => {
      try {
        setActionError(null);
        const updated = await apiRespondToDouble(gameId, accept);
        setGame(updated);
      } catch (err) {
        setActionError(err.message);
      }
    },
    [gameId]
  );

  // Close out a game that can never move again. The 400 ("not abandoned") and
  // 403 (not the survivor) both arrive as ordinary `{ error }` bodies, so they
  // land in `actionError` alongside every other rejected action.
  const abandonGame = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiAbandonGame(gameId);
      setGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId]);

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
    stageMove,
    resetTurn,
    confirmTurn,
    offerDouble,
    respondToDouble,
    canOfferDouble,
    deadlocked,
    abandonGame,
    canAbandon: canAbandon(game),
    reload,
  };
}
