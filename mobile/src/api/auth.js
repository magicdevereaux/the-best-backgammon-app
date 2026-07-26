import { API_BASE_URL, assertApiConfigured } from "./config";
import { request } from "./client";
import { setTokens, clearTokens, getAccessToken } from "./tokenStore";

// register/login hit the auth endpoints directly (no bearer token yet), then
// persist the returned JWT pair to SecureStore.

export async function register(username, password) {
  assertApiConfigured();
  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data?.username?.[0] ||
      data?.password?.[0] ||
      data?.detail ||
      "Registration failed.";
    throw new Error(msg);
  }
  await setTokens(data.access, data.refresh);
  return data.user;
}

export async function login(username, password) {
  assertApiConfigured();
  const res = await fetch(`${API_BASE_URL}/api/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error("Invalid username or password.");
  await setTokens(data.access, data.refresh);
  return fetchMe();
}

export async function fetchMe() {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    return await request("/api/auth/me/");
  } catch {
    return null;
  }
}

/**
 * Permanently delete the logged-in account. Mirrors
 * frontend/src/api/authApi.js `deleteAccount`.
 *
 * Deliberately a bare fetch rather than `request()`: that helper retries once
 * through a token refresh on a 401 (pointless once the account is gone) and
 * only reads `{ error }` / `{ detail }` bodies, whereas the confirm-password
 * rejection arrives as a DRF field error, `{ password: [...] }`.
 *
 * Success is 204 with no body. SecureStore is cleared here so the app can
 * never be left holding credentials for an account that no longer exists.
 */
export async function deleteAccount(password) {
  assertApiConfigured();
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE_URL}/api/auth/me/`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ password }),
  });

  if (res.status === 204) {
    await clearTokens();
    return true;
  }

  const data = await res.json().catch(() => null);
  const msg =
    data?.password?.[0] ||
    data?.detail ||
    "Could not delete your account. Please try again.";
  throw new Error(msg);
}

export async function logout() {
  await clearTokens();
}
