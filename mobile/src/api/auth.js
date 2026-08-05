import { API_BASE_URL, assertApiConfigured } from "./config";
import { request } from "./client";
import { setTokens, clearTokens, getAccessToken } from "./tokenStore";

// register/login hit the auth endpoints directly (no bearer token yet), then
// persist the returned JWT pair to SecureStore.

/**
 * Create an account. `email` is **required** as of ADR-003: the server rejects a
 * missing or blank address with `{"email": ["This field is required."]}`.
 *
 * It used to be optional, on the reasoning that requiring an address would shut
 * out the guest-friendly path the app is built around. That reasoning was wrong
 * about *which* path is the guest-friendly one — guest play needs no account at
 * all, so nobody has to register to play. What an account without an address
 * actually got was a permanently unrecoverable password and no turn reminders,
 * the reminder mail being the only warning a player gets before a game is
 * forfeited on its 48-hour inactivity clock. Both losses are silent, which is
 * the worst way to lose something.
 *
 * Nothing is gated on *verifying* the address — an unconfirmed account plays
 * exactly like a confirmed one — so this asks for a way to reach the player, not
 * for proof of anything.
 *
 * The field is sent unconditionally, even when blank, so the required-field
 * refusal is the server's own message rather than a client-side guess at the
 * same rule that could drift from it.
 */
