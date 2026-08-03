import { request } from "./apiClient";

const BASE = "/api/games/";

export async function fetchGames() {
  return request(BASE);
}

export async function fetchLobby() {
  return request(`${BASE}?status=waiting`);
}

export async function fetchGame(id) {
  return request(`${BASE}${id}/`);
}

export async function createGame(data) {
  return request(BASE, { method: "POST", body: JSON.stringify(data) });
}

export async function joinGame(id, player2Name) {
  return request(`${BASE}${id}/join/`, {
    method: "POST",
    body: JSON.stringify(player2Name ? { player2_name: player2Name } : {}),
  });
}

export async function rollDice(id) {
  return request(`${BASE}${id}/roll_dice/`, { method: "POST" });
}

export async function confirmTurn(id, moves) {
  return request(`${BASE}${id}/confirm_turn/`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}

export async function offerDouble(id) {
  return request(`${BASE}${id}/offer_double/`, { method: "POST" });
}

export async function respondToDouble(id, accept) {
  return request(`${BASE}${id}/respond_to_double/`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
}

/**
 * Close out a game deadlocked by a closed seat (the player who owes the next
 * action deleted their account, so the server 403s that seat for everyone).
 *
 * Not a resign: the game finishes with `winner: null`, `win_type: "abandoned"`,
 * `points_value: 0` and no change to the match score. The server refuses it
 * unless the deadlock is real — 400 "This game is not abandoned — the player to
 * act still has an open seat." — and unless the caller may act for the
 * surviving seat (403). Both come back as `{ error }`, which `request` already
 * turns into the thrown message.
 */
export async function abandonGame(id) {
  return request(`${BASE}${id}/abandon/`, { method: "POST" });
}

/**
 * Claim the win against an opponent who has run out of time to move.
 *
 * Unlike `abandonGame` this *scores*: the game comes back finished with
 * `win_type: "timeout"`, a real `winner`, and one point times the cube value
 * applied to the match (see docs/decisions/adr-002-inactivity-forfeit.md).
 *
 * The server is the authority on the clock. It refuses with 400 when the
 * deadline has not actually passed (a client whose clock runs ahead of the
 * server's can get here early), when the game isn't in a claimable state, or
 * when a seat is a guest; and 403 when the caller doesn't hold the claiming
 * seat. All of them arrive as ordinary `{ error }` bodies, which `request`
 * turns into the thrown message.
 */
export async function claimTimeout(id) {
  return request(`${BASE}${id}/claim_timeout/`, { method: "POST" });
}
