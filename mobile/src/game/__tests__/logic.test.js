import {
  opponent,
  getLegalMoves,
  getCombinedMoves,
  applyMove,
  maxMovesUsable,
  higherDieRequiredMoves,
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

describe("maxMovesUsable", () => {
  test("returns 0 when no dice", () => {
    expect(maxMovesUsable(INITIAL, "p1", [])).toBe(0);
  });

  test("returns 0 when no legal move exists (all bar entries blocked)", () => {
    const board = {
      points: [-2, -2, -2, -2, -2, -2, ...Array(18).fill(0)],
      bar: { p1: 1, p2: 0 },
      off: { p1: 0, p2: 0 },
    };
    expect(maxMovesUsable(board, "p1", [1, 2])).toBe(0);
  });

  test("both dice usable from the opening position", () => {
    expect(maxMovesUsable(INITIAL, "p1", [1, 2])).toBe(2);
  });

  test("counts all four on doubles down an open lane", () => {
    const board = emptyBoard();
    board.points[0] = 1; // 1->3->5->7->9
    expect(maxMovesUsable(board, "p1", [2, 2, 2, 2])).toBe(4);
  });

  test("only one die usable when the other can never be played", () => {
    const board = emptyBoard();
    board.points[0] = 1;
    board.points[4] = -2; // point 5 blocked
    board.points[6] = -2; // point 7 blocked
    expect(maxMovesUsable(board, "p1", [2, 4])).toBe(1);
  });

  test("finds the move order that avoids stranding a die", () => {
    // Playing the 2 first (1->3) strands the 6; playing the 6 first (1->7) lets
    // the point-4 checker play the 2 for two dice. Must find the 2-die order.
    const board = emptyBoard();
    board.points[0] = 1;   // checker A on point 1
    board.points[3] = 1;   // checker B on point 4
    board.points[8] = -2;  // point 9 blocked
    board.points[9] = -2;  // point 10 blocked
    expect(maxMovesUsable(board, "p1", [2, 6])).toBe(2);
  });
});

// Mirrors backend/game/tests/test_higher_die.py and the web port's suite —
// same positions, same expectations. When only one of the two dice can be
// played but either is individually playable, the higher one is forced.
describe("higherDieRequiredMoves", () => {
  test("forces the exact bear-off with the higher die", () => {
    // p1 on 19 and 20; anchors on 21 and 24. The 2 only plays 20->22; the 5
    // bears off from 20 exactly. Only one die is usable, so the 5 is forced.
    const board = emptyBoard();
    board.points[18] = 1;
    board.points[19] = 1;
    board.points[20] = -2;
    board.points[23] = -2;
    board.off.p1 = 13;
    expect(higherDieRequiredMoves(board, "p1", [2, 5])).toEqual([[20, 25, 5]]);
  });

  test("forces the higher die on a within-board bear-off move", () => {
    const board = emptyBoard();
    board.points[18] = 1;
    board.points[19] = 1;
    board.points[20] = -2;
    board.points[22] = -2;
    board.off.p1 = 13;
    expect(higherDieRequiredMoves(board, "p1", [1, 3])).toEqual([[19, 22, 3]]);
  });

  test("prefers the oversized bear-off from the furthest-back checker", () => {
    // Last checker on 22 (distance 3), dice [3, 5]: both bear it off but only
    // one die can be used, so the 5 is spent rather than the 3.
    const board = emptyBoard();
    board.points[21] = 1;
    board.off.p1 = 14;
    expect(higherDieRequiredMoves(board, "p1", [3, 5])).toEqual([[22, 25, 5]]);
  });

  test("mirrors for p2 during bear-off", () => {
    const board = emptyBoard();
    board.points[5] = -1; // point 6
    board.points[4] = -1; // point 5
    board.points[3] = 2;  // point 4 anchored
    board.points[0] = 2;  // point 1 anchored
    board.off.p2 = 13;
    expect(higherDieRequiredMoves(board, "p2", [2, 5])).toEqual([[5, 25, 5]]);
  });

  test("applies mid-board, nowhere near bear-off (p1)", () => {
    // Lone checker on 12, anchor on 15: 12->13 or 12->14, follow-up blocked
    // either way, so only one die is usable and the 2 is forced.
    const board = emptyBoard();
    board.points[11] = 1;
    board.points[14] = -2;
    board.off.p1 = 14;
    expect(higherDieRequiredMoves(board, "p1", [1, 2])).toEqual([[12, 14, 2]]);
  });

  test("applies mid-board for p2 (mirrored direction)", () => {
    const board = emptyBoard();
    board.points[12] = -1; // point 13
    board.points[9] = 2;   // point 10 anchored
    board.off.p2 = 14;
    expect(higherDieRequiredMoves(board, "p2", [1, 2])).toEqual([[13, 11, 2]]);
  });

  test("applies when entering from the bar (p1)", () => {
    // Both entry points (2 and 5) are open, but point 7 blocks the follow-up
    // from either, so the entry must be made on the 5.
    const board = emptyBoard();
    board.bar.p1 = 1;
    board.points[6] = -2; // point 7
    board.off.p1 = 14;
    expect(higherDieRequiredMoves(board, "p1", [2, 5])).toEqual([[0, 5, 5]]);
  });

  test("applies when entering from the bar (p2)", () => {
    const board = emptyBoard();
    board.bar.p2 = 1;
    board.points[17] = 2; // point 18
    board.off.p2 = 14;
    expect(higherDieRequiredMoves(board, "p2", [2, 5])).toEqual([[0, 20, 5]]);
  });

  test("no restriction when both dice can be played", () => {
    const board = emptyBoard();
    board.points[19] = 1;
    board.points[21] = 1;
    board.off.p1 = 13;
    expect(higherDieRequiredMoves(board, "p1", [5, 3])).toBeNull();
  });

  test("no restriction when only the lower die is playable at all", () => {
    const board = emptyBoard();
    board.points[11] = 1;
    board.points[17] = -2; // point 18 blocks the 6
    board.points[18] = -2; // point 19 blocks the 6 after the 1
    board.off.p1 = 14;
    expect(higherDieRequiredMoves(board, "p1", [1, 6])).toBeNull();
  });

  test("no restriction when only the higher die is playable at all", () => {
    const board = emptyBoard();
    board.points[18] = 1;
    [19, 20, 21, 22].forEach((idx) => { board.points[idx] = -2; });
    board.off.p1 = 14;
    expect(higherDieRequiredMoves(board, "p1", [1, 6])).toBeNull();
  });

  test("no restriction on doubles, even when only one die is usable", () => {
    const board = emptyBoard();
    board.points[11] = 1;
    board.points[15] = -2; // point 16 stops the run after 12->14
    board.off.p1 = 14;
    expect(maxMovesUsable(board, "p1", [2, 2, 2, 2])).toBe(1);
    expect(higherDieRequiredMoves(board, "p1", [2, 2, 2, 2])).toBeNull();
  });

  test("no restriction from the opening position", () => {
    expect(higherDieRequiredMoves(INITIAL, "p1", [1, 2])).toBeNull();
  });

  test("no restriction with an empty or single-die roll", () => {
    expect(higherDieRequiredMoves(INITIAL, "p1", [])).toBeNull();
    expect(higherDieRequiredMoves(INITIAL, "p1", [3])).toBeNull();
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
