import { request } from "./client";

export function fetchGames() {
  return request("/api/games/");
}

export function fetchLobby() {
  return request("/api/games/?status=waiting");
}

export function fetchGame(id) {
  return request(`/api/games/${id}/`);
}

export function createGame(data) {
  return request("/api/games/", { method: "POST", body: JSON.stringify(data) });
}

export function joinGame(id, player2Name) {
  return request(`/api/games/${id}/join/`, {
    method: "POST",
    body: JSON.stringify(player2Name ? { player2_name: player2Name } : {}),
  });
}

export function rollDice(id) {
  return request(`/api/games/${id}/roll_dice/`, { method: "POST" });
}

export function confirmTurn(id, moves) {
  return request(`/api/games/${id}/confirm_turn/`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}

export function offerDouble(id) {
  return request(`/api/games/${id}/offer_double/`, { method: "POST" });
}

export function respondToDouble(id, accept) {
  return request(`/api/games/${id}/respond_to_double/`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
}

// Close out a game deadlocked by a closed seat (the player who owes the next
// action deleted their account, so the server refuses that seat to everyone).
// Non-scoring and final: the game finishes with no winner, win_type
// "abandoned", points_value 0, and the match — if any — finishes too with its
// score untouched. No body. 400 when the game isn't active or isn't actually
// deadlocked, 403 when the caller may not act for the surviving seat.
export function abandonGame(id) {
  return request(`/api/games/${id}/abandon/`, { method: "POST" });
}

// Claim an inactivity forfeit against an opponent who is past their turn
// deadline. Unlike abandonGame this DOES score: the game finishes with
// win_type "timeout", a real winner, and one point times the cube value, which
// goes into the match normally. No body. 400 when the deadline hasn't passed
// (a device clock running ahead of the server's is the likely cause), when the
// game isn't in a claimable state, or when a seat is a guest; 403 when the
// caller doesn't hold the claiming seat. See
// docs/decisions/adr-002-inactivity-forfeit.md.
export function claimTimeout(id) {
  return request(`/api/games/${id}/claim_timeout/`, { method: "POST" });
}
