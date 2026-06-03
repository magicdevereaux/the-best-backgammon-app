import { useState, useEffect, useCallback } from "react";
import { fetchGame, rollDice as apiRollDice } from "../api/gameApi";

/**
 * Hook that manages the state for a single game.
 * Fetches the game on mount and exposes action callbacks.
 */
export function useGame(gameId) {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      const updated = await apiRollDice(gameId);
      setGame(updated);
    } catch (err) {
      setError(err.message);
    }
  }, [gameId]);

  return { game, loading, error, rollDice };
}
