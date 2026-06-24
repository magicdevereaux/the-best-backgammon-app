import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useGame } from "../useGame";
import * as games from "../../api/games";

jest.mock("../../api/games");
// useGame pulls useFocusEffect from expo-router; stub it (no navigation in tests).
jest.mock("expo-router", () => ({ useFocusEffect: () => {} }));

const INITIAL = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

const baseGame = {
  id: 1,
  status: "active",
  current_turn: "p1",
  board_state: INITIAL,
  dice_values: [3, 5],
  updated_at: "t0",
};

beforeEach(() => {
  jest.clearAllMocks();
  games.fetchGame.mockResolvedValue(baseGame);
  games.rollDice.mockResolvedValue(baseGame);
  games.confirmTurn.mockResolvedValue({
    ...baseGame,
    current_turn: "p2",
    dice_values: [],
    updated_at: "t1",
  });
});

async function mountLoaded() {
  const view = renderHook(() => useGame(1));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useGame", () => {
  test("loads the game and seeds the staged turn", async () => {
    const { result } = await mountLoaded();
    expect(result.current.game).toEqual(baseGame);
    expect(result.current.stagedBoard).toEqual(INITIAL);
    expect(result.current.stagedDice).toEqual([3, 5]);
    expect(result.current.pendingMoves).toEqual([]);
  });

  test("stageMove updates the tentative board/dice without hitting the backend", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.stageMove(1, 4)); // uses the 3

    expect(result.current.stagedBoard.points[0]).toBe(1);
    expect(result.current.stagedBoard.points[3]).toBe(1);
    expect(result.current.stagedDice).toEqual([5]);
    expect(result.current.pendingMoves).toEqual([{ from_point: 1, to_point: 4 }]);
    expect(games.confirmTurn).not.toHaveBeenCalled();
    // authoritative game is untouched
    expect(result.current.game.board_state).toEqual(INITIAL);
  });

  test("undoMove reverts only the last staged move", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.stageMove(1, 4));  // consume 3
    act(() => result.current.stageMove(12, 17)); // consume 5
    expect(result.current.pendingMoves).toHaveLength(2);

    act(() => result.current.undoMove());
    expect(result.current.pendingMoves).toEqual([{ from_point: 1, to_point: 4 }]);
    expect(result.current.stagedDice).toEqual([5]);
    expect(result.current.stagedBoard.points[16]).toBe(3); // point 17 back to original
  });

  test("resetTurn clears all staged moves", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.stageMove(1, 4));
    act(() => result.current.resetTurn());
    expect(result.current.stagedBoard).toEqual(INITIAL);
    expect(result.current.stagedDice).toEqual([3, 5]);
    expect(result.current.pendingMoves).toEqual([]);
  });

  test("confirmTurn sends staged moves and adopts the returned game", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.stageMove(1, 4));

    await act(async () => { await result.current.confirmTurn(); });

    expect(games.confirmTurn).toHaveBeenCalledWith(1, [{ from_point: 1, to_point: 4 }]);
    expect(result.current.game.current_turn).toBe("p2");
    expect(result.current.stagedDice).toEqual([]);
    expect(result.current.pendingMoves).toEqual([]);
  });
});
