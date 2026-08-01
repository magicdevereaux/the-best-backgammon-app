import { renderHook, act, waitFor } from '@testing-library/react';
import { useGame } from '../useGame';
import * as gameApi from '../../api/gameApi';

jest.mock('../../api/gameApi');

// Standard backgammon starting position.
const INITIAL_BOARD = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

const baseGame = {
  id: 1,
  current_turn: 'p1',
  board_state: INITIAL_BOARD,
  dice_values: [3, 5],
  status: 'active',
};

describe('useGame', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches the game and initializes staged state from it', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.game).toEqual(baseGame);
    expect(result.current.stagedBoard).toEqual(INITIAL_BOARD);
    expect(result.current.stagedDice).toEqual([3, 5]);
    expect(result.current.pendingMoves).toEqual([]);
  });

  test('legalMoves reflects the staged board and remaining dice', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Point 1 has 2 p1 checkers; die 3 -> point 4 (open) is legal.
    expect(result.current.legalMoves).toContainEqual([1, 4, 3]);
  });

  test('stageMove applies a legal move to the staged board without contacting the backend', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.stageMove(1, 4);
    });

    expect(result.current.stagedBoard.points[0]).toBe(1);
    expect(result.current.stagedBoard.points[3]).toBe(1);
    expect(result.current.stagedDice).toEqual([5]);
    expect(result.current.pendingMoves).toEqual([{ from_point: 1, to_point: 4 }]);
    expect(gameApi.confirmTurn).not.toHaveBeenCalled();
    // The authoritative game/board is untouched until confirmed.
    expect(result.current.game.board_state).toEqual(INITIAL_BOARD);
  });

  test('stageMove ignores illegal moves', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Dice are [3, 5]; a move using a die of 1 is not legal.
    act(() => {
      result.current.stageMove(1, 2);
    });

    expect(result.current.stagedBoard).toEqual(INITIAL_BOARD);
    expect(result.current.stagedDice).toEqual([3, 5]);
    expect(result.current.pendingMoves).toEqual([]);
  });

  test('resetTurn reverts staged moves back to the start of the turn', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.stageMove(1, 4);
    });
    act(() => {
      result.current.resetTurn();
    });

    expect(result.current.stagedBoard).toEqual(INITIAL_BOARD);
    expect(result.current.stagedDice).toEqual([3, 5]);
    expect(result.current.pendingMoves).toEqual([]);
  });

  test('confirmTurn sends pending moves and replaces the game with the response', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);
    const updatedGame = {
      ...baseGame,
      current_turn: 'p2',
      dice_values: [],
      board_state: { points: [1, 0, 0, 1, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2], bar: { p1: 0, p2: 0 }, off: { p1: 0, p2: 0 } },
    };
    gameApi.confirmTurn.mockResolvedValue(updatedGame);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.stageMove(1, 4);
    });

    await act(async () => {
      await result.current.confirmTurn();
    });

    expect(gameApi.confirmTurn).toHaveBeenCalledWith(1, [{ from_point: 1, to_point: 4 }]);
    expect(result.current.game).toEqual(updatedGame);
    expect(result.current.pendingMoves).toEqual([]);
    expect(result.current.stagedDice).toEqual([]);
  });

  test('confirmTurn surfaces an error without discarding the game', async () => {
    gameApi.fetchGame.mockResolvedValue(baseGame);
    gameApi.confirmTurn.mockRejectedValue(new Error('Illegal move.'));

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.confirmTurn();
    });

    expect(result.current.actionError).toBe('Illegal move.');
    expect(result.current.game).toEqual(baseGame);
  });

  test('mustUseMoreDice stays true after a staged move strands the other die', async () => {
    // Pre-turn board: checker A on point 1, checker B on point 4; points 9 and
    // 10 blocked. With [2, 6], playing the 2 first (1->3) strands the 6, but
    // playing the 6 first lets B play the 2 — so two dice are usable. After
    // staging the stranding 2, the staged board has no legal move, yet the
    // ported max-dice check must still require the second die.
    const strandBoard = {
      points: [1, 0, 0, 1, 0, 0, 0, 0, -2, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bar: { p1: 0, p2: 0 },
      off: { p1: 0, p2: 0 },
    };
    gameApi.fetchGame.mockResolvedValue({ ...baseGame, board_state: strandBoard, dice_values: [2, 6] });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mustUseMoreDice).toBe(true); // 0 of 2 used

    act(() => {
      result.current.stageMove(1, 3); // play the 2 first — strands the 6
    });

    expect(result.current.legalMoves).toEqual([]); // staged position looks done
    expect(result.current.mustUseMoreDice).toBe(true); // but 1 of 2 used — still blocked
  });

  test('mustUseMoreDice clears once the maximum dice are staged', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...baseGame, dice_values: [3, 5] });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mustUseMoreDice).toBe(true);

    act(() => {
      result.current.stageMove(1, 4); // use the 3
    });
    act(() => {
      result.current.stageMove(12, 17); // use the 5
    });

    expect(result.current.mustUseMoreDice).toBe(false);
  });

  test('canOfferDouble is true before rolling with a centered cube', async () => {
    gameApi.fetchGame.mockResolvedValue({
      ...baseGame, dice_values: [], cube_value: 1, cube_owner: null,
      double_offered_by: null, crawford_game: false,
    });
    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canOfferDouble).toBe(true);
  });

  test('canOfferDouble is false after rolling, in Crawford games, and when the opponent owns the cube', async () => {
    const scenarios = [
      { ...baseGame, dice_values: [3, 5], cube_value: 1, cube_owner: null },
      { ...baseGame, dice_values: [], cube_value: 1, cube_owner: null, crawford_game: true },
      { ...baseGame, dice_values: [], cube_value: 2, cube_owner: 'p2', current_turn: 'p1' },
    ];
    for (const scenario of scenarios) {
      gameApi.fetchGame.mockResolvedValue(scenario);
      const { result, unmount } = renderHook(() => useGame(1));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.canOfferDouble).toBe(false);
      unmount();
    }
  });

  test('offerDouble calls the API and swaps in the updated game', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...baseGame, dice_values: [] });
    const offered = { ...baseGame, dice_values: [], double_offered_by: 'p1' };
    gameApi.offerDouble.mockResolvedValue(offered);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.offerDouble();
    });

    expect(gameApi.offerDouble).toHaveBeenCalledWith(1);
    expect(result.current.game).toEqual(offered);
    expect(result.current.canOfferDouble).toBe(false); // offer now pending
  });

  test('respondToDouble passes the accept flag and surfaces errors', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...baseGame, dice_values: [], double_offered_by: 'p1' });
    const accepted = { ...baseGame, dice_values: [], cube_value: 2, cube_owner: 'p2', double_offered_by: null };
    gameApi.respondToDouble.mockResolvedValue(accepted);

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.respondToDouble(true);
    });
    expect(gameApi.respondToDouble).toHaveBeenCalledWith(1, true);
    expect(result.current.game).toEqual(accepted);

    gameApi.respondToDouble.mockRejectedValue(new Error('No double has been offered.'));
    await act(async () => {
      await result.current.respondToDouble(false);
    });
    expect(result.current.actionError).toBe('No double has been offered.');
  });

  test('rollDice replaces the game and resets staged dice', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...baseGame, dice_values: [] });
    gameApi.rollDice.mockResolvedValue({ ...baseGame, dice_values: [2, 6] });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rollDice();
    });

    expect(gameApi.rollDice).toHaveBeenCalledWith(1);
    expect(result.current.game.dice_values).toEqual([2, 6]);
    expect(result.current.stagedDice).toEqual([2, 6]);
    expect(result.current.pendingMoves).toEqual([]);
  });
});