export async function register(username, password, email) {
  assertApiConfigured();
  const body = { username, password, email: (email || "").trim() };

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
 * Change the logged-in account's email address. One of two writable fields on
 * `/api/auth/me/` (`username` is read-only and a PATCH naming it is silently
 * ignored; `turn_reminder_emails` is the other).
 *
 * **The address can no longer be blanked.** It used to be clearable by sending
 * `""`; since ADR-003 made it required at registration the server rejects an
 * empty value, so this is change-only and callers must not offer a remove
 * control. Nothing here guards against that — the trimmed value is sent as-is
 * and the server's refusal is what the UI shows.
 *
 * Goes through `request()` for the bearer token and its 401 refresh-and-retry;
 * a malformed or blank address comes back as `{"email": [...]}`, which
 * `request` surfaces verbatim.
 *
 * Returns the full user payload, same shape as `GET /api/auth/me/`. That
 * payload's read-only `email_verified` is the field to render afterwards:
 * saving a *different* address makes the account unconfirmed again, so callers
 * must trust the response over anything they had cached.
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
 * Ask the backend to re-send the address-confirmation email. Authenticated,
 * and takes no body — the address is whatever is on the requesting account.
 *
 * Goes through `request()` for the bearer token and its 401 refresh-and-retry,
 * like `updateEmail` / `updateTurnReminders` above.
 *
 * Resolves with `{ detail, email_verified }`. **Both 200 shapes are ordinary
 * outcomes, not errors**, and the second is easy to miss: a fresh send answers
 * `email_verified: false`, while an address confirmed in a browser since this
 * screen was last loaded answers `200` with `email_verified: true` and a detail
 * saying it was already confirmed. Callers should render `detail` and trust the
 * returned `email_verified` over whatever they had cached — that response is
 * how a stale "unconfirmed" badge gets corrected.
 *
 * Throws on 400 (the account has no address at all) and on the 60-second
 * cool-down's 429. The cool-down is not a failure either — it means a mail is
 * already in flight — so callers should show `err.status === 429` as a notice.
 * `request` tags the thrown Error with the status precisely so that is possible
 * without sniffing the server's wording.
 *
 * The emailed link still points at the **web** client
 * (`{FRONTEND_BASE_URL}/verify-email/{token}`), because that URL is built
 * server-side from `FRONTEND_BASE_URL` and mail clients will not follow a
 * custom scheme. So the copy next to this call must keep saying the link opens
 * in a browser. `confirmEmailVerification` below is the *other* half — the app
 * can now finish the job when it is handed a token some other way.
 */
export async function resendEmailVerification() {
  return request("/api/auth/verify-email/resend/", { method: "POST" });
}

/**
 * Confirm an address with the token from a verification link
 * (`POST /api/auth/verify-email/confirm/`).
 *
 * **Unauthenticated, and that is the point.** The token *is* the credential, and
 * the person holding it is very often on a device that has never logged in.
 * Sending them to a login wall to prove ownership of the address they are in the
 * middle of proving ownership of would be circular. So this is a bare `fetch`
 * like `requestPasswordReset`, not `request()` — that helper attaches a bearer
 * token and retries once through a refresh on a 401, both of which are
 * meaningless for a call that never authenticates.
 *
 * **The server is idempotent here**: the same token posted twice answers 200
 * both times. A double-tap, a mail client that prefetches links, or a screen
 * that remounts cannot turn a good confirmation into a scary failure. Callers
 * should still avoid firing twice — not for correctness, but because the outcome
 * would flash twice.
 *
 * The single failure mode is a dead or expired link, which arrives as
 * `{"token": [...]}`; a bad token and an expired one are deliberately
 * indistinguishable, so there is one "this link is no good" outcome to render
 * rather than two.
 *
 * Resolves to `{ detail, email, email_verified }`.
 */
export async function confirmEmailVerification(token) {
  assertApiConfigured();
  const res = await fetch(`${API_BASE_URL}/api/auth/verify-email/confirm/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: (token || "").trim() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.token?.[0] || data?.detail || "Could not confirm your email address."
    );
  }
  return data;
}

/**
 * Finish a password reset with the `uid`/`token` pair from a reset link
 * (`POST /api/auth/password-reset/confirm/`).
 *
 * Unauthenticated for the same reason as `confirmEmailVerification`: the pair
 * *is* the credential, and someone resetting a password by definition cannot log
 * in. Bare `fetch`, not `request()`.
 *
 * Both values are posted back exactly as they were received — no trimming, no
 * normalising. A reset token is an opaque server-generated string and the client
 * has no business tidying it; a bad `uid` and a bad `token` come back as the
 * same refusal anyway.
 *
 * **On success the server blacklists every outstanding refresh token for the
 * account**, so any session anywhere — including this device's — is dead. That
 * is a security property, not a bug, but it looks exactly like one from the
 * inside, so callers must say out loud that signing in again is required.
 *
 * Two different 400s land here and callers need to tell them apart, because one
 * is retryable and the other is not. A `{"token": [...]}` body means the link
 * itself is dead: re-typing the password cannot help, and leaving the form up
 * would be an affordance that can only fail. A `{"new_password": [...]}` body is
 * Django's `AUTH_PASSWORD_VALIDATORS` refusing the *password* — the link is
 * fine, and the user should simply pick a better one. The thrown Error carries
 * `.field` (`"token"` | `"new_password"` | `null`) so the UI can branch on that
 * rather than regex-sniffing the server's wording, in the same spirit as the
 * `.status` tagging in [`client.js`](./client.js).
 *
 * Resolves to `{ detail }`.
 */
export async function confirmPasswordReset(uid, token, newPassword) {
  assertApiConfigured();
  const res = await fetch(`${API_BASE_URL}/api/auth/password-reset/confirm/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, token, new_password: newPassword }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const deadLink = data?.token?.[0];
    const badPassword = data?.new_password?.[0];
    const err = new Error(
      deadLink || badPassword || data?.detail || "Could not reset your password."
    );
    err.field = deadLink ? "token" : badPassword ? "new_password" : null;
    throw err;
  }
  return data;
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
 * The emailed link itself still opens the *web* client — the URL is built
 * server-side from `FRONTEND_BASE_URL`, and no mail client will follow a custom
 * scheme — so the copy beside this call has to keep saying "in your browser".
 * There *is* now an in-app confirm screen (`confirmPasswordReset` below), but it
 * is reached by the custom scheme or a hand-off from the web client, not by
 * tapping the link in a mail app.
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
