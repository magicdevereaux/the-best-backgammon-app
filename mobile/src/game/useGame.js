import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  fetchGame,
  rollDice as apiRollDice,
  confirmTurn as apiConfirmTurn,
} from "../api/games";
import { getLegalMoves, getCombinedMoves, applyMove } from "./logic";

// How often to poll the backend for the opponent's moves while a game is active.
const POLL_MS = 3500;

// Replay a sequence of moves from a base board, returning the resulting board
// and the dice still remaining. Each move consumes the die its matching legal
// move used (same rule as stageMove), so the result is identical to having
// staged those moves one by one.
function replay(baseBoard, player, rolledDice, moves) {
  let board = {
    points: [...baseBoard.points],
    bar: { ...baseBoard.bar },
    off: { ...baseBoard.off },
  };
  const dice = [...rolledDice];
  for (const mv of moves) {
    const match = getLegalMoves(board, player, dice).find(
      (m) => m[0] === mv.from_point && m[1] === mv.to_point
    );
    if (match) dice.splice(dice.indexOf(match[2]), 1);
    board = applyMove(board, player, mv.from_point, mv.to_point);
  }
  return { board, dice };
}

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
  // Sub-move counts per user action (1 for a single move, 2+ for a combined
  // move) so Undo can revert a combined move as one action. pendingMoves itself
  // stays a flat list of single moves for the backend and for replay().
  const [moveGroups, setMoveGroups] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

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

  // Silent re-fetch (pull-to-refresh / manual sync) — unlike reload() this
  // doesn't toggle the full-screen loading state.
  const refresh = useCallback(async () => {
    if (!gameId) return;
    setRefreshing(true);
    try {
      const fresh = await fetchGame(gameId);
      setGame((cur) => (cur && fresh.updated_at === cur.updated_at ? cur : fresh));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, [gameId]);

  // Keep refs of the bits the poller needs so the interval can stay stable
  // (one subscription) without disrupting an in-progress staged turn.
  const pendingRef = useRef(0);
  const statusRef = useRef(null);
  pendingRef.current = pendingMoves.length;
  statusRef.current = game?.status;

  // Only poll while this screen is focused AND the app is foregrounded, so we
  // don't churn the network in the background or yank state out from under a
  // user who has navigated away.
  const focusedRef = useRef(true);
  const appActiveRef = useRef(AppState.currentState === "active");

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      return () => {
        focusedRef.current = false;
      };
    }, [])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      appActiveRef.current = s === "active";
    });
    return () => sub?.remove?.();
  }, []);

  // Poll for opponent moves while the game is active. Skips polling whenever
  // the local player has staged moves (never clobbers their turn), while
  // unfocused/backgrounded, and only swaps in state that actually changed
  // (by updated_at) so a steady stream of identical responses causes no
  // re-render or flicker.
  useEffect(() => {
    if (!gameId) return;
    const interval = setInterval(() => {
      if (statusRef.current !== "active" || pendingRef.current > 0) return;
      if (!focusedRef.current || !appActiveRef.current) return;
      fetchGame(gameId)
        .then((fresh) => {
          setGame((cur) => (cur && fresh.updated_at === cur.updated_at ? cur : fresh));
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [gameId]);

  // Whenever the authoritative game state changes, start a fresh staged turn.
  useEffect(() => {
    if (!game) return;
    setStagedBoard(cloneBoard(game.board_state));
    setStagedDice([...game.dice_values]);
    setPendingMoves([]);
    setMoveGroups([]);
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

  const stageMove = useCallback(
    (fromPoint, toPoint) => {
      if (!game || !stagedBoard) return;
      const match = legalMoves.find(
        (m) => m[0] === fromPoint && m[1] === toPoint
      );
      if (!match) return;

      const player = game.current_turn;

      // Combined move: play each sub-move in order, consuming each die, and
      // record the group size so Undo reverts the whole move at once. The
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
        setMoveGroups((prev) => [...prev, newMoves.length]);
        return;
      }

      // Single-die move.
      const die = match[2];
      const newDice = [...stagedDice];
      newDice.splice(newDice.indexOf(die), 1);

      setStagedBoard(applyMove(stagedBoard, player, fromPoint, toPoint));
      setStagedDice(newDice);
      setPendingMoves((prev) => [...prev, { from_point: fromPoint, to_point: toPoint }]);
      setMoveGroups((prev) => [...prev, 1]);
    },
    [game, stagedBoard, stagedDice, legalMoves]
  );

  const resetTurn = useCallback(() => {
    if (!game) return;
    setStagedBoard(cloneBoard(game.board_state));
    setStagedDice([...game.dice_values]);
    setPendingMoves([]);
    setMoveGroups([]);
  }, [game]);

  // Revert the most recently staged action by replaying the rest. A combined
  // move counts as one action, so its sub-moves are dropped together.
  const undoMove = useCallback(() => {
    if (!game || moveGroups.length === 0) return;
    const lastCount = moveGroups[moveGroups.length - 1];
    const keep = pendingMoves.slice(0, pendingMoves.length - lastCount);
    const { board, dice } = replay(
      game.board_state,
      game.current_turn,
      game.dice_values,
      keep
    );
    setStagedBoard(board);
    setStagedDice(dice);
    setPendingMoves(keep);
    setMoveGroups(moveGroups.slice(0, -1));
  }, [game, pendingMoves, moveGroups]);

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
    undoMove,
    confirmTurn,
    reload,
    refresh,
    refreshing,
  };
}