/*
 * Auto-refresh. The web client used to require a manual reload to see an
 * opponent's move; it now polls on the same 3.5s cadence as mobile, with the
 * same guards. Fake timers throughout — advance by POLL_MS to fire a tick.
 */
describe('useGame polling', () => {
  const ONLINE = { ...baseGame, player1_user: 1, player2_user: 2, updated_at: 't1' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Settles the initial fetch without letting waitFor advance the poll timer.
  async function load(hookArgs = [1, 1]) {
    const rendered = renderHook(() => useGame(...hookArgs));
    await act(async () => {});
    return rendered;
  }

  test('re-fetches an active online game every 3.5s', async () => {
    gameApi.fetchGame.mockResolvedValue(ONLINE);
    await load();
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(2);

    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(3);
  });

  test('swaps in a changed payload but leaves an unchanged one alone', async () => {
    gameApi.fetchGame.mockResolvedValue(ONLINE);
    const { result } = await load();
    const first = result.current.game;

    // Same updated_at: the identical object is kept, so nothing re-renders.
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(result.current.game).toBe(first);

    // The opponent moved.
    gameApi.fetchGame.mockResolvedValue({ ...ONLINE, current_turn: 'p2', updated_at: 't2' });
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(result.current.game.current_turn).toBe('p2');
  });

  test('skips a tick while the local player has staged moves', async () => {
    gameApi.fetchGame.mockResolvedValue(ONLINE);
    const { result } = await load();

    act(() => { result.current.stageMove(1, 4); });

    await act(async () => { jest.advanceTimersByTime(3500 * 3); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(1); // only the initial load
    // The staged turn survived untouched.
    expect(result.current.pendingMoves).toEqual([{ from_point: 1, to_point: 4 }]);
    expect(result.current.stagedDice).toEqual([5]);

    // Once the staged moves are cleared, polling resumes.
    act(() => { result.current.resetTurn(); });
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(2);
  });

  test('never polls a local hotseat game', async () => {
    // Both seats on this device: no accounts, or only the viewer's own.
    for (const g of [
      { ...baseGame, player1_user: null, player2_user: null },
      { ...baseGame, player1_user: 1, player2_user: null },
    ]) {
      jest.clearAllMocks();
      gameApi.fetchGame.mockResolvedValue(g);
      const { unmount } = await load();
      await act(async () => { jest.advanceTimersByTime(3500 * 4); });
      expect(gameApi.fetchGame).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  test('polls a waiting game so the creator sees the opponent arrive', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...ONLINE, status: 'waiting', player2_user: null });
    await load();
    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(2);
  });

  test('stops polling once the game is finished', async () => {
    gameApi.fetchGame.mockResolvedValue({ ...ONLINE, status: 'finished', winner: 'p1' });
    await load();
    await act(async () => { jest.advanceTimersByTime(3500 * 4); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(1);
  });

  test('stops polling a game deadlocked on a closed seat', async () => {
    // p2 deleted their account and it is p2's turn — the payload can never change.
    gameApi.fetchGame.mockResolvedValue({ ...ONLINE, current_turn: 'p2', player2_deleted: true });
    const { result } = await load();
    expect(result.current.deadlocked).toBe(true);

    await act(async () => { jest.advanceTimersByTime(3500 * 4); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(1);
  });

  test('keeps polling when the closed seat is not the one that has to act', async () => {
    // p2 deleted, but p1 is on turn — p1 can still play, so this is live.
    gameApi.fetchGame.mockResolvedValue({ ...ONLINE, current_turn: 'p1', player2_deleted: true });
    const { result } = await load();
    expect(result.current.deadlocked).toBe(false);

    await act(async () => { jest.advanceTimersByTime(3500); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(2);
  });

  test('clears the interval on unmount', async () => {
    gameApi.fetchGame.mockResolvedValue(ONLINE);
    const { unmount } = await load();
    unmount();

    await act(async () => { jest.advanceTimersByTime(3500 * 5); });
    expect(gameApi.fetchGame).toHaveBeenCalledTimes(1);
  });
});
