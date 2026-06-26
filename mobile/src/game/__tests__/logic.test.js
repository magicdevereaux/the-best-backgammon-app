import {
  opponent,
  getLegalMoves,
  getCombinedMoves,
  applyMove,
  canBearOff,
  checkWinner,
  isBlotHit,
} from "../logic";

// Standard backgammon starting position (mirrors the backend).
const INITIAL = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

function emptyBoard() {
  return { points: Array(24).fill(0), bar: { p1: 0, p2: 0 }, off: { p1: 0, p2: 0 } };
}

describe("opponent", () => {
  test("flips player", () => {
    expect(opponent("p1")).toBe("p2");
    expect(opponent("p2")).toBe("p1");
  });
});

describe("getLegalMoves (move staging source of truth)", () => {
  test("includes open destinations for p1 from the start", () => {
    const moves = getLegalMoves(INITIAL, "p1", [3, 5]);
    expect(moves).toContainEqual([1, 4, 3]);   // point 1 → 4 with the 3
    expect(moves).toContainEqual([12, 17, 5]);  // point 12 → 17 with the 5
  });

  test("excludes destinations blocked by 2+ opponent checkers", () => {
    const moves = getLegalMoves(INITIAL, "p1", [3, 5]);
    // point 1 + 5 = point 6, which holds five p2 checkers → blocked.
    expect(moves.find((m) => m[0] === 1 && m[1] === 6)).toBeUndefined();
  });

  test("returns nothing when there are no dice", () => {
    expect(getLegalMoves(INITIAL, "p1", [])).toEqual([]);
  });

  test("bar entry takes priority when a checker is on the bar", () => {
    const board = { ...INITIAL, bar: { p1: 1, p2: 0 } };
    const moves = getLegalMoves(board, "p1", [2, 4]);
    // Every move must be a bar-entry (from_point 0).
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m[0] === 0)).toBe(true);
  });

  test("offers a bear-off move once all checkers are home", () => {
    const board = emptyBoard();
    board.points[23] = 2; // two p1 checkers on point 24 (home)
    const moves = getLegalMoves(board, "p1", [1]);
    expect(moves).toContainEqual([24, 25, 1]); // bear off with a 1
  });
});

describe("getCombinedMoves (combined-move highlighting)", () => {
  test("non-doubles: offers the summed destination via a legal intermediate", () => {
    const board = emptyBoard();
    board.points[0] = 1; // p1 at point 1
    const combos = getCombinedMoves(board, "p1", [2, 3]);
    const combo = combos.find((m) => m[0] === 1 && m[1] === 6);
    expect(combo).toBeDefined();      // 1 -> 6 using 2 + 3
    expect(combo[2]).toHaveLength(2); // two sub-moves
    // single-die destinations are not part of the combined set
    expect(combos.find((m) => m[1] === 3)).toBeUndefined();
    expect(combos.find((m) => m[1] === 4)).toBeUndefined();
  });

  test("non-doubles: falls back to the open ordering when one intermediate is blocked", () => {
    const board = emptyBoard();
    board.points[0] = 1;  // p1 at point 1
    board.points[2] = -2; // point 3 blocked
    const combos = getCombinedMoves(board, "p1", [2, 3]);
    expect(combos.find((m) => m[0] === 1 && m[1] === 6)).toBeDefined();
  });

  test("non-doubles: nothing when both intermediates are blocked", () => {
    const board = emptyBoard();
    board.points[0] = 1;
    board.points[2] = -2; // point 3 blocked
    board.points[3] = -2; // point 4 blocked
    const combos = getCombinedMoves(board, "p1", [2, 3]);
    expect(combos.find((m) => m[1] === 6)).toBeUndefined();
  });

  test("doubles: chains +2x, +3x and +4x as far as the dice allow", () => {
    const board = emptyBoard();
    board.points[0] = 1; // p1 at point 1
    const combos = getCombinedMoves(board, "p1", [2, 2, 2, 2]);
    const tos = combos.filter((m) => m[0] === 1).map((m) => m[1]).sort((a, b) => a - b);
    expect(tos).toEqual([5, 7, 9]);
  });

  test("nothing with fewer than two dice", () => {
    const board = emptyBoard();
    board.points[0] = 1;
    expect(getCombinedMoves(board, "p1", [4])).toEqual([]);
  });

  test("nothing while a checker is on the bar", () => {
    const board = emptyBoard();
    board.points[0] = 1;
    board.bar.p1 = 1;
    expect(getCombinedMoves(board, "p1", [2, 3])).toEqual([]);
  });
});

describe("applyMove (tentative board update)", () => {
  test("moves a checker without mutating the input", () => {
    const next = applyMove(INITIAL, "p1", 1, 4);
    expect(next.points[0]).toBe(1);
    expect(next.points[3]).toBe(1);
    expect(INITIAL.points[0]).toBe(2); // original untouched
  });

  test("hitting a lone blot sends it to the bar", () => {
    const board = emptyBoard();
    board.points[0] = 1;   // p1 on point 1
    board.points[3] = -1;  // lone p2 blot on point 4
    const next = applyMove(board, "p1", 1, 4);
    expect(next.points[3]).toBe(1);     // p1 now occupies point 4
    expect(next.bar.p2).toBe(1);        // p2 blot sent to the bar
  });

  test("bearing off increments the off tray", () => {
    const board = emptyBoard();
    board.points[23] = 1;
    const next = applyMove(board, "p1", 24, 25);
    expect(next.off.p1).toBe(1);
    expect(next.points[23]).toBe(0);
  });
});

describe("canBearOff", () => {
  test("false while checkers remain outside home", () => {
    expect(canBearOff(INITIAL, "p1")).toBe(false);
  });
  test("true once all checkers are home and none on the bar", () => {
    const board = emptyBoard();
    board.points[18] = 8;
    board.points[23] = 7;
    expect(canBearOff(board, "p1")).toBe(true);
  });
  test("false when a checker is on the bar", () => {
    const board = emptyBoard();
    board.points[23] = 14;
    board.bar.p1 = 1;
    expect(canBearOff(board, "p1")).toBe(false);
  });
});

describe("checkWinner (win detection)", () => {
  test("null mid-game", () => {
    expect(checkWinner(INITIAL)).toBeNull();
  });
  test("p1 wins with all 15 off", () => {
    const board = emptyBoard();
    board.off.p1 = 15;
    expect(checkWinner(board)).toBe("p1");
  });
  test("p2 wins with all 15 off", () => {
    const board = emptyBoard();
    board.off.p2 = 15;
    expect(checkWinner(board)).toBe("p2");
  });
});

describe("isBlotHit (amber highlight)", () => {
  test("true for a lone opponent checker", () => {
    const board = emptyBoard();
    board.points[3] = -1;
    expect(isBlotHit(board, "p1", 4)).toBe(true);
  });
  test("false for an anchored point", () => {
    const board = emptyBoard();
    board.points[3] = -2;
    expect(isBlotHit(board, "p1", 4)).toBe(false);
  });
});
