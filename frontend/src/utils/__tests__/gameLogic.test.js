import {
  opponent,
  canBearOff,
  getLegalMoves,
  getCombinedMoves,
  applyMove,
  checkWinner,
} from '../gameLogic';

// Standard backgammon starting position (mirrors backend get_initial_board_state()).
const INITIAL_BOARD = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

function emptyBoard() {
  return {
    points: Array(24).fill(0),
    bar: { p1: 0, p2: 0 },
    off: { p1: 0, p2: 0 },
  };
}

describe('opponent', () => {
  test('opponent of p1 is p2', () => {
    expect(opponent('p1')).toBe('p2');
  });

  test('opponent of p2 is p1', () => {
    expect(opponent('p2')).toBe('p1');
  });
});

describe('getLegalMoves', () => {
  test('simple open move is legal', () => {
    const moves = getLegalMoves(INITIAL_BOARD, 'p1', [1]);
    expect(moves).toContainEqual([1, 2, 1]);
  });

  test('move onto point with two opponent checkers is illegal', () => {
    // Point 6 (index 5) holds -5 (p2) — blocked for p1.
    const moves = getLegalMoves(INITIAL_BOARD, 'p1', [5]);
    expect(moves).not.toContainEqual([1, 6, 5]);
  });

  test('move onto lone opponent blot is legal', () => {
    const board = emptyBoard();
    board.points[0] = 1; // p1 at point 1
    board.points[4] = -1; // p2 blot at point 5
    const moves = getLegalMoves(board, 'p1', [4]);
    expect(moves).toContainEqual([1, 5, 4]);
  });

  test('checkers on bar must enter first', () => {
    const board = { ...INITIAL_BOARD, bar: { p1: 1, p2: 0 } };
    const moves = getLegalMoves(board, 'p1', [3]);
    expect(moves.every((m) => m[0] === 0)).toBe(true);
    expect(moves).toContainEqual([0, 3, 3]);
  });

  test('bar entry blocked by two opponent checkers', () => {
    const board = {
      ...INITIAL_BOARD,
      points: [...INITIAL_BOARD.points],
      bar: { p1: 1, p2: 0 },
    };
    board.points[2] = -2; // point 3 blocked
    const moves = getLegalMoves(board, 'p1', [3]);
    expect(moves).not.toContainEqual([0, 3, 3]);
  });

  test('no moves without dice', () => {
    expect(getLegalMoves(INITIAL_BOARD, 'p1', [])).toEqual([]);
  });

  test('cannot bear off with checkers outside home', () => {
    const moves = getLegalMoves(INITIAL_BOARD, 'p1', [1, 2, 3, 4, 5, 6]);
    expect(moves.some((m) => m[1] === 25)).toBe(false);
  });

  test('bear off with exact die', () => {
    const board = emptyBoard();
    board.points[18] = 1; // point 19, distance 6 for p1
    board.points[23] = 14; // point 24, distance 1 for p1
    const moves = getLegalMoves(board, 'p1', [1]);
    expect(moves).toContainEqual([24, 25, 1]);
    expect(moves).not.toContainEqual([19, 25, 1]);
  });

  test('bear off with higher die from highest point', () => {
    const board = emptyBoard();
    board.points[23] = 15; // all p1 checkers on point 24, distance 1
    const moves = getLegalMoves(board, 'p1', [6]);
    expect(moves).toContainEqual([24, 25, 6]);
  });

  test('bear off with higher die cannot skip farther checker', () => {
    const board = emptyBoard();
    board.points[18] = 1; // point 19, distance 6
    board.points[23] = 14; // point 24, distance 1
    const moves = getLegalMoves(board, 'p1', [6]);
    expect(moves).toContainEqual([19, 25, 6]);
    expect(moves).not.toContainEqual([24, 25, 6]);
  });

  test('p2 moves toward lower points', () => {
    // Point 24 (index 23) holds -2 (p2); p2 moves toward decreasing numbers.
    const moves = getLegalMoves(INITIAL_BOARD, 'p2', [1]);
    expect(moves).toContainEqual([24, 23, 1]);
  });

  test('p2 bar entry uses high points', () => {
    const board = { ...INITIAL_BOARD, bar: { p1: 0, p2: 1 } };
    const moves = getLegalMoves(board, 'p2', [3]);
    // Die 3 enters p2 on point 25 - 3 = 22.
    expect(moves).toContainEqual([0, 22, 3]);
  });
});

