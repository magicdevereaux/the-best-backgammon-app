import { useState, useEffect, useCallback } from "react";
import {
  fetchGame,
  rollDice as apiRollDice,
  moveChecker as apiMoveChecker,
} from "../api/gameApi";

/**
 * Hook that manages the state for a single game.
 * Fetches the game on mount and exposes action callbacks.
 */
export function useGame(gameId) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Transient feedback from the last roll/move action (e.g. "Illegal move."),
  // kept separate from `error` so it doesn't replace the whole page.
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    fetchGame(gameId)
      .then(setGame)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId]);

  const rollDice = useCallback(async () => {
    try {
      setActionError(null);
      const updated = await apiRollDice(gameId);
      setGame(updated);
    } catch (err) {
      setActionError(err.message);
    }
  }, [gameId]);

  const moveChecker = useCallback(
    async (fromPoint, toPoint) => {
      try {
        setActionError(null);
        const updated = await apiMoveChecker(gameId, fromPoint, toPoint);
        setGame(updated);
      } catch (err) {
        setActionError(err.message);
      }
    },
    [gameId]
  );

  return { game, loading, error, actionError, rollDice, moveChecker };
}
