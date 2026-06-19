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
