# Authentication & Accounts

The auth stack **as currently built** — endpoints, token lifecycle, the shared
client refresh-retry, and where it's tested. Intended-but-unbuilt pieces are under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

For how auth relates to seat ownership and online play, see
[overview.md](overview.md); this doc is the auth-focused deep dive.

## Model

There is **no custom user model** — accounts are Django's stock
`django.contrib.auth.models.User`. A user has a `username`, a `password` and a
**required `email`**; everything shown on the profile (wins, losses, gammons, points,
rates) is **computed on read** by `UserSerializer`, never stored. See
[data-model.md](data-model.md).

**`email` became required at registration on 2026-08-03**
([ADR-003](../decisions/adr-003-email-verification.md)) — `required=True,
allow_blank=False` on `RegisterSerializer`, and `PATCH /api/auth/me/` will no
longer blank one either. It was optional for most of this app's life; what
changed is that *guest seats* now carry play-without-an-account, so the
"pick a name and play" argument no longer reaches the registration form, and the
[inactivity forfeit](../decisions/adr-002-inactivity-forfeit.md) can lose a
player a game whose only warning channel is email. **Accounts predating the
requirement are not rewritten and not locked out** — the serializer validates
input, it does not audit the table — so a blank `User.email` is still a state
this code has to handle, and it does.

