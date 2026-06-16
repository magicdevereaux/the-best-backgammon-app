import { getAccessToken, refreshAccessToken } from "./authApi";

const BASE_URL = "/api/games/";

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(BASE_URL + path, { ...options, headers });

  // On 401, attempt a silent token refresh and retry once.
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(BASE_URL + path, { ...options, headers });
    }
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error) || `API error: ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export async function fetchGames() {
  return request("");
}

export async function fetchLobby() {
  return request("?status=waiting");
}

export async function fetchGame(id) {
  return request(`${id}/`);
}

export async function createGame(data) {
  return request("", { method: "POST", body: JSON.stringify(data) });
}

export async function joinGame(id, player2Name) {
  return request(`${id}/join/`, {
    method: "POST",
    body: JSON.stringify(player2Name ? { player2_name: player2Name } : {}),
  });
}

export async function rollDice(id) {
  return request(`${id}/roll_dice/`, { method: "POST" });
}

export async function moveChecker(id, fromPoint, toPoint) {
  return request(`${id}/move_checker/`, {
    method: "POST",
    body: JSON.stringify({ from_point: fromPoint, to_point: toPoint }),
  });
}

export async function confirmTurn(id, moves) {
  return request(`${id}/confirm_turn/`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}
