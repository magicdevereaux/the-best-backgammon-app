import { apiUrl } from "./config";

const BASE_URL = apiUrl("/api/auth/");

export function getAccessToken() {
  return localStorage.getItem("access");
}

export function getRefreshToken() {
  return localStorage.getItem("refresh");
}

export function setTokens(access, refresh) {
  localStorage.setItem("access", access);
  localStorage.setItem("refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
}

export async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(BASE_URL + "refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = await res.json();
  localStorage.setItem("access", data.access);
  return data.access;
}

export async function register(username, password) {
  const res = await fetch(BASE_URL + "register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.username?.[0] || data?.password?.[0] || data?.detail || "Registration failed.";
    throw new Error(msg);
  }
  setTokens(data.access, data.refresh);
  return data.user;
}

export async function login(username, password) {
  const res = await fetch(BASE_URL + "login/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Invalid username or password.");
  setTokens(data.access, data.refresh);
  return fetchMe();
}

export async function fetchMe() {
  const token = getAccessToken();
  if (!token) return null;
  const res = await fetch(BASE_URL + "me/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Permanently delete the logged-in account.
 *
 * Deliberately a bare fetch rather than apiClient.request(): that helper
 * retries once through a token refresh on a 401 (pointless here — the account
 * is gone, so a retry can only fail again) and only knows how to read a
 * `{ error }` body, whereas the confirm-password rejection comes back as a
 * DRF field error, `{ password: ["Password is incorrect."] }`.
 *
 * Success is 204 with no body. Tokens are cleared here so a failed navigation
 * can't leave the app holding credentials for an account that no longer exists.
 */
export async function deleteAccount(password) {
  const token = getAccessToken();
  const res = await fetch(BASE_URL + "me/", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ password }),
  });

  if (res.status === 204) {
    clearTokens();
    return true;
  }

  const data = await res.json().catch(() => null);
  const msg =
    data?.password?.[0] ||
    data?.detail ||
    "Could not delete your account. Please try again.";
  throw new Error(msg);
}

export function logout() {
  clearTokens();
}
