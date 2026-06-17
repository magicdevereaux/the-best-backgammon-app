import { request } from "./apiClient";

const BASE = "/api/matches/";

export function fetchMatch(id) {
  return request(`${BASE}${id}/`);
}

export function createMatch(data) {
  return request(BASE, { method: "POST", body: JSON.stringify(data) });
}

export function nextGame(matchId) {
  return request(`${BASE}${matchId}/next_game/`, { method: "POST", body: JSON.stringify({}) });
}

export function joinMatch(matchId, player2_name) {
  return request(`${BASE}${matchId}/join/`, {
    method: "POST",
    body: JSON.stringify(player2_name ? { player2_name } : {}),
  });
}
