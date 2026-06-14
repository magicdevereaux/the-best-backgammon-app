const BASE_URL = "/api/games/";

async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error) || `API error: ${res.status}`;
    throw new Error(message);
  }
  return data;
}

/**
 * Fetch all games from the API.
 * GET /api/games/
 * Returns: Game[]
 */
export async function fetchGames() {
  return request("");
}

/**
 * Fetch a single game by its ID.
 * GET /api/games/:id/
 * Returns: Game
 */
export async function fetchGame(id) {
  return request(`${id}/`);
}

/**
 * Create a new game.
 * POST /api/games/
 * Body: { player1_name: string, player2_name: string }
 * Returns: Game (the newly created object including its assigned id)
 */
export async function createGame(data) {
  return request("", { method: "POST", body: JSON.stringify(data) });
}

/**
 * Ask the server to roll dice for the given game.
 * POST /api/games/:id/roll_dice/
 * Returns: Game (updated with new dice_values)
 */
export async function rollDice(id) {
  return request(`${id}/roll_dice/`, { method: "POST" });
}

/**
 * Move a checker on the given game.
 * POST /api/games/:id/move_checker/
 * Body: { from_point: int, to_point: int }
 * Returns: Game (updated board_state and dice_values)
 */
export async function moveChecker(id, fromPoint, toPoint) {
  return request(`${id}/move_checker/`, {
    method: "POST",
    body: JSON.stringify({ from_point: fromPoint, to_point: toPoint }),
  });
}

/**
 * Commit a sequence of staged moves and end the current turn.
 * POST /api/games/:id/confirm_turn/
 * Body: { moves: [{ from_point: int, to_point: int }, ...] }
 * Returns: Game (updated board_state, dice_values cleared, turn switched)
 */
export async function confirmTurn(id, moves) {
  return request(`${id}/confirm_turn/`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}
