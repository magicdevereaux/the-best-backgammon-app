import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchGame,
  rollDice as apiRollDice,
  confirmTurn as apiConfirmTurn,
} from "../api/games";
import { getLegalMoves, applyMove } from "./logic";

function cloneBoard(boardState) {
  return {
    points: [...boardState.points],
    bar: { ...boardState.bar },
    off: { ...boardState.off },
  };
}

/**
 * Manages state for a single game including a "staged turn": tentative moves
 * the player tries out before committing. Staged moves update a local copy of
 * the board and dice but are not sent to the backend until confirmTurn().
 * Ported from frontend/src/hooks/useGame.js.
 */
export function useGame(gameId) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  // Whenever the authoritative game state changes, start a fresh staged turn.
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

  const legalMoves = useMemo(() => {
    if (!game || !stagedBoard) return [];
    return getLegalMoves(stagedBoard, game.current_turn, stagedDice);
  }, [game, stagedBoard, stagedDice]);

  const stageMove = useCallback(
    (fromPoint, toPoint) => {
      if (!game || !stagedBoard) return;
      const match = legalMoves.find(
        (m) => m[0] === fromPoint && m[1] === toPoint
      );
      if (!match) return;

      const die = match[2];
      const newDice = [...stagedDice];
      newDice.splice(newDice.indexOf(die), 1);

      setStagedBoard(applyMove(stagedBoard, game.current_turn, fromPoint, toPoint));
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
    stageMove,
    resetTurn,
    confirmTurn,
    reload,
  };
}
