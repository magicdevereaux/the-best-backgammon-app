import { API_BASE_URL, assertApiConfigured } from "./config";
import { request } from "./client";
import { setTokens, clearTokens, getAccessToken } from "./tokenStore";

// register/login hit the auth endpoints directly (no bearer token yet), then
// persist the returned JWT pair to SecureStore.

/**
 * Create an account. `email` is optional by design — an address is what buys
 * the account password recovery, but requiring one would shut out the
 * guest-friendly path the whole app is built around. Omitted entirely from the
 * body when blank rather than sent as "", so the request stays byte-identical
 * to the no-email registration it always was.
 */
export async function register(username, password, email) {
  assertApiConfigured();
  const trimmedEmail = (email || "").trim();
  const body = { username, password };
  if (trimmedEmail) body.email = trimmedEmail;

  const res = await fetch(`${API_BASE_URL}/api/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data?.username?.[0] ||
      data?.email?.[0] ||
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
 * Set or clear the logged-in account's email address. `email` is the only
 * writable field on `/api/auth/me/` (`username` is read-only and a PATCH naming
 * it is silently ignored), and passing `""` clears the address.
 *
 * Goes through `request()` for the bearer token and its 401 refresh-and-retry;
 * a malformed address comes back as `{"email": ["Enter a valid email
 * address."]}`, which `request` surfaces verbatim.
 *
 * Returns the full user payload, same shape as `GET /api/auth/me/`.
 */
export async function updateEmail(email) {
  return request("/api/auth/me/", {
    method: "PATCH",
    body: JSON.stringify({ email: (email || "").trim() }),
  });
}

/**
 * Switch turn-reminder emails on or off. The other writable field on
 * `/api/auth/me/`, and the reason that mail is legitimate at all: addresses
 * were collected for password reset, so game mail needs a real opt-out.
 *
 * Sent alone — a PATCH that omits `email` leaves the address untouched, which
 * is what lets this be a one-tap toggle rather than a form submit.
 *
 * Returns the full user payload, same shape as `GET /api/auth/me/`, whose
 * `turn_reminder_emails` is always a real boolean (the server resolves the
 * default), so callers should render the response rather than what they sent.
 */
export async function updateTurnReminders(enabled) {
  return request("/api/auth/me/", {
    method: "PATCH",
    body: JSON.stringify({ turn_reminder_emails: Boolean(enabled) }),
  });
}

/**
 * Ask the backend to mail a password-reset link. Unauthenticated.
 *
 * The backend answers **identically** whether or not an account holds the
 * address — a deliberate anti-enumeration measure — so this resolves with the
 * server's own `detail` string and the UI must show it unchanged. Never branch
 * on whether an account was found; the client cannot know, and must not appear
 * to.
 *
 * The reset link itself opens the *web* client; there is no in-app confirm
 * screen.
 */
export async function requestPasswordReset(email) {
  assertApiConfigured();
  const res = await fetch(`${API_BASE_URL}/api/auth/password-reset/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: (email || "").trim() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Only ever a malformed/missing address (400) or the 5/hour throttle (429).
    throw new Error(
      data?.email?.[0] || data?.detail || "Could not send a reset email. Please try again."
    );
  }
  return (
    data?.detail ||
    "If an account with that email address exists, a password reset link has been sent to it."
  );
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
