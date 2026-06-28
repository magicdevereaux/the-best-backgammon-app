import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchGame,
  rollDice as apiRollDice,
  confirmTurn as apiConfirmTurn,
} from "../api/gameApi";
import { getLegalMoves, getCombinedMoves, applyMove, maxMovesUsable } from "../utils/gameLogic";

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
 */
export function useGame(gameId) {
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
    reload,
  };
}