`email` is deliberately **not** unique-checked (`User.email` carries no unique
constraint, and adding one would turn registration into a "is this address already
registered?" oracle), so every lookup uses `email__iexact` and a reset mails *each*
matching account its own token. It is the account's only route to password recovery.
`email` and `turn_reminder_emails` are the **only two writable fields** on
`UserSerializer` — `username` is read-only because games and
matches carry a denormalised copy of it in `player1_name`/`player2_name`, and
everything else on the payload is a computed stat, including the read-only
`email_verified`. `turn_reminder_emails` is the
turn-reminder opt-out; it does not live on `User` at all but on an optional
[`UserPreferences`](data-model.md#userpreferences) row, and is described with the
endpoint in [api.md](api.md#patch-apiauthme).

**Two optional one-to-one rows hang off `User`**, and they share a convention:
[`UserPreferences`](data-model.md#userpreferences) and `EmailVerification`. Both
are lazily created, and for both **absence means "the default"** — all
preferences on, nothing verified. Neither is a place to put anything that a
missing row would misreport.

## Endpoints

| Endpoint | View | Returns |
|----------|------|---------|
| `POST /api/auth/register/` | `RegisterView` | `{ user, access, refresh }` (201) |
| `POST /api/auth/login/` | SimpleJWT `TokenObtainPairView` | `{ access, refresh }` |
| `POST /api/auth/refresh/` | SimpleJWT `TokenRefreshView` | `{ access, refresh }` (rotated) |
| `GET /api/auth/me/` | `MeView` (`IsAuthenticated`) | current user + computed stats |
| `PATCH /api/auth/me/` | `MeView` (`IsAuthenticated`) | changes `email` (**`""` is a 400**, not a clear); toggles `turn_reminder_emails` |
| `DELETE /api/auth/me/` | `MeView.destroy` (`IsAuthenticated`) | 204; requires the caller's current password |
| `POST /api/auth/password-reset/` | `PasswordResetRequestView` | flat 200 whether or not the address matches |
| `POST /api/auth/password-reset/confirm/` | `PasswordResetConfirmView` | 200; `{uid, token, new_password}` |
| `POST /api/auth/verify-email/confirm/` | `EmailVerificationConfirmView` | **no auth**; 200; `{token}` from the emailed link |
| `POST /api/auth/verify-email/resend/` | `EmailVerificationResendView` | `IsAuthenticated`; no body; 200 sent / 200 already verified / 429 cooling down |

- **Register** ([`views.py`](../../backend/game/views.py)) validates via
  `RegisterSerializer` (username unique, password ≥ 8 chars plus Django's
  `AUTH_PASSWORD_VALIDATORS`, **required non-blank `email`**), creates the user with
  `create_user` (hashes the password), **mails a verification link**
  (`issue_email_verification`, which cannot fail the request), and **mints a token
  pair immediately** so the client is logged in on signup with no second
  round-trip. The account is usable straight away; verification is not a gate on
  anything but reminder mail.
- **Login / refresh** are the stock SimpleJWT views, wired in
  [`urls.py`](../../backend/game/urls.py). Rotation is on, so each refresh mints a
  new refresh token and blacklists the one it replaced — a refresh token is
  single-use.
- **`/me/`** (all three verbs) and **`verify-email/resend/`** are the only
  auth-gated routes (`IsAuthenticated`). Everything else is `AllowAny` (see the
  security note below) — including `verify-email/confirm/`, deliberately: the
  link is followed from a mailbox, possibly on a device that never logged in.
- **Password reset** is token-based and stateless: `default_token_generator` hashes
  the current password hash and `last_login` into the token, so writing the new
  password invalidates every token minted against the old one. On success **every
  outstanding refresh token for the account is blacklisted** — a reset usually
  answers a compromise, and SimpleJWT would otherwise keep minting access tokens
  from the attacker's refresh payload without ever consulting the password. Full
  request/response detail, including the anti-enumeration properties, is in
  [api.md](api.md#post-apiauthpassword-reset).

**Outbound mail: there are three kinds now, and they share one configuration.**
The password-reset link is no longer the only thing this app sends. `manage.py
send_turn_reminders` mails the player on the clock before an inactivity forfeit
becomes claimable ([ADR-002](../decisions/adr-002-inactivity-forfeit.md),
[railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron)),
and registering or changing an address mails a **verification link**
([below](#email-verification)). Consequences for anyone reasoning about auth:

- **The same `EMAIL_*` settings gate all three.** With `EMAIL_HOST` unset they all
  land in Django's console backend; configuring SMTP switches them on at once.
- **`User.email` now has three consumers.** It was purely a recovery address; it
  is also the reminder address and the thing verification proves. The field is
  **required at registration** and still not unique. An older account with no
  address gets none of the three mails, which the code treats as an ordinary
  state rather than an error.
- **Only the reminder requires a *verified* address**
  ([ADR-003](../decisions/adr-003-email-verification.md)). The reset and
  verification mails go to whatever is on file, because each is sent to one
  person who just asked for it; the reminder is the only bulk, scheduled,
  unprompted sender, and that is the one that can burn a sending domain.
- **The reminder is not an auth surface.** Its only link is
  `{FRONTEND_BASE_URL}/game/{id}` (`build_game_url`, built exactly as
  `build_password_reset_url` is) — a plain game URL that authenticates nobody and
  grants nothing a game id does not already grant. Only the reset mail contains a
  credential. Note this makes **`FRONTEND_BASE_URL` load-bearing for both mails**.
- **Only the reminder is refusable, and that asymmetry is deliberate.** A reset
  mail is sent *because the recipient just asked for it*; a reminder is
  unsolicited. So the reminder honours
  `UserPreferences.reminders_enabled(user)` (default **on**, switched at
  `PATCH /api/auth/me/`) and carries a footer naming the setting, while the reset
  mail has no opt-out and should not grow one — suppressing it would silently
  disable account recovery.
- **The reminder is dormant** until the owner schedules a cron, so today the
  reset mail remains the only thing this app actually sends. It also refuses to
  send at all while `FRONTEND_BASE_URL` or `DEFAULT_FROM_EMAIL` are still at their
  dev defaults; the reset mail carries no such guard, and would happily ship a
  `localhost` link.

Token lifetimes are set in [`settings.py`](../../backend/backgammon/settings.py):
**access 1 hour, refresh 7 days**. The auth routes also carry scoped DRF throttles —
`login` 10/hour, `register` 5/hour, `refresh` 60/hour, `password_reset` 5/hour,
`password_reset_confirm` 20/hour, `email_verify_resend` 5/hour,
`email_verify_confirm` 20/hour — all env-overridable and disabled under test.

## Email verification

Built 2026-08-03 ([ADR-003](../decisions/adr-003-email-verification.md)). Read
the ADR for *why*; this section is the flow. Endpoint detail is in
[api.md](api.md#post-apiauthverify-emailconfirm).

**What it gates: turn-reminder mail, and nothing else.** There is exactly one
consumer, `EmailVerification.is_verified(user)` inside `send_turn_reminders`.
Login, play, `/me/`, password reset and account deletion are all untouched by it,
and an unverified account is a fully working account. The reason is
deliverability, not security: the reminder cron is the only bulk, scheduled,
unprompted sender in the app, and mailing unproven addresses in volume costs the
sending domain its reputation — which lands the *legitimate* reminders in spam.

### The flow

1. **A link is mailed** by `issue_email_verification`
   ([`views.py`](../../backend/game/views.py)) from two places: `RegisterView.create`,
   and `MeView.perform_update` when the address actually changed (compared
   case-folded against the pre-`save()` value, so re-typing the same address in a
   different case mails nothing).
2. **The link is `{FRONTEND_BASE_URL}/verify-email/{token}`**
   (`build_email_verification_url`), built exactly as `build_password_reset_url`
   is. The token is `django.core.signing.dumps({"uid", "email"})` under
   `EMAIL_VERIFICATION_SALT` — **stateless, with no token table** — and expires
   via `max_age` against `EMAIL_VERIFICATION_TIMEOUT_HOURS` (default **72**).
3. **The user follows it** and the page POSTs the token to
   `/api/auth/verify-email/confirm/`, which is **unauthenticated** — the mail may
   be read on a device that never logged in, and the token proves the only thing
   that matters. Confirming is idempotent and grants no session.
4. **`EmailVerification` records which address was proven** (`verified_email`,
   `verified_at`), and `email_verified` on `/api/auth/me/` reports the comparison
   of that against the live `User.email`.
5. **A lost mail is recovered** with `POST /api/auth/verify-email/resend/`
   (authenticated, no body), capped by both the `email_verify_resend` throttle
   and `EmailVerification.last_sent_at` (default 60s cool-down — the row-level
   check is what actually holds when `CACHES` is per-worker `LocMemCache`).

### Three properties worth not re-deriving

- **The proven *address* is stored, not a boolean.** `is_verified` compares it to
  `User.email` on every read, so **changing the address self-invalidates
  verification** with no signal, no hook and nothing to remember to call. A bare
  flag would survive a `PATCH` and the next cron tick would mail an unproven
  mailbox.
- **The address is inside the token's signature.** A link mailed to `a@x.com`
  cannot confirm an account that has since moved to `b@y.com`; the token verifies
  but is refused.
- **Not `default_token_generator`.** Password reset uses it *because* it hashes
  the password hash in and is therefore single-use. That property is wrong here —
  a password change should not silently kill a verification link in flight — so
  verification uses plain signing instead.

### Where a mobile user ends up

**The emailed link is still an ordinary `https://` web URL** — `FRONTEND_BASE_URL`
is a single setting pointing at the web client, and that is deliberate rather
than a limitation (see below). What has changed is that the app can now handle
those paths natively:

| Mechanism | Status |
|---|---|
| In-app routes at [`app/verify-email/[token].jsx`](../../mobile/app/verify-email/[token].jsx) and [`app/reset-password/[uid]/[token].jsx`](../../mobile/app/reset-password/[uid]/[token].jsx) | **live** |
| `backgammon://` custom scheme (expo-router maps the path automatically) | **live** — but mail clients will not follow it |
| Web "open in the app" button, shown to mobile browsers ([`appLink.js`](../../frontend/src/utils/appLink.js)) | **live** — the bridge that works before a domain exists |
| Universal links / App Links, which make the *emailed* link open the app | **inert** — config committed, three owner-supplied values missing |

The design keeps `FRONTEND_BASE_URL` as the one origin for every outbound link
**on purpose**: universal links intercept that same URL and fall back to the
browser when the app is not installed, so no second setting and no second link
shape is ever needed. Mailing a `backgammon://` link instead would be the obvious
alternative and is the wrong one — mail clients strip custom schemes, and it
would only work for people who already have the app. See
[going-live 1.8](../operations/going-live.md) for the three placeholders and the
silent-failure traps.

One asymmetry worth knowing: **verification is idempotent, password reset is
not.** Django's `default_token_generator` hashes the current password hash into
the reset token, so it stops verifying the instant the password changes — which
is why the web page retracts its "open in the app" affordance once the reset
succeeds, and offers it only *before* submission. The verification page can offer
it either side.

Mobile also implements the *resend* half, in
[`EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx); the web client
owns the confirm screen at `/verify-email/:token`
([`VerifyEmailPage.jsx`](../../frontend/src/pages/VerifyEmailPage.jsx)). Tracked
alongside the identical reset-link gap in
[going-live.md 2.3](../operations/going-live.md#23-polish-and-hygiene).

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
| Reset confirm | [`pages/ResetPasswordPage.jsx`](../../frontend/src/pages/ResetPasswordPage.jsx) (`/reset-password/:uid/:token`) | [`app/reset-password/[uid]/[token].jsx`](../../mobile/app/reset-password/[uid]/[token].jsx) |
| Verify confirm | [`pages/VerifyEmailPage.jsx`](../../frontend/src/pages/VerifyEmailPage.jsx) (`/verify-email/:token`) | [`app/verify-email/[token].jsx`](../../mobile/app/verify-email/[token].jsx) |
| Verify resend | `EmailSettings.jsx` (`resendEmailVerification`) | `EmailSection.jsx` (same call) |
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
| Backend | [`tests/test_auth.py`](../../backend/game/tests/test_auth.py) | register (dupe username, short password, initial stat counts), login (wrong password → 401), `/me/` gating + stat counts, `PATCH /me/` email change, refresh. Its registration helper now always supplies an address — **note no test asserts that a missing or blank one is a 400**, though both are ([api.md](api.md#post-apiauthregister)) |
| Backend | [`tests/test_password_reset.py`](../../backend/game/tests/test_password_reset.py) | flat request body on hit and miss, case-insensitive lookup, token single-use, refresh blacklisting, uid/token indistinguishability |
| Backend | [`tests/test_email_verification.py`](../../backend/game/tests/test_email_verification.py) | registration mails exactly one link and starts unverified; confirm is idempotent, session-free and disturbs no password; bad/tampered/expired/wrong-salt/deleted-account tokens; change-of-address un-verifies, re-mails, and refuses the old token; resend cool-down (429), already-verified 200, anonymous 401; and the reminder gate — an unverified seat is skipped **without burning the turn's reminder** |
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
- **Verification as a *gate* on anything but reminder mail.** Verification itself
  now exists ([above](#email-verification)), but by design it blocks nothing else:
  an unverified address still receives password-reset links and still identifies
  the account for recovery, so a typo still costs recovery until the user fixes
  it. There is no lockout, no grace period, and no plan for one
  ([ADR-003](../decisions/adr-003-email-verification.md)).
- **A backfill or audit of pre-existing accounts.** Migration
  `0008_emailverification` adds the table and writes no rows. Accounts created
  before email was required keep a blank address; nothing sweeps them, prompts
  them on login, or refuses them service.
- **Universal links / App Links.** The in-app routes and the `backgammon://`
  scheme both exist, and the web pages offer an "open in the app" hand-off — but
  an *emailed* link still opens the browser, because mail clients will not follow
  a custom scheme. The config is committed and inert, pending a domain, an Apple
  Team ID and an Android signing fingerprint. See
  [going-live 1.8](../operations/going-live.md).
- **Guest seat identity** (see security note): anonymous requests on guest seats
  are unverifiable; a guest token/session concept would close this.
- **Account lockout.** Scoped throttles now cap login/register/refresh/reset
  attempts (rates above), but there is no per-account lockout or backoff, and the
  counters are only as global as the cache backend — `LocMemCache` unless
  `REDIS_URL` is set, i.e. per gunicorn worker in production.
