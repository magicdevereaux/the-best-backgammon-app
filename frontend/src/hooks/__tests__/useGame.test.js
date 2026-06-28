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
