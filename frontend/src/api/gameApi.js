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

export async function moveChecker(id, fromPoint, toPoint) {
  return request(`${BASE}${id}/move_checker/`, {
    method: "POST",
    body: JSON.stringify({ from_point: fromPoint, to_point: toPoint }),
  });
}

export async function confirmTurn(id, moves) {
  return request(`${BASE}${id}/confirm_turn/`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}
