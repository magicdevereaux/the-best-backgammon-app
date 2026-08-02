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

/**
 * Create an account. `email` is optional by design — an address is what buys
 * the account password recovery, but requiring one would shut out the
 * guest-friendly path the rest of the app is built around. A blank address is
 * omitted from the body entirely rather than sent as "", so the server sees the
 * field as absent.
 */
export async function register(username, password, email) {
  const trimmedEmail = (email || "").trim();
  const res = await fetch(BASE_URL + "register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      ...(trimmedEmail ? { email: trimmedEmail } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg =
      data?.username?.[0] ||
      data?.password?.[0] ||
      data?.email?.[0] ||
      data?.detail ||
      "Registration failed.";
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
 * Set or clear the logged-in account's email address (`PATCH /api/auth/me/`).
 * Pass "" to clear it. `email` is the only writable field there — `username` is
 * read-only, because games carry a denormalised copy of it.
 *
 * A bare fetch rather than apiClient.request() for the same reason as
 * deleteAccount below: the rejection is a DRF field error,
 * `{ email: ["Enter a valid email address."] }`, which `request` cannot read.
 *
 * Resolves to the full UserSerializer payload — same shape as fetchMe().
 */
export async function updateEmail(email) {
  const token = getAccessToken();
  const res = await fetch(BASE_URL + "me/", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ email: (email || "").trim() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.email?.[0] || data?.detail || "Could not save your email address."
    );
  }
  return data;
}

/** Pull the first message out of a DRF field error, which may be a list or a
 *  bare string (`password-reset/confirm/` returns `token` as a plain string). */
function firstMessage(value) {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : null;
}

/**
 * Ask for a password reset link (`POST /api/auth/password-reset/`).
 *
 * The server answers a hit and a miss identically — an anti-enumeration
 * measure — so this resolves with nothing distinguishing either. Callers must
 * render one fixed confirmation and never branch on the result; anything else
 * would rebuild the membership oracle the flat response exists to prevent.
 * Only a malformed/missing address (400) or a transport failure rejects.
 */
export async function requestPasswordReset(email) {
  const res = await fetch(BASE_URL + "password-reset/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: (email || "").trim() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      firstMessage(data?.email) || data?.detail || "Could not send a reset link."
    );
  }
}

/**
 * Complete a reset with the uid + token from the emailed link
 * (`POST /api/auth/password-reset/confirm/`).
 *
 * 400s two ways: `token` for a link that is bad, expired or already used (a bad
 * uid is deliberately indistinguishable from a bad token), and `new_password`
 * for anything AUTH_PASSWORD_VALIDATORS rejects. The link is checked first, so a
 * caller without a valid one never gets free password-policy feedback.
 */
export async function confirmPasswordReset(uid, token, newPassword) {
  const res = await fetch(BASE_URL + "password-reset/confirm/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, token, new_password: newPassword }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      firstMessage(data?.token) ||
        firstMessage(data?.new_password) ||
        data?.detail ||
        "Could not reset your password."
    );
  }
  return data;
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
