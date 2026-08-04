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
 * Create an account. `email` is **required** as of ADR-003 — it is the only
 * route to password recovery, and it is the only channel that can warn a player
 * their game is about to be lost on its 48-hour clock. An account without one
 * is an account that can be silently forfeited and can never get back in.
 *
 * The key is therefore always sent, even blank: an empty field is a 400 the
 * server should get to phrase ("This field may not be blank."), not something
 * this layer quietly hides by omitting the key. Registration does not require a
 * *confirmed* address — nothing is gated behind verification except the
 * reminder mail itself — so nothing here waits on the emailed link.
 */
export async function register(username, password, email) {
  const res = await fetch(BASE_URL + "register/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      email: (email || "").trim(),
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
 * Change the logged-in account's email address (`PATCH /api/auth/me/`).
 *
 * It can no longer be *cleared*: the server 400s a blank value now that an
 * address is required at registration. Someone who wants the address gone
 * deletes the account; someone who only wants the mail to stop uses
 * updateTurnReminders below. So this always sends a real address and lets the
 * server reject an empty one rather than pretending clearing still works.
 *
 * Changing the address resets `email_verified` server-side, so callers must
 * render the returned payload rather than assume the badge is unchanged.
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

/**
 * Switch turn-reminder emails on or off (`PATCH /api/auth/me/`).
 *
 * The other writable field on that endpoint, and the reason the reminder mail
 * is legitimate at all: addresses were collected for password reset, so game
 * mail needs a real opt-out and this is it. Sent on its own — a PATCH that
 * omitted `email` leaves the address untouched, which is what lets this be a
 * one-click toggle rather than a form submit.
 *
 * Resolves to the full UserSerializer payload, same shape as fetchMe(), whose
 * `turn_reminder_emails` is always a real boolean (the server resolves the
 * default), so callers should render the response rather than what they sent.
 */
export async function updateTurnReminders(enabled) {
  const token = getAccessToken();
  const res = await fetch(BASE_URL + "me/", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ turn_reminder_emails: Boolean(enabled) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.turn_reminder_emails?.[0] ||
        data?.detail ||
        "Could not save your reminder setting."
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
 * Confirm an address with the token from the emailed link
 * (`POST /api/auth/verify-email/confirm/`).
 *
 * Unauthenticated on purpose: the token *is* the credential, and the person
 * reading the mail is very often on a device that has never logged in. Sending
 * them to a login wall to prove ownership of the address they are in the middle
 * of proving ownership of would be circular.
 *
 * The server is idempotent here — the same token posted twice is 200 both times
 * — so a double click, a mail client that prefetches links, or a re-opened tab
 * cannot turn a good confirmation into a scary failure. The single failure mode
 * is a dead or expired link, which arrives as `{ token: [...] }`.
 *
 * Resolves to `{ detail, email, email_verified }`.
 */
export async function confirmEmailVerification(token) {
  const res = await fetch(BASE_URL + "verify-email/confirm/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: (token || "").trim() }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      firstMessage(data?.token) ||
        data?.detail ||
        "Could not confirm your email address."
    );
  }
  return data;
}

/**
 * Ask for another confirmation email (`POST /api/auth/verify-email/resend/`).
 * Authenticated, no body — the server already knows which address it would send
 * to, and accepting one here would turn this into a mail cannon.
 *
 * Three of the four outcomes are **not failures** and must not be rendered as
 * one. Two are plain 200s: the mail went out, or the address was already
 * confirmed. The third is the 60-second cool-down, which the server signals with
 * a 429 — but "we only just sent it, check your inbox" is the answer the user
 * wanted, not an error, so it is unwrapped into the same resolved shape with
 * `throttled: true` rather than thrown. Only a genuine refusal (400, no address
 * on the account) or a transport failure rejects.
 *
 * `email_verified` is echoed by both 200s and is authoritative — a resend that
 * comes back already-confirmed means someone clicked the link in another tab,
 * and the caller should believe the server over its own stale copy. The 429 body
 * carries no such claim, hence `throttled` as the flag to check first.
 *
 * Resolves to `{ detail, email_verified?, throttled }`.
 */
export async function resendEmailVerification() {
  const token = getAccessToken();
  const res = await fetch(BASE_URL + "verify-email/resend/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (res.status === 429) {
    return {
      ...(data || {}),
      detail:
        data?.detail ||
        "A confirmation email was just sent. Check your inbox before asking for another.",
      throttled: true,
    };
  }
  if (!res.ok) {
    throw new Error(
      firstMessage(data?.email) ||
        data?.detail ||
        "Could not send a confirmation email."
    );
  }
  return { ...(data || {}), throttled: false };
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
