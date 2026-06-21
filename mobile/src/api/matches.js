import { request } from "./client";

// Mirrors frontend/src/api/matchApi.js against the same Django endpoints.

export function fetchMatch(id) {
  return request(`/api/matches/${id}/`);
}

export function createMatch(data) {
  return request("/api/matches/", { method: "POST", body: JSON.stringify(data) });
}

export function nextGame(matchId) {
  return request(`/api/matches/${matchId}/next_game/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function joinMatch(matchId, player2Name) {
  return request(`/api/matches/${matchId}/join/`, {
    method: "POST",
    body: JSON.stringify(player2Name ? { player2_name: player2Name } : {}),
  });
}
