import { renderHook, act, waitFor } from '@testing-library/react';
import { useGame } from '../useGame';
import * as gameApi from '../../api/gameApi';

jest.mock('../../api/gameApi');

describe('useGame', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetches the game on mount', async () => {
    gameApi.fetchGame.mockResolvedValue({ id: 1, status: 'active' });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.game).toEqual({ id: 1, status: 'active' });
    expect(result.current.error).toBeNull();
  });

  test('rollDice replaces the game with the updated one from the API', async () => {
    gameApi.fetchGame.mockResolvedValue({ id: 1, dice_values: [] });
    gameApi.rollDice.mockResolvedValue({ id: 1, dice_values: [3, 5] });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rollDice();
    });

    expect(gameApi.rollDice).toHaveBeenCalledWith(1);
    expect(result.current.game.dice_values).toEqual([3, 5]);
  });

  test('moveChecker sends from/to and updates the game on success', async () => {
    gameApi.fetchGame.mockResolvedValue({ id: 1, board_state: { points: [] } });
    gameApi.moveChecker.mockResolvedValue({ id: 1, board_state: { points: ['updated'] } });

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.moveChecker(1, 2);
    });

    expect(gameApi.moveChecker).toHaveBeenCalledWith(1, 1, 2);
    expect(result.current.game.board_state.points).toEqual(['updated']);
  });

  test('moveChecker surfaces an illegal-move error without discarding the game', async () => {
    gameApi.fetchGame.mockResolvedValue({ id: 1, board_state: { points: [] } });
    gameApi.moveChecker.mockRejectedValue(new Error('Illegal move.'));

    const { result } = renderHook(() => useGame(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.moveChecker(1, 3);
    });

    expect(result.current.actionError).toBe('Illegal move.');
    expect(result.current.game).toEqual({ id: 1, board_state: { points: [] } });
  });
});
