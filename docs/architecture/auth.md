# Authentication & Accounts

The auth stack **as currently built** — endpoints, token lifecycle, the shared
client refresh-retry, and where it's tested. Intended-but-unbuilt pieces are under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

For how auth relates to seat ownership and online play, see
[overview.md](overview.md); this doc is the auth-focused deep dive.

## Model

There is **no custom user model** — accounts are Django's stock
`django.contrib.auth.models.User`. A user has only a `username` + `password`;
everything shown on the profile (wins, losses, gammons, points, rates) is
**computed on read** by `UserSerializer`, never stored. See
[data-model.md](data-model.md).

## Endpoints

| Endpoint | View | Returns |
|----------|------|---------|
| `POST /api/auth/register/` | `RegisterView` | `{ user, access, refresh }` (201) |
| `POST /api/auth/login/` | SimpleJWT `TokenObtainPairView` | `{ access, refresh }` |
| `POST /api/auth/refresh/` | SimpleJWT `TokenRefreshView` | `{ access }` |
| `GET /api/auth/me/` | `MeView` (`IsAuthenticated`) | current user + computed stats |

- **Register** ([`views.py`](../../backend/game/views.py)) validates via
  `RegisterSerializer` (username unique, password ≥ 8 chars), creates the user with
  `create_user` (hashes the password), and **mints a token pair immediately** so the
  client is logged in on signup with no second round-trip.
- **Login / refresh** are the stock SimpleJWT views, wired in
  [`urls.py`](../../backend/game/urls.py).
- **`/me/`** is the only auth-gated endpoint (`IsAuthenticated`). Everything else is
  `AllowAny` (see the security note below).

Token lifetimes are set in [`settings.py`](../../backend/backgammon/settings.py):
**access 1 hour, refresh 7 days**.

## Client token lifecycle

Both clients follow the same shape: a small auth module persists the token pair and
exposes `register` / `login` / `fetchMe` / `logout`, and a shared `request()` wrapper
injects the bearer token and does a **single silent refresh-and-retry on a 401**.

| Concern | Web | Mobile |
|---------|-----|--------|
| Token storage | `localStorage` (`access` / `refresh`) | `expo-secure-store` (`bg_access` / `bg_refresh`) |
| Auth module | [`api/authApi.js`](../../frontend/src/api/authApi.js) | [`api/auth.js`](../../mobile/src/api/auth.js) + [`api/tokenStore.js`](../../mobile/src/api/tokenStore.js) |
| Request wrapper | [`api/apiClient.js`](../../frontend/src/api/apiClient.js) | [`api/client.js`](../../mobile/src/api/client.js) |
| Session context | [`context/AuthContext.jsx`](../../frontend/src/context/AuthContext.jsx) | [`context/AuthContext.jsx`](../../mobile/src/context/AuthContext.jsx) |
| Login screen | [`pages/LoginPage.jsx`](../../frontend/src/pages/LoginPage.jsx) + `RegisterPage.jsx` | [`app/login.jsx`](../../mobile/app/login.jsx) (login/register toggle) |

**The refresh-retry cycle** (`request()` on a 401):

1. Original request returns 401.
2. If a refresh token exists, `POST /api/auth/refresh/`.
3. On success, store the new access token and **retry the original request once**
   with it. On failure, **clear both tokens** and let the error propagate.

There is no retry loop — exactly one refresh attempt per request. With no refresh
token stored, the 401 is surfaced immediately with no refresh call.

**`AuthContext`** loads the session once on mount by calling `fetchMe()`, and holds
`user` as a three-state value: `undefined` = still loading, `null` = guest,
object = signed in. UI keys off this (e.g. web `Nav` shows nothing until it resolves).
`fetchMe()` returns `null` (never throws) when no token is stored or the token is
rejected, so a guest is a normal, non-error state.

## Test coverage

| Layer | File | Focus |
|-------|------|-------|
| Backend | [`tests/test_auth.py`](../../backend/game/tests/test_auth.py) | register (dupe/short-password), login (wrong password → 401), `/me/` gating + stat counts, refresh |
| Web API | `frontend/src/api/__tests__/authApi.test.js` | token storage, register/login/fetchMe/refresh/logout, error surfacing, "store nothing on failure" |
| Web client | `frontend/src/api/__tests__/apiClient.test.js` | bearer injection, 401→refresh→retry, no-refresh-token path, refresh-fails-clears-tokens |
| Web UI | `frontend/src/pages/__tests__/LoginPage.test.jsx` | login/register submit → navigate home; server error rendered, no navigation |
| Mobile store | `mobile/src/api/__tests__/tokenStore.test.js` | SecureStore get/set/clear; partial `setTokens` keeps refresh |
| Mobile API | `mobile/src/api/__tests__/auth.test.js` | register/login/fetchMe/logout, bearer on `/me/`, error surfacing |
| Mobile client | `mobile/src/api/__tests__/client.test.js` | bearer injection, 401→refresh→retry, no-refresh + refresh-fails paths |

Client tests mock `fetch`; mobile uses the in-memory SecureStore mock in
[`jest.setup.js`](../../mobile/jest.setup.js). Run them with the suite commands in
[CLAUDE.md](../../CLAUDE.md#tests).

## Security note (current limitations)

`AllowAny` is the default DRF permission, and `confirm_turn` / `roll_dice` only read
`game.current_turn` — they do **not** verify the caller owns that seat. So auth today
establishes *identity* (for stats and the `viewer_seat` ownership hint) but is **not**
a turn-security boundary: a crafted request can act on either seat. Seat/turn gating
is a client-side UX affordance only (and the web client does none). Moving enforcement
server-side is tracked below and in [overview.md](overview.md).

## Planned / Not Yet Implemented

- **httpOnly cookie auth.** Tokens live in `localStorage` (web) and SecureStore
  (mobile), not cookies. A `localStorage` access token is readable by any XSS on the
  page; cookie-based sessions are the intended hardening but are not built.
- **Logout ≠ token revocation.** `logout()` just clears client storage. There is no
  SimpleJWT blacklist app, so an already-issued access token stays valid until it
  expires (≤ 1 hour). Refresh-token rotation/blacklisting is not configured.
- **No password reset / change, no email.** Accounts are username + password only;
  there is no email field, verification, or reset flow.
- **Server-enforced seat/turn ownership** (see security note) — future work.
- **Rate limiting / lockout** on login and register is not configured.