describe('getCombinedMoves', () => {
  test('non-doubles: highlights the summed destination via a legal intermediate', () => {
    const board = emptyBoard();
    board.points[0] = 1; // p1 at point 1
    const combos = getCombinedMoves(board, 'p1', [2, 3]);
    const combo = combos.find((m) => m[0] === 1 && m[1] === 6);
    expect(combo).toBeDefined();      // 1 -> 6 using 2 + 3
    expect(combo[2]).toHaveLength(2); // two sub-moves in the path
    // single-die destinations are NOT included here (use getLegalMoves)
    expect(combos.find((m) => m[1] === 3)).toBeUndefined();
    expect(combos.find((m) => m[1] === 4)).toBeUndefined();
  });

  test('non-doubles: uses the open ordering when one intermediate is blocked', () => {
    const board = emptyBoard();
    board.points[0] = 1;  // p1 at point 1
    board.points[2] = -2; // point 3 blocked → the 2-first ordering is dead
    const combos = getCombinedMoves(board, 'p1', [2, 3]);
    // 1 -> 4 (die 3) -> 6 (die 2) is still legal
    expect(combos.find((m) => m[0] === 1 && m[1] === 6)).toBeDefined();
  });

  test('non-doubles: no combined move when both intermediates are blocked', () => {
    const board = emptyBoard();
    board.points[0] = 1;
    board.points[2] = -2; // point 3 blocked
    board.points[3] = -2; // point 4 blocked
    const combos = getCombinedMoves(board, 'p1', [2, 3]);
    expect(combos.find((m) => m[1] === 6)).toBeUndefined();
  });

  test('doubles: chains +2x, +3x and +4x as far as the dice allow', () => {
    const board = emptyBoard();
    board.points[0] = 1; // p1 at point 1
    const combos = getCombinedMoves(board, 'p1', [2, 2, 2, 2]);
    const tos = combos.filter((m) => m[0] === 1).map((m) => m[1]).sort((a, b) => a - b);
    expect(tos).toEqual([5, 7, 9]); // 1->5 (2 dice), ->7 (3), ->9 (4)
  });

  test('returns nothing with fewer than two dice', () => {
    const board = emptyBoard();
    board.points[0] = 1;
    expect(getCombinedMoves(board, 'p1', [4])).toEqual([]);
  });

  test('returns nothing while a checker is on the bar', () => {
    const board = emptyBoard();
    board.points[0] = 1;
    board.bar.p1 = 1;
    expect(getCombinedMoves(board, 'p1', [2, 3])).toEqual([]);
  });
});

describe('applyMove', () => {
  test('normal move updates points', () => {
    const board = applyMove(INITIAL_BOARD, 'p1', 1, 2);
    expect(board.points[0]).toBe(1);
    expect(board.points[1]).toBe(1);
  });

  test('hitting blot sends opponent to bar', () => {
    const start = emptyBoard();
    start.points[0] = 1;
    start.points[4] = -1;
    const board = applyMove(start, 'p1', 1, 5);
    expect(board.points[0]).toBe(0);
    expect(board.points[4]).toBe(1);
    expect(board.bar.p2).toBe(1);
  });

  test('entering from bar decrements bar count', () => {
    const start = { ...emptyBoard(), bar: { p1: 1, p2: 0 } };
    const board = applyMove(start, 'p1', 0, 3);
    expect(board.bar.p1).toBe(0);
    expect(board.points[2]).toBe(1);
  });

  test('bearing off increments off count', () => {
    const start = emptyBoard();
    start.points[23] = 1;
    const board = applyMove(start, 'p1', 24, 25);
    expect(board.points[23]).toBe(0);
    expect(board.off.p1).toBe(1);
  });

  test('does not mutate the input board', () => {
    const start = emptyBoard();
    start.points[0] = 1;
    applyMove(start, 'p1', 1, 2);
    expect(start.points[0]).toBe(1);
    expect(start.points[1]).toBe(0);
  });
});

describe('canBearOff', () => {
  test('false when checkers outside home', () => {
    expect(canBearOff(INITIAL_BOARD, 'p1')).toBe(false);
  });

  test('false when checkers on bar', () => {
    const board = emptyBoard();
    board.points[18] = 15;
    board.bar.p1 = 1;
    expect(canBearOff(board, 'p1')).toBe(false);
  });

  test('true when all checkers in home', () => {
    const board = emptyBoard();
    board.points[18] = 15;
    expect(canBearOff(board, 'p1')).toBe(true);
  });
});

describe('checkWinner', () => {
  test('no winner initially', () => {
    expect(checkWinner(INITIAL_BOARD)).toBeNull();
  });

  test('p1 wins with 15 off', () => {
    const board = emptyBoard();
    board.off.p1 = 15;
    expect(checkWinner(board)).toBe('p1');
  });

  test('p2 wins with 15 off', () => {
    const board = emptyBoard();
    board.off.p2 = 15;
    expect(checkWinner(board)).toBe('p2');
  });
});
