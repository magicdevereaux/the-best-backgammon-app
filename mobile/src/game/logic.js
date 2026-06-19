// JS port of backend/game/game_logic.py (mirrors frontend/src/utils/gameLogic.js),
// used for client-side move staging: legal-move highlighting and tentative board
// updates before a turn is confirmed. Coordinate conventions match the backend:
//   - Points are numbered 1-24 (index = point - 1 in boardState.points).
//   - from_point === 0 means the move enters a checker from the bar.
//   - to_point === 25 means the move bears a checker off.
//   - Player 1 moves toward increasing point numbers (home board 19-24);
//     Player 2 moves toward decreasing point numbers (home board 1-6).

export const P1 = "p1";
export const P2 = "p2";

const DIRECTION = { [P1]: 1, [P2]: -1 };

const HOME_INDICES = {
  [P1]: [18, 19, 20, 21, 22, 23],
  [P2]: [0, 1, 2, 3, 4, 5],
};

export function opponent(player) {
  return player === P1 ? P2 : P1;
}

function checkerSign(player) {
  return player === P1 ? 1 : -1;
}

function entryPoint(player, die) {
  return player === P1 ? die : 25 - die;
}

function bearOffDistance(player, fromPoint) {
  return player === P1 ? 25 - fromPoint : fromPoint;
}

function isPointOpen(boardState, player, point) {
  const value = boardState.points[point - 1];
  return value * checkerSign(player) >= -1;
}

export function canBearOff(boardState, player) {
  if (boardState.bar[player] > 0) return false;
  const sign = checkerSign(player);
  const home = new Set(HOME_INDICES[player]);
  return boardState.points.every(
    (value, idx) => !(value * sign > 0 && !home.has(idx))
  );
}

/**
 * Return the legal moves for `player` given the current board and remaining
 * dice, as an array of [from_point, to_point, die] tuples.
 *
 * If the player has checkers on the bar, only bar-entry moves are returned
 * (entering from the bar always takes priority over other moves).
 */
export function getLegalMoves(boardState, player, diceValues) {
  const moves = [];
  if (!diceValues || diceValues.length === 0) return moves;

  const sign = checkerSign(player);
  const distinctDice = [...new Set(diceValues)];

  if (boardState.bar[player] > 0) {
    for (const die of distinctDice) {
      const entry = entryPoint(player, die);
      if (isPointOpen(boardState, player, entry)) {
        moves.push([0, entry, die]);
      }
    }
    return moves;
  }

  const bearOffOk = canBearOff(boardState, player);
  let maxHomeDistance = 0;
  if (bearOffOk) {
    for (const idx of HOME_INDICES[player]) {
      if (boardState.points[idx] * sign > 0) {
        const dist = bearOffDistance(player, idx + 1);
        if (dist > maxHomeDistance) maxHomeDistance = dist;
      }
    }
  }

  boardState.points.forEach((value, idx) => {
    if (value * sign <= 0) return;
    const fromPoint = idx + 1;
    for (const die of distinctDice) {
      const toPoint = fromPoint + DIRECTION[player] * die;
      if (toPoint >= 1 && toPoint <= 24) {
        if (isPointOpen(boardState, player, toPoint)) {
          moves.push([fromPoint, toPoint, die]);
        }
      } else if (bearOffOk) {
        const dist = bearOffDistance(player, fromPoint);
        if (die === dist || (die > dist && dist === maxHomeDistance)) {
          moves.push([fromPoint, 25, die]);
        }
      }
    }
  });

  return moves;
}

/**
 * Return a new board state with the given move applied. Handles entering from
 * the bar, hitting a lone opponent checker (sending it to the bar), and bearing
 * off. Does not mutate the input boardState.
 */
export function applyMove(boardState, player, fromPoint, toPoint) {
  const points = [...boardState.points];
  const bar = { ...boardState.bar };
  const off = { ...boardState.off };
  const sign = checkerSign(player);

  if (fromPoint === 0) {
    bar[player] -= 1;
  } else {
    points[fromPoint - 1] -= sign;
  }

  if (toPoint === 25) {
    off[player] += 1;
  } else {
    const idx = toPoint - 1;
    if (points[idx] * sign < 0) {
      points[idx] = sign;
      bar[opponent(player)] += 1;
    } else {
      points[idx] += sign;
    }
  }

  return { points, bar, off };
}

/** Return 'p1' or 'p2' if that player has borne off all 15 checkers, else null. */
export function checkWinner(boardState) {
  if (boardState.off[P1] === 15) return P1;
  if (boardState.off[P2] === 15) return P2;
  return null;
}

/** True if [from,to] hits a lone opponent blot (used for amber highlighting). */
export function isBlotHit(boardState, player, toPoint) {
  if (toPoint >= 25 || toPoint <= 0) return false;
  const v = boardState.points[toPoint - 1];
  return player === P1 ? v === -1 : v === 1;
}
