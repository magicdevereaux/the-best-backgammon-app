import { API_BASE_URL } from "./config";
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  clearTokens,
} from "./tokenStore";

// Mirrors frontend/src/api/apiClient.js: injects the bearer token and, on a
// 401, attempts a single silent refresh-and-retry before giving up.
async function rawRequest(path, options, token) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}

async function refreshAccessToken() {
  const refresh = await getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(`${API_BASE_URL}/api/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    await clearTokens();
    return null;
  }
  const data = await res.json();
  await setAccessToken(data.access);
  return data.access;
}

export async function request(path, options = {}) {
  let token = await getAccessToken();
  let res = await rawRequest(path, options, token);

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await rawRequest(path, options, newToken);
    }
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && (data.error || data.detail)) || `API error: ${res.status}`;
    throw new Error(message);
  }
  return data;
}
