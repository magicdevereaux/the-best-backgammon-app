import { API_BASE_URL, assertApiConfigured } from "./config";
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
  // Surfaces a misconfigured/unreachable build as a clear message in the UI's
  // error path rather than an opaque network failure.
  assertApiConfigured();

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
    const message =
      (data && (data.error || data.detail)) ||
      firstFieldError(data) ||
      `API error: ${res.status}`;
    throw new Error(message);
  }
  return data;
}

// DRF serializer validation returns a field-keyed dict of message arrays
// (`{"email": ["Enter a valid email address."]}`) rather than the `{error}` /
// `{detail}` shapes above. Surface the first of those instead of a bare status
// code, so PATCH /api/auth/me/ and friends can show the server's own wording.
function firstFieldError(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    if (typeof value === "string") return value;
  }
  return null;
}
