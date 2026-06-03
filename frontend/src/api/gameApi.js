// Base URL for the Django API. The React dev server proxies /api/* to
// localhost:8000 (configured via "proxy" in package.json).
const BASE_URL = "/api/games";

// -----------------------------------------------------------------------------
// TODO: Implement the fetch calls in each function below.
//
// All functions should:
//   - Use the native fetch() API (or axios if you prefer — add it to package.json)
//   - Throw an error if the HTTP response is not ok (response.ok === false)
//   - Return the parsed JSON body
//
// Hint: a reusable helper might look like:
//   async function request(path, options = {}) {
//     const res = await fetch(BASE_URL + path, {
//       headers: { "Content-Type": "application/json" },
//       ...options,
//     });
//     if (!res.ok) throw new Error(`API error: ${res.status}`);
//     return res.json();
//   }
// -----------------------------------------------------------------------------


/**
 * Fetch all games from the API.
 * GET /api/games/
 * Returns: Game[]
 */
export async function fetchGames() {
  // TODO: make a GET request to BASE_URL + "/" and return the JSON array
  throw new Error("fetchGames() is not yet implemented");
}


/**
 * Fetch a single game by its ID.
 * GET /api/games/:id/
 * Returns: Game
 */
export async function fetchGame(id) {
  // TODO: make a GET request to BASE_URL + `/${id}/` and return the JSON object
  throw new Error("fetchGame() is not yet implemented");
}


/**
 * Create a new game.
 * POST /api/games/
 * Body: { player1_name: string, player2_name: string }
 * Returns: Game (the newly created object including its assigned id)
 */
export async function createGame(data) {
  // TODO: make a POST request with JSON body `data` and return the created Game
  throw new Error("createGame() is not yet implemented");
}


/**
 * Ask the server to roll dice for the given game.
 * POST /api/games/:id/roll_dice/
 * Returns: Game (updated with new dice_values)
 */
export async function rollDice(id) {
  // TODO: make a POST request to BASE_URL + `/${id}/roll_dice/` and return
  //       the updated Game object
  throw new Error("rollDice() is not yet implemented");
}


/**
 * Move a checker on the given game.
 * POST /api/games/:id/move_checker/
 * Body: { from_point: int, to_point: int }
 * Returns: Game (updated board_state and dice_values)
 */
export async function moveChecker(id, fromPoint, toPoint) {
  // TODO: make a POST request with body { from_point, to_point } and return
  //       the updated Game object
  throw new Error("moveChecker() is not yet implemented");
}
