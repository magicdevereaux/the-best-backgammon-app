# Authentication & Accounts

The auth stack **as currently built** — endpoints, token lifecycle, the shared
client refresh-retry, and where it's tested. Intended-but-unbuilt pieces are under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

For how auth relates to seat ownership and online play, see
[overview.md](overview.md); this doc is the auth-focused deep dive.

## Model

There is **no custom user model** — accounts are Django's stock
`django.contrib.auth.models.User`. A user has a `username`, a `password` and an
**optional `email`**; everything shown on the profile (wins, losses, gammons, points,
rates) is **computed on read** by `UserSerializer`, never stored. See
[data-model.md](data-model.md).

`email` is deliberately **not** unique-checked (`User.email` carries no unique
constraint, and adding one would turn registration into a "is this address already
registered?" oracle), so every lookup uses `email__iexact` and a reset mails *each*
matching account its own token. It is the account's only route to password recovery:
without one, `POST /api/auth/password-reset/` can never reach it. `email` is the sole
writable field on `UserSerializer` — `username` is read-only because games and
matches carry a denormalised copy of it in `player1_name`/`player2_name`.

## Endpoints

| Endpoint | View | Returns |
|----------|------|---------|
| `POST /api/auth/register/` | `RegisterView` | `{ user, access, refresh }` (201) |
| `POST /api/auth/login/` | SimpleJWT `TokenObtainPairView` | `{ access, refresh }` |
| `POST /api/auth/refresh/` | SimpleJWT `TokenRefreshView` | `{ access, refresh }` (rotated) |
| `GET /api/auth/me/` | `MeView` (`IsAuthenticated`) | current user + computed stats |
| `PATCH /api/auth/me/` | `MeView` (`IsAuthenticated`) | sets/clears `email` (send `""` to clear) |
| `DELETE /api/auth/me/` | `MeView.destroy` (`IsAuthenticated`) | 204; requires the caller's current password |
| `POST /api/auth/password-reset/` | `PasswordResetRequestView` | flat 200 whether or not the address matches |
| `POST /api/auth/password-reset/confirm/` | `PasswordResetConfirmView` | 200; `{uid, token, new_password}` |

- **Register** ([`views.py`](../../backend/game/views.py)) validates via
  `RegisterSerializer` (username unique, password ≥ 8 chars plus Django's
  `AUTH_PASSWORD_VALIDATORS`, optional `email`), creates the user with `create_user`
  (hashes the password), and **mints a token pair immediately** so the client is
  logged in on signup with no second round-trip.
- **Login / refresh** are the stock SimpleJWT views, wired in
  [`urls.py`](../../backend/game/urls.py). Rotation is on, so each refresh mints a
  new refresh token and blacklists the one it replaced — a refresh token is
  single-use.
- **`/me/`** is the only auth-gated route (`IsAuthenticated`, all three verbs).
  Everything else is `AllowAny` (see the security note below).
- **Password reset** is token-based and stateless: `default_token_generator` hashes
  the current password hash and `last_login` into the token, so writing the new
  password invalidates every token minted against the old one. On success **every
  outstanding refresh token for the account is blacklisted** — a reset usually
  answers a compromise, and SimpleJWT would otherwise keep minting access tokens
  from the attacker's refresh payload without ever consulting the password. Full
  request/response detail, including the anti-enumeration properties, is in
  [api.md](api.md#post-apiauthpassword-reset).

Token lifetimes are set in [`settings.py`](../../backend/backgammon/settings.py):
**access 1 hour, refresh 7 days**. The auth routes also carry scoped DRF throttles —
`login` 10/hour, `register` 5/hour, `refresh` 60/hour, `password_reset` 5/hour,
`password_reset_confirm` 20/hour — all env-overridable and disabled under test.

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
| Login screen | [`pages/LoginPage.jsx`](../../frontend/src/pages/LoginPage.jsx) + `RegisterPage.jsx` | [`app/login.jsx`](../../mobile/app/login.jsx) (login/register/reset modes) |
| Reset request | [`pages/ForgotPasswordPage.jsx`](../../frontend/src/pages/ForgotPasswordPage.jsx) (`/forgot-password`) | the `"reset"` mode of `app/login.jsx` |
| Reset confirm | [`pages/ResetPasswordPage.jsx`](../../frontend/src/pages/ResetPasswordPage.jsx) (`/reset-password/:uid/:token`) | **none** — the emailed link is a web URL and opens in the browser |
| Email settings | [`components/EmailSettings.jsx`](../../frontend/src/components/EmailSettings.jsx) | [`components/EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx) |
| Account deletion | [`components/DeleteAccountPanel.jsx`](../../frontend/src/components/DeleteAccountPanel.jsx) | [`components/DeleteAccountSection.jsx`](../../mobile/src/components/DeleteAccountSection.jsx) |

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
| Backend | [`tests/test_auth.py`](../../backend/game/tests/test_auth.py) | register (dupe/short-password/optional email), login (wrong password → 401), `/me/` gating + stat counts, `PATCH /me/` email set/clear, refresh |
| Backend | [`tests/test_password_reset.py`](../../backend/game/tests/test_password_reset.py) | flat request body on hit and miss, case-insensitive lookup, token single-use, refresh blacklisting, uid/token indistinguishability |
| Backend | [`tests/test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py) | password re-check, refresh blacklisting, lobby purge, seat closure |
| Backend | [`tests/test_seat_security.py`](../../backend/game/tests/test_seat_security.py) | seat/turn enforcement: wrong user → 403, out-of-turn → 403, owner accepted, guest-seat rules (hotseat / anonymous / other accounts) |
| Backend | [`tests/test_cube.py`](../../backend/game/tests/test_cube.py) (`CubeSeatSecurityTest`) | same enforcement on the cube actions: only the current player may offer, non-participants 403, the offerer can't answer their own double |
| Web API | `frontend/src/api/__tests__/authApi.test.js` | token storage, register/login/fetchMe/refresh/logout, `updateEmail`, both password-reset calls, `deleteAccount`, error surfacing, "store nothing on failure" |
| Web client | `frontend/src/api/__tests__/apiClient.test.js` | bearer injection, 401→refresh→retry, no-refresh-token path, refresh-fails-clears-tokens |
| Web UI | `frontend/src/pages/__tests__/LoginPage.test.jsx` | login/register submit → navigate home; server error rendered, no navigation |
| Web UI | `frontend/src/pages/__tests__/{ForgotPasswordPage,ResetPasswordPage}.test.jsx` | the reset request and confirm screens |
| Web UI | `frontend/src/pages/__tests__/ProfilePage.test.jsx` | stats rendering, email settings, account deletion panel |
| Mobile UI | `mobile/src/components/__tests__/{EmailSection,DeleteAccountSection}.test.jsx` | email set/clear, account deletion confirmation |
| Mobile store | `mobile/src/api/__tests__/tokenStore.test.js` | SecureStore get/set/clear; partial `setTokens` keeps refresh |
| Mobile API | `mobile/src/api/__tests__/auth.test.js` | register/login/fetchMe/logout, bearer on `/me/`, error surfacing |
| Mobile client | `mobile/src/api/__tests__/client.test.js` | bearer injection, 401→refresh→retry, no-refresh + refresh-fails paths |

Client tests mock `fetch`; mobile uses the in-memory SecureStore mock in
[`jest.setup.js`](../../mobile/jest.setup.js). Run them with the suite commands in
[CLAUDE.md](../../CLAUDE.md#tests).

## Security note (current limitations)

`AllowAny` remains the default DRF permission (guest play requires it), but the
player actions (`roll_dice` / `confirm_turn`, the cube actions
`offer_double` / `respond_to_double`, and `abandon`) **do enforce seat/turn ownership**
server-side: `_seat_permission_error` in
[`views.py`](../../backend/game/views.py) rejects with **403** any request where the
acting seat is owned by a registered user and the requester isn't that user
(including the opponent acting out of turn), and rejects other logged-in accounts
acting on a guest seat. The acting seat is `current_turn` except for
`respond_to_double`, which checks the offerer's *opponent* (so a player can't
answer their own double), and `abandon`, which checks the surviving seat. See
[overview.md](overview.md#whose-turn-is-it-seat-ownership) for the full policy
table.

The remaining limitation is **guest seats**: a null user FK has no server identity,
so anonymous requests on a guest seat are accepted — an attacker can log out and act
on a guest seat anonymously. Enforcement is exactly as strong as the seat FKs.

## Planned / Not Yet Implemented

- **httpOnly cookie auth.** Tokens live in `localStorage` (web) and SecureStore
  (mobile), not cookies. A `localStorage` access token is readable by any XSS on the
  page; cookie-based sessions are the intended hardening but are not built.
- **A logout endpoint.** `logout()` just clears client storage; no route revokes a
  token on demand. The `token_blacklist` app *is* installed and *is* used — by
  refresh rotation, by account deletion, and by a completed password reset — but an
  already-issued **access** token stays valid until it expires (≤ 1 hour).
- **An authenticated change-password endpoint.** Reset by emailed token exists;
  there is no route for a logged-in user to change a password they still know.
- **Email verification.** An address is accepted as typed — never confirmed — so a
  typo silently costs the account its recovery route. Nothing else keys off it.
- **A mobile reset-confirm screen.** Mobile requests the link; the link itself is a
  web URL and opens in the browser (no `backgammon://` deep-link route for it).
- **Guest seat identity** (see security note): anonymous requests on guest seats
  are unverifiable; a guest token/session concept would close this.
- **Account lockout.** Scoped throttles now cap login/register/refresh/reset
  attempts (rates above), but there is no per-account lockout or backoff, and the
  counters are only as global as the cache backend — `LocMemCache` unless
  `REDIS_URL` is set, i.e. per gunicorn worker in production.
