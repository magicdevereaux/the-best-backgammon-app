# HTTP API Reference

Every endpoint the backend actually exposes, as wired in
[`backgammon/urls.py`](../../backend/backgammon/urls.py) →
[`game/urls.py`](../../backend/game/urls.py). Request/response shapes come from
[`views.py`](../../backend/game/views.py) and
[`serializers.py`](../../backend/game/serializers.py); status codes are the ones
asserted in [`backend/game/tests/`](../../backend/game/tests/).

Anything intended-but-unbuilt is under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

Related: [auth.md](auth.md) (token lifecycle), [data-model.md](data-model.md)
(fields), [game-logic.md](game-logic.md) (the rules the validators enforce).

## Conventions

- **Base path:** `/api/`. All routes end with a trailing slash.
- **Content type:** JSON in, JSON out.
- **Auth:** JWT bearer — `Authorization: Bearer <access>`. Configured as the
  only authentication class in
  [`settings.py`](../../backend/backgammon/settings.py)
  (`rest_framework_simplejwt.authentication.JWTAuthentication`).
- **Default permission is `AllowAny`.** Exactly **two** routes carry
  `IsAuthenticated`: `/api/auth/me/` (`MeView` — `GET`, `PATCH` and `DELETE`) and
  `POST /api/auth/verify-email/resend/` (`EmailVerificationResendView`, which can
  only ever mail the caller's own address). Everything else accepts anonymous
  requests — guest play depends on it. Note the *confirm* half of email
  verification is deliberately anonymous: the link is followed from a mailbox. Authorization for gameplay is per-action seat
  enforcement, not a permission class (see [Seat enforcement](#seat-enforcement)).
- **Token lifetimes** (`SIMPLE_JWT`): access **1 hour**, refresh **7 days**.
  `ROTATE_REFRESH_TOKENS` and `BLACKLIST_AFTER_ROTATION` are both on, backed by
  the `rest_framework_simplejwt.token_blacklist` app.
- **CORS** (`django-cors-headers`): `CORS_ALLOWED_ORIGINS` defaults to
  `["http://localhost:3000"]` — the CRA dev server only — and is overridable by
  env var. Credentials are not enabled. Native clients (Expo)
  send no `Origin` and are unaffected; a browser served from a LAN IP would be
  blocked until that origin is added.
- **Pagination without an envelope.** `BareListPagination` caps every list
  response at **100** items (`?page=N`, `?page_size=` up to **200**) but returns
  a **bare JSON array**, not DRF's `{count, next, previous, results}` — both
  clients consume these endpoints as arrays.
- **Throttling is on.** DRF's `anon`/`user` rates apply globally
  (`120/min` / `240/min` by default), plus scoped rates on the auth views:
  `login` `10/hour`, `register` `5/hour`, `refresh` `60/hour`,
  `password_reset` `5/hour`, `password_reset_confirm` `20/hour`,
  `email_verify_resend` `5/hour`, `email_verify_confirm` `20/hour`. All rates are
  env-overridable and are **disabled while running the test suite**. Over the
  limit → **429**.
- **Ordering:** both `Game` and `Match` use `Meta.ordering = ["-created_at", "-id"]`,
  so lists are newest-first.
- **Error bodies:** custom actions return `{"error": "<message>"}`. DRF's own
  machinery returns `{"detail": ...}` (404/401) or a field-keyed dict
  (`{"username": ["Username already taken."]}`) for serializer validation.
- The router is a `DefaultRouter`, so `GET /api/` returns a browsable index of
  `games` and `matches`.

## Endpoint index

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/register/` | none |
| `POST` | `/api/auth/login/` | none |
| `POST` | `/api/auth/refresh/` | none (refresh token in body) |
| `POST` | `/api/auth/password-reset/` | none |
| `POST` | `/api/auth/password-reset/confirm/` | none (uid + token in body) |
| `POST` | `/api/auth/verify-email/confirm/` | none (signed token in body) |
| `POST` | `/api/auth/verify-email/resend/` | **required** (no body) |
| `GET` | `/api/auth/me/` | **required** |
| `PATCH` | `/api/auth/me/` | **required** |
| `DELETE` | `/api/auth/me/` | **required** (+ password in body) |
| `GET` | `/api/games/` | optional — **scoped to the requester** |
| `POST` | `/api/games/` | optional |
| `GET` | `/api/games/{id}/` | optional |
| `PUT`/`PATCH`/`DELETE` | `/api/games/{id}/` | **not routed** — 405 |
| `POST` | `/api/games/{id}/join/` | optional |
| `POST` | `/api/games/{id}/roll_dice/` | seat-enforced |
| `POST` | `/api/games/{id}/confirm_turn/` | seat-enforced |
| `POST` | `/api/games/{id}/offer_double/` | seat-enforced |
| `POST` | `/api/games/{id}/respond_to_double/` | seat-enforced (responder seat) |
| `POST` | `/api/games/{id}/abandon/` | seat-enforced (surviving seat) |
| `POST` | `/api/games/{id}/claim_timeout/` | seat-enforced (claimant seat) |
| `GET` | `/api/matches/` | optional — **scoped to the requester** |
| `POST` | `/api/matches/` | optional |
| `GET` | `/api/matches/{id}/` | optional |
| `PUT`/`PATCH`/`DELETE` | `/api/matches/{id}/` | **not routed** — 405 |
| `POST` | `/api/matches/{id}/next_game/` | participant-enforced |
| `POST` | `/api/matches/{id}/join/` | optional |

One route sits outside `/api/`: `GET /healthz/` (wired in
[`backgammon/urls.py`](../../backend/backgammon/urls.py) →
[`health.py`](../../backend/backgammon/health.py)), no auth, for platform health
checks. **200** `{"status": "ok", "database": "ok"}`, or **503** with
`"status": "error"` when the DB is unreachable.

---

## Auth

### `POST /api/auth/register/`

`RegisterView` + `RegisterSerializer`. Creates the account **and mints a token
pair immediately** — no second login round-trip.

| Field | Type | Required |
|-------|------|----------|
| `username` | string, ≤ 150 chars, unique | yes |
| `password` | string, ≥ 8 chars (write-only) | yes |
| `email` | string, valid address, **not blank** | **yes** |

**`email` is required** ([ADR-003](../decisions/adr-003-email-verification.md)) —
`required=True, allow_blank=False`, so both an omitted field and `""` are 400s.
It was optional until 2026-08-03; the reasoning for the change is that *guest
seats*, not a permissive registration form, are what carry play-without-an-account,
and that the [inactivity forfeit](../decisions/adr-002-inactivity-forfeit.md) can
now lose a player a game whose only warning channel is email.

It is still **not** unique-checked — `User.email` has no unique constraint, and
adding one would turn registration into an "is this address already registered?"
oracle. Only the domain half is normalised (`normalise_email` →
`BaseUserManager.normalize_email`, so `A@Example.COM` is stored `A@example.com`),
and all lookups elsewhere use `email__iexact`.

**Accounts created before the requirement are not rewritten and not locked out.**
The serializer validates input; it does not audit the table. An older account
with a blank address keeps working, and `email_verified` simply reads `false`.

**A verification mail is sent here**, by `issue_email_verification` after
`serializer.save()`. It cannot fail the request — `send_email_verification`
swallows and logs mail-backend errors — and it does **not** gate the response:
the token pair is minted and the account is immediately usable unverified. The
only thing verification gates anywhere in the app is turn-reminder mail.

**201** → `{ "user": <UserSerializer>, "refresh": "<jwt>", "access": "<jwt>" }`,
with `user.email_verified` **`false`** (a link has been mailed, not followed).

| Status | Trigger |
|--------|---------|
| 400 | `{"email": ["This field is required."]}` — omitted |
| 400 | `{"email": ["This field may not be blank."]}` — sent as `""` |
| 400 | `{"email": ["Enter a valid email address."]}` — malformed |
| 400 | `{"username": ["Username already taken."]}` |
| 400 | `{"password": [...]}` — under 8 chars, or any failure from Django's `AUTH_PASSWORD_VALIDATORS`, which `RegisterSerializer.validate` runs explicitly (`create_user` does not) and re-raises keyed on the field |

### `POST /api/auth/login/`

Stock SimpleJWT `TokenObtainPairView`. Body `{ "username", "password" }`.

**200** → `{ "access", "refresh" }` · **401** on bad credentials.

### `POST /api/auth/refresh/`

Stock SimpleJWT `TokenRefreshView`. Body `{ "refresh" }`.

**200** → `{ "access", "refresh" }` · **401** if the refresh token is
invalid/expired or has been blacklisted. Rotation is on: each call mints a
**new** refresh token and blacklists the one it replaced, so a refresh token is
single-use.

### `GET /api/auth/me/`

`MeView`, `IsAuthenticated`. Returns `UserSerializer` for the bearer's user.

**200** → `id`, `username`, `email` (`""` only on an account predating the
registration requirement), `email_verified` (**bool**, see below),
`turn_reminder_emails` (**bool**, see below), plus stats **computed
on read** (never stored): `wins`, `losses`, `total_games`, `total_gammons`,
`total_backgammons`, `total_points_won`, `total_points_lost`, `win_percentage`,
`gammon_rate`. Only `status="finished"` games count, across both seats —
**except abandoned ones, which are excluded from every stat.** An abandoned game
finished without being played to a result, so counting it would reach `losses`
through `total − wins` and charge the survivor with a defeat nobody inflicted.
Excluding it from `total_games` too keeps `wins + losses == total_games`, which
`win_percentage` assumes. A **timeout** win is *not* excluded — it has a real
`winner`, so the same `total − wins` derivation scores it correctly on both
sides, and no stats code changed to support it. It never counts as a
gammon/backgammon, since those filter on `win_type`.

#### `email_verified` — derived on read, never asserted

Whether the address **currently** on the account has been proven, via
`POST /api/auth/verify-email/confirm/`
([ADR-003](../decisions/adr-003-email-verification.md)). **Read-only**: proof of
an address is something you do to a mailbox, not something a `PATCH` body can
claim, and the field is a `SerializerMethodField` over
`EmailVerification.is_verified(user)`.

It is `false` for an account with no `EmailVerification` row (absence means
unverified — the same "optional row" convention as `UserPreferences`), and
**`false` again the moment `PATCH` moves the address**, with nothing having to
clear a flag: the model stores *which* address was proven and compares it to the
live one on every read (case-folded), so an email change self-invalidates. See
[data-model.md](data-model.md) and the ADR.

**What it gates: only turn-reminder mail.** An unverified account logs in,
plays, resets its password, edits its profile and deletes itself exactly like a
verified one. Both clients use this field purely to decide whether to show a
"confirm your address" prompt.

#### `turn_reminder_emails` — always a real boolean

The opt-out for the turn-reminder mail that `manage.py send_turn_reminders`
sends ([railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron)).
It is **`true` by default**, and it is **always a real `true`/`false`** on read —
never `null`, never absent — including for the overwhelmingly common case of an
account with no `UserPreferences` row at all.

That last guarantee is not free, and is the point of the field's implementation.
The row is created lazily on the first `PATCH` that changes something, so a
freshly registered account has none; the serializer declares the field with
`source="preferences.turn_reminder_emails"`, and a dotted source with no related
row serialises as `None`. `UserSerializer.to_representation` therefore overrides
it with `UserPreferences.reminders_enabled(user)` — the same helper the command
consults — instead of relying on DRF's `default=`, which applies only to
deserialisation. Without that override every never-configured account would
report "off" while still being mailed, i.e. a consent control misreporting
consent. See
[data-model.md](data-model.md#userpreferences).

**401** when the header is missing or the token is invalid/expired.

### `PATCH /api/auth/me/`

`MeView` + `UserSerializer`, `IsAuthenticated`. Changes the bearer's own email
address, and toggles the turn-reminder opt-out. Addresses change, and accounts
created before email was required at registration have none at all — without
this, password recovery and turn reminders would be permanently out of reach for
exactly the users who need them.

| Field | Type | Required |
|-------|------|----------|
| `email` | string, valid address, **not blank** | no — but `""` is a **400**, not a clear |
| `turn_reminder_emails` | bool | no — `false` stops turn-reminder mail |

**`email` can no longer be cleared** ([ADR-003](../decisions/adr-003-email-verification.md)).
`allow_blank=False`, so `{"email": ""}` — which both clients used to send for an
empty field — is rejected. Registration requires an address, so a `PATCH` that
blanks one would let an account walk into a state the front door forbids, and it
is the wrong tool for either thing a user actually wants: "stop mailing me" is
`turn_reminder_emails`, and "remove my address from your system" is
[`DELETE`](#delete-apiauthme) on this same endpoint, which removes all of it.
`required=False` still holds, so a `PATCH` that only toggles reminders need not
resend the address.

**Changing the address un-verifies it and re-mails a confirmation link.**
`email_verified` in the response is already `false` — nothing clears a flag; the
stored proven address no longer matches ([above](#email_verified--derived-on-read-never-asserted)).
`MeView.perform_update` compares the pre-`save()` value case-folded, so
re-typing your own address in different case is **not** treated as a change and
sends no mail. A genuine change calls `issue_email_verification`, which is capped
by the per-account cool-down (`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`,
default 60s) rather than by a throttle scope on this view — a scope here would
also throttle `GET`, which both clients call routinely.

**`email` and `turn_reminder_emails` are the only writable fields on
`UserSerializer`.** `username` is in
`read_only_fields` and a PATCH naming it is silently ignored (**200**, username
unchanged): games and matches carry a *denormalised copy* of the username in
`player1_name`/`player2_name`, so rewriting the profile would put it out of step
with every historical scoresheet. Everything else on the payload is a computed
stat and read-only by construction.

`turn_reminder_emails` does not live on `User`, so `UserSerializer.update` lifts
it out of `validated_data` before the base class sees it
(`ModelSerializer.update` refuses dotted sources outright) and writes it through
`UserPreferences.for_user()`, which **creates the row on first use**. Sending
`{"turn_reminder_emails": false}` on an account that has never had a preferences
row is therefore a normal, supported first write, not an error.

**200** → the full `UserSerializer` payload (same shape as `GET`).

| Status | Trigger |
|--------|---------|
| 400 | `{"email": ["Enter a valid email address."]}` — malformed address |
| 400 | `{"email": ["This field may not be blank."]}` — `""`; use `turn_reminder_emails` or `DELETE` instead |
| 400 | `{"turn_reminder_emails": ["Must be a valid boolean."]}` — non-boolean value |
| 401 | missing/invalid bearer token |

`PUT` is routed too (`RetrieveUpdateDestroyAPIView`) and is **not** quite
equivalent any more: DRF skips declared defaults on `PATCH`, so a partial update
omitting `turn_reminder_emails` leaves the stored preference alone, while a `PUT`
omitting it applies the serializer's `default=True` and **restores the default** —
which is the right reading of a full replace, but is a real difference. Both
clients use `PATCH`.

### `DELETE /api/auth/me/`

`MeView.destroy` + `AccountDeleteSerializer`, `IsAuthenticated`. Permanently
deletes **the bearer's own** account — `get_object` returns `request.user`, so
the endpoint is structurally incapable of naming someone else's account (extra
`username`/`id` keys in the body are ignored).

| Field | Type | Required |
|-------|------|----------|
| `password` | string (write-only) | yes — the caller's *current* password |

The password re-check is deliberate: a bearer token proves only that a session is
open, not that the person is present. In order, `destroy` then blacklists every
outstanding refresh token for the user, deletes their **unstarted** lobby entries
(`waiting` games, never-joined matches), flags every remaining seat they hold as
**closed** (`player*_deleted`), and finally calls `user.delete()`.

Everything else survives: user FKs are `on_delete=SET_NULL`, so each seat is
*anonymised* — names, boards, winners, scores and match history stay intact and
the opponent's stats are unchanged. See
[data-model.md](data-model.md#closed-seats-player_deleted) for what a closed seat
means and why such a game deadlocks rather than forfeiting.

**204** → no body. The account is gone; access tokens 401 immediately (the user
row no longer resolves) and refresh tokens 401 as blacklisted.

| Status | Trigger |
|--------|---------|
| 400 | `{"password": ["Password is incorrect."]}` — wrong password; nothing is deleted or blacklisted |
| 400 | `{"password": ["This field is required."]}` — password omitted |
| 401 | missing/invalid bearer token |

Covered by
[`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py).

### `POST /api/auth/password-reset/`

`PasswordResetRequestView` + `PasswordResetRequestSerializer`. Unauthenticated.
Mails a reset link to every **active** account holding the address
(`email__iexact`, so case-insensitive; `User.email` is not unique, and each
matching account gets its own mail with its own token).

| Field | Type | Required |
|-------|------|----------|
| `email` | string, valid address | yes |

**200** → `{"detail": "If an account with that email address exists, a password
reset link has been sent to it."}`

**The response is byte-identical for a hit and a miss — deliberately.** This is
an *anti-enumeration* measure: a response that varied would turn an
unauthenticated endpoint into a membership oracle (feed it an address list, learn
who has an account). For the same reason `send_password_reset_email` swallows and
logs SMTP failures rather than 500-ing — a dead mail host must not become the
oracle the flat body prevents. The `password_reset` throttle (**5/hour**) caps
probing by timing instead.

**400** — `{"email": [...]}` for a missing or malformed address. An *empty*
address is rejected by `EmailField` before any lookup, which matters: it would
otherwise match every account that never set one.

The emailed link is `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`
(`build_password_reset_url`). `FRONTEND_BASE_URL` is configuration — the server
cannot infer the client's origin (web is a separate origin, mobile is a deep
link) — and defaults to `http://localhost:3000`. With `EMAIL_HOST` unset Django's
**console** backend prints the mail to stdout, so the whole flow works in dev
with no `.env` and no mail provider.

**There are three kinds of outbound mail now**, all through the same `EMAIL_*`
configuration: this reset link, the
[verification link](#post-apiauthverify-emailconfirm), and the turn reminder
`manage.py send_turn_reminders` sends
([railway-deploy.md step 8](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron)).
Only the reset carries a credential. The reminder is the only one that is
**unsolicited** — the other two are sent because the recipient just asked, or
just registered — which is why it alone has an opt-out
(`turn_reminder_emails`, [above](#turn_reminder_emails--always-a-real-boolean),
named in a footer on every message) and why it alone requires a **verified**
address ([ADR-003](../decisions/adr-003-email-verification.md)). It is still
dormant until a cron schedules it.

Django's HTML `PasswordResetView` is deliberately not used: this project has no
session login, no templates and no server-rendered pages, so the HTML flow would
be a second, unreachable auth surface.

### `POST /api/auth/password-reset/confirm/`

`PasswordResetConfirmView` + `PasswordResetConfirmSerializer`. Unauthenticated —
the token *is* the credential.

| Field | Type | Required |
|-------|------|----------|
| `uid` | string — base64url-encoded user pk (from the link) | yes |
| `token` | string — from Django's `default_token_generator` (from the link) | yes |
| `new_password` | string, ≥ 8 chars (write-only) | yes |

**200** → `{"detail": "Your password has been reset. You can now log in."}`

**Every outstanding refresh token for the account is blacklisted on success.** A
reset usually answers a compromise, and SimpleJWT mints access tokens straight
from a refresh payload without consulting the password — without this the
attacker's session would survive the act meant to end it. The legitimate user
logs in again with the new password.

Tokens are **single-use with no server-side storage**: `default_token_generator`
hashes the current password hash and `last_login` into the token, so writing the
new password invalidates every token minted against the old one. Nothing needs
expiring by hand.

| Status | Trigger |
|--------|---------|
| 400 | `{"token": ["This password reset link is invalid or has expired."]}` — bad/garbage uid, tampered token, uid+token from different users, an expired token, or a token already used |
| 400 | `{"new_password": [...]}` — under 8 chars, or any `AUTH_PASSWORD_VALIDATORS` failure (too common, all-numeric, too similar to the username) |

A bad uid and a bad token are **indistinguishable** in the error response —
either means "this link is no good", and splitting them would let a caller probe
which user ids exist. The link is also checked **before** the password, so a
caller holding no valid token gets no free password-policy feedback; nothing is
written and no session is blacklisted on a failed attempt.

Both endpoints are covered by
[`test_password_reset.py`](../../backend/game/tests/test_password_reset.py).

**Client UI.** Both clients now drive the request half, and the web client owns the
confirm half — which is why `FRONTEND_BASE_URL` points at the web origin from both:

| | Web | Mobile |
|---|---|---|
| Ask for a link | `/forgot-password` ([`ForgotPasswordPage.jsx`](../../frontend/src/pages/ForgotPasswordPage.jsx)), linked from the login page | `app/login.jsx`'s third mode (`"reset"`), reached from the sign-in screen |
| Follow the link | `/reset-password/:uid/:token` ([`ResetPasswordPage.jsx`](../../frontend/src/pages/ResetPasswordPage.jsx)) — the exact shape `build_password_reset_url` emits | none; the emailed link opens in the browser, and the screen says so |
| Set the address | **required** `email` field on register, editable later on the profile ([`EmailSettings.jsx`](../../frontend/src/components/EmailSettings.jsx) / [`EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx) via `PATCH /api/auth/me/`) | same |

Both render the server's flat "if an account with that email exists…" reply verbatim
and never branch on hit-vs-miss — there is no such distinction to render.

### `POST /api/auth/verify-email/confirm/`

`EmailVerificationConfirmView` + `EmailVerificationConfirmSerializer`.
**Unauthenticated** — the link is followed from a mail client, possibly on a
device that never logged in, and the token already proves the only thing this
endpoint cares about. Marks the account's *current* address proven
([ADR-003](../decisions/adr-003-email-verification.md)).

| Field | Type | Required |
|-------|------|----------|
| `token` | string — the signed token from the emailed link | yes |

**200** → `{"detail": "Your email address is confirmed.", "email": "<address>",
"email_verified": true}`

**Idempotent.** Following the same link twice is completely ordinary — mail
clients prefetch, people double-click — so the second call is another **200**,
not an error. Telling a user their verification failed at the exact moment it had
already worked would be worse than useless.

**The token is signed, not stored.** `django.core.signing.dumps` over
`{"uid", "email"}` with `settings.EMAIL_VERIFICATION_SALT`, expiring via
`loads(max_age=...)` against `EMAIL_VERIFICATION_TIMEOUT_HOURS` (**default 72**).
There is no token table to write, expire or clean up. It deliberately does **not**
use password reset's `default_token_generator`: that generator hashes the user's
password hash into the token to get single-use semantics, which is right for a
token that changes a credential and wrong for a pending verification link that a
password change should not silently kill.

**The address is inside the signature.** Request a link for `a@x.com`, `PATCH`
the account to `b@y.com`, then follow the old link: the token verifies (it is
genuinely ours and unexpired) but names an address the account no longer holds,
so it is refused rather than marking `b@y.com` proven on the strength of mail
sent to `a@x.com`.

| Status | Trigger |
|--------|---------|
| 400 | `{"token": ["This verification link is invalid or has expired."]}` — garbage, tampered, expired, signed for a since-deleted account, or naming an address the account no longer holds |
| 400 | `{"token": ["This field is required."]}` — token omitted |
| 429 | over the `email_verify_confirm` scope (**20/hour**) |

**Expired, forged and wrong-account are one flat message, deliberately.** They
are all "this link is no good, get another one" to the person reading it, and
splitting them tells a prober which of their guesses was structurally valid —
the same reasoning as the reset confirm
([above](#post-apiauthpassword-resetconfirm)).

**Nothing is blacklisted here**, unlike the reset confirm: no credential changed,
so there is no session to invalidate. The response carries no tokens and grants
no session — a caller who was logged out stays logged out.

The emailed link is `{FRONTEND_BASE_URL}/verify-email/{token}`
(`build_email_verification_url`), built from the same setting and in the same
shape as `build_password_reset_url`. **It points at the web client**, so a mobile
user finishes verification in a browser
([auth.md](auth.md#email-verification)).

### `POST /api/auth/verify-email/resend/`

`EmailVerificationResendView` (a plain `APIView` — there is no request body to
deserialise), **`IsAuthenticated`**. Sends another confirmation link to the
caller's own address. No body.

**Authentication is what makes this endpoint simple.** It can only ever mail the
address on the caller's own account, so unlike
[`password-reset`](#post-apiauthpassword-reset) it has no enumeration problem and
no third party to protect — hence a truthful, branching response rather than a
flat one.

| Status | Body | Trigger |
|--------|------|---------|
| 200 | `{"detail": "Confirmation email sent.", "email_verified": false}` | a mail was handed to the backend |
| 200 | `{"detail": "Your email address is already confirmed.", "email_verified": true}` | already verified — **not** an error (see below) |
| 400 | `{"detail": "Add an email address to your account first."}` | the account has no address (only possible on an account predating the registration requirement) |
| 401 | `{"detail": "Authentication credentials were not provided."}` | missing/invalid bearer token |
| 429 | `{"detail": "A confirmation email was just sent. Check your inbox and spam folder, then try again in a minute."}` | inside the per-account cool-down |
| 429 | DRF's own throttle body | over the `email_verify_resend` scope (**5/hour**) |

**An already-verified account gets a 200, not a 4xx.** A user who clicks Resend
after the link already worked in another tab has done nothing wrong, and an error
there would suggest their verified account is not verified.

**Two independent limits, and both 429.** The `email_verify_resend` scope
(5/hour) and `EmailVerification.last_sent_at` (**default 60s**, from
`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`). The row-level cool-down is not
redundant: throttle counters live in `CACHES`, which is `LocMemCache` **per
gunicorn worker** unless `REDIS_URL` is set, so on the deployment as configured
today the scope is not actually a global limit. Note the two 429s have different
bodies — the cool-down's is the app's own message, the throttle's is DRF's.

**`last_sent_at` is stamped before the send, and stays stamped on failure.**
`issue_email_verification` claims first and mails second, the same ordering
`send_turn_reminders` uses: a provider can accept a message and *then* error, so
treating a failure as "nothing was sent" would turn a retry into a way to flood
an inbox. Trade-off, deliberately: at most one lost mail, never a duplicate.

---

## Games

### The `Game` payload

`GameSerializer` is `fields = "__all__"` over the `Game` model plus five computed
fields (`viewer_seat`, `viewer_is_participant`, `turn_waiting_seat`,
`turn_deadline`, `server_now`). Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | |
| `match` | int \| null | read-only; set only by the match flow |
| `player1_user` / `player2_user` | int \| null | read-only; null = guest seat |
| `player1_name` / `player2_name` | string | the only writable fields |
| `player1_deleted` / `player2_deleted` | bool | read-only; `true` = **closed seat** (its registered owner deleted their account) |
| `board_state` | object | `{ "points": int[24], "bar": {p1,p2}, "off": {p1,p2} }` |
| `current_turn` | `"p1"` \| `"p2"` | read-only |
| `dice_values` | int[] | `[]` = not rolled; doubles are 4 identical values |
| `status` | `"waiting"` \| `"active"` \| `"finished"` | read-only |
| `winner` | `"p1"` \| `"p2"` \| null | read-only |
| `win_type` | `"normal"`/`"gammon"`/`"backgammon"`/`"drop"`/`"abandoned"`/`"timeout"` \| null | read-only |
| `points_value` | int \| null | `win_points(win_type) × cube_value`, the pre-double cube value on a drop, `1 × cube_value` on a timeout, or `0` when abandoned |
| `cube_value` | int | 1…64, read-only |
| `cube_owner` | `"p1"`/`"p2"`/null | seat, not a user FK; null = centered |
| `double_offered_by` | `"p1"`/`"p2"`/null | a pending, unanswered offer |
| `crawford_game` | bool | cube disabled for this game |
| `turn_started_at` | ISO datetime \| null | read-only; when the **waiting seat** came on the clock. Null = no clock running |
| `created_at` / `updated_at` | ISO datetime | read-only |
| `viewer_seat` | `"p1"`/`"p2"`/`"p1p2"`/null | computed per request |
| `viewer_is_participant` | bool | `viewer_seat is not None` |
| `turn_waiting_seat` | `"p1"`/`"p2"`/null | computed; the seat the game is waiting on, or null unless `status="active"` |
| `turn_deadline` | ISO datetime \| null | computed; when [`claim_timeout`](#post-apigamesidclaim_timeout) becomes available. **Null whenever a claim is impossible in principle** |
| `server_now` | ISO datetime | computed; the instant this response was serialized. **Always present, never null** — see [`server_now`](#server_now--the-clients-clock-is-not-trusted) |

Everything except `player1_name`/`player2_name` is in `read_only_fields`, so a
write request can only ever set those two. `player1_deleted`/`player2_deleted`
are exposed so a client can show "this player deleted their account" instead of
leaving the opponent waiting on a turn that never comes, but they are read-only
like the rest — writable, a caller could close a seat at create time and grief
the other player.

**`viewer_seat` semantics.** Computed by matching the *requesting authenticated
user's* id against `player1_user_id` / `player2_user_id`:

- `"p1"` / `"p2"` — the requester owns that seat.
- `"p1p2"` — the requester owns **both** seats (a logged-in hotseat game).
- `null` — the requester is anonymous, or is authenticated but owns neither
  seat. Guests always get `null`; they have no server identity.

It is an authoritative server-side ownership signal usable on a fresh device
with no local seat record (e.g. a deep link opened for the first time). Guests
fall back to the client's device-local seat registry. Covered by `ViewerSeatTest`
in [`test_lobby.py`](../../backend/game/tests/test_lobby.py).

#### The turn-clock fields

Three fields carry the inactivity clock ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)):

- **`turn_started_at`** (model field) is stamped whenever the **waiting seat
  changes**, through a single `_begin_turn()` helper in `views.py` that fuses the
  timestamp to the `current_turn` write so the two cannot drift: creation of a
  game (or match) that starts **`active`**, activation on `join` (a `waiting`
  game has nobody on the clock, and a lobby advert may have sat unjoined for
  days), `confirm_turn` flipping the turn, `offer_double` (the wait flips to the
  responder while `current_turn` stays put), `respond_to_double` on a *take* (it
  flips back to the offerer, who must roll), and `next_game`. It is deliberately
  **not** reset by `roll_dice`: one deadline covers rolling *and* moving, or a
  player could roll and then stall forever on a fresh clock. `updated_at` cannot
  substitute for it — `auto_now` bumps on every write for any reason.
- **`turn_waiting_seat`** is `current_turn` **except** while `double_offered_by`
  is set, where it is the responder — the same derivation `abandon`,
  [`gating.js`](../../mobile/src/game/gating.js) and
  [`seats.js`](../../frontend/src/utils/seats.js) already share. Null unless
  `status="active"`.
- **`turn_deadline`** is `turn_started_at + TURN_TIMEOUT_HOURS` (env-driven,
  **default 48**), and is **null whenever a claim is impossible in principle**:
  the game isn't `active`, either seat is closed (`player*_deleted` — that is
  `abandon`'s deadlock, deliberately non-scoring), either seat is a guest (null
  user FK, hence unverifiable), or no clock has been recorded.

**Clients compare a *server-corrected* `now()` to `turn_deadline` and never
re-derive eligibility.** There is deliberately no `can_claim` boolean: it would
be stale the instant it was serialised, and both clients want a live countdown
anyway. A null deadline is the "no claim here, ever" signal. Where "now" comes
from is the subject of the next section.

#### `server_now` — the client's clock is not trusted

Every game payload carries **`server_now`**: an ISO 8601 timestamp, in the same
format as `turn_deadline` (DRF's `DateTimeField`, e.g. `2026-08-04T10:00:00Z`),
recording the moment the response was serialized. It is **always present and
never null** — on finished games, on `waiting` games, on hotseat games, and on
every game whose `turn_deadline` is null. It answers "what time is it *there*",
which has nothing to do with whether a clock is running.

**Why it exists.** Both clients used to compare `turn_deadline` against the
*device* clock, so a skewed device produced two distinct, user-visible bugs:

- **A clock running fast** showed the claim button before the deadline had
  actually passed. The claim then 400ed
  (`"Your opponent still has time to move — …"`) *permanently*, because the
  button's condition and the server's condition disagreed by a fixed amount and
  the client had no way to notice.
- **A clock running slow** told the seat on the clock it had time left after the
  server had already opened a claim against it.

**How clients use it.** On each fetch a client computes an offset —
`server_now − device_now` — and adds it to the device clock everywhere a time is
needed: the countdown it ticks locally between polls, and the `now` it hands to
`canClaimTimeout`. The offset is a constant correction re-measured on every
poll, not a substitute for local ticking. See
[clients.md](clients.md#the-countdown-is-extrapolated-not-polled).

**`canClaimTimeout`'s signature did not change.** It has always taken `now` as a
parameter precisely so the caller decides what "now" means; what changed is what
the callers pass. The server remains authoritative either way — a claim is
re-checked against the server's own clock.

### `GET /api/games/`

**200** → array of games, **scoped to the requester**. Optional filter
`?status=waiting|active|finished` (exact match on `status`, applied *after* the
scope; any other query param is ignored). `?status=waiting` is the lobby /
open-games list. Paginated at 100 per page (bare array — see
[Conventions](#conventions)).

**Scoping.** `_list_scope_q(user)` in
[`views.py`](../../backend/game/views.py) builds a three-way `OR`; a row is
visible if **any** rule matches:

| Rule | Rows | Why |
|------|------|-----|
| open lobby | `status="waiting"` **and** neither seat closed | the public advert — its whole point is being visible to strangers |
| your own | either seat's user FK is the requester | registered players see their full history, any status |
| fully guest | **both** seat FKs null **and** neither seat closed | guest/hotseat resume, with no account to scope by; such a row carries no account usernames or user ids |

The list used to be `Game.objects.all()` on an `AllowAny` view with a
`fields = "__all__"` serializer, so an anonymous caller could page through every
row in the table — live boards, both usernames, both user ids.

Two consequences worth knowing:

- **Scoping applies to `list` only.** `GET /api/games/{id}/` stays open to
  everyone, because link/code sharing is how online games are joined at all.
- **A *mixed* game (one guest seat, one registered seat) past `waiting` drops out
  of the guest's list** — they need the id/link. Nothing better is possible
  without a guest identity; see "Guest seats are unverifiable" in
  [CLAUDE.md](../../CLAUDE.md).

A **closed** seat (`player*_deleted`) disqualifies a row from both the lobby and
the fully-guest rule, so account deletion can never re-open a seat to anonymous
listing — the same distinction [Seat enforcement](#seat-enforcement) draws.

Covered by
[`test_game_list_scoping.py`](../../backend/game/tests/test_game_list_scoping.py).
`GET /api/matches/` is [scoped too](#get-apimatches), by a deliberately shorter rule.

### `POST /api/games/`

| Field | Type | Required |
|-------|------|----------|
| `player1_name` | string | no — defaults to the authenticated username, else `"Player 1"` |
| `player2_name` | string | no — omit/blank to open a lobby game |

Server sets `board_state` to the initial position, `current_turn="p1"`,
`dice_values=[]`, and `player1_user` to the authenticated user (or null).

- Both names present → `status="active"` (hotseat / guest).
- Only player 1 → `status="waiting"` (waiting for an opponent).

**201** → the created game.

### `GET /api/games/{id}/`

**200** → the game (including `viewer_seat` for this requester).
**404** → `{"detail": "Not found."}` for an unknown id.

### `PUT` / `PATCH` / `DELETE /api/games/{id}/`

**Not routed — 405.** `GameViewSet` is deliberately assembled from the create /
list / retrieve mixins rather than being a `ModelViewSet`: the generic write
verbs were previously exposed with no seat check at all, letting any caller
overwrite a board mid-game or delete someone else's game. All state changes go
through the custom actions below, which enforce seat ownership.

### `POST /api/games/{id}/join/`

Join a waiting game as player 2.

| Field | Type | Required |
|-------|------|----------|
| `player2_name` | string | required for guests; authenticated users default to their username |

On success sets `player2_user` (or null), `player2_name`, and
`status="active"`. **200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | `"Game is not open to join."` — `status != "waiting"` |
| 400 | `"player2_name is required when joining as a guest."` — anonymous and no name |
| 404 | unknown id |

### The claim-vs-move race

A specific 400 that every gameplay action can now return, and the reason it has
its own message.

[`claim_timeout`](#post-apigamesidclaim_timeout) runs inside
`transaction.atomic()` on a **locked** row, so it wins any tie against a
gameplay action arriving in the same instant. The loser then re-reads a game
that is already `finished` — and used to be told
**`"Game is not active."`**, which is technically true and reads to the player
who *did* move in time like a bug in the app. Nothing in that message says an
opponent claimed a forfeit a fraction of a second earlier.

So the gameplay actions — `roll_dice`, `confirm_turn`, `offer_double` and
`respond_to_double` — now route their not-active branch through
`_inactive_game_error(game)`, which tests for `win_type == "timeout"` on the
finished row and returns

> `"Your opponent claimed a timeout win before this action reached the server, so the game is already finished."`

`win_type="timeout"` is the exact and only signature of the race: no other
ending writes it, and it is set inside the same locked transaction that finished
the row, so it is already visible by the time the loser reads it.

**It is still a 400**, and deliberately so: the request genuinely cannot be
performed, nothing was written, and inventing a 409 or a 200 here would mean
inventing a new client code path for a state the client can already see in the
very next poll. Only the *message* changed. Both clients render it as a calm
explanation of a finished game rather than as a raw action error — see
[clients.md](clients.md#the-countdown-is-extrapolated-not-polled).

Every other route to `"Game is not active."` (a `waiting` game, a game won on
the board, a dropped double, an abandoned game) is untouched and still returns
the generic message — that wording is the right answer for a genuinely stale
client, e.g. a resumed tab on a game that finished hours ago.

**`abandon` and `claim_timeout` are deliberately not included.** Both already
run their state checks in a different order and have their own, more specific
messages (a second claim on a finished game still gets
`"Game is not active."` from `claim_timeout`'s own check), and a claim losing to
a claim is not the confusion this addresses.

### `POST /api/games/{id}/roll_dice/`

No body. Rolls for `current_turn`; doubles produce four identical values. The
roll is recorded **even when it leaves no legal move** — the client then calls
`confirm_turn` with an empty `moves` list to pass.

**This action does not touch `turn_started_at`.** The waiting seat has not
changed, and one deadline is meant to cover rolling *and* moving — see
[the turn-clock fields](#the-turn-clock-fields).

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement (see below) — checked first |
| 400 | the [claim-vs-move race](#the-claim-vs-move-race) — the game finished as a `timeout` first |
| 400 | `"Game is not active."` |
| 400 | `"A double has been offered. The opponent must accept or drop first."` |
| 400 | `"Dice have already been rolled for this turn."` (`dice_values` non-empty) |
| 404 | unknown id |

### `POST /api/games/{id}/confirm_turn/`

**The only way to move a checker.** Commits a whole staged turn atomically and
passes it on.

```json
{ "moves": [ { "from_point": 1, "to_point": 3 }, { "from_point": 3, "to_point": 8 } ] }
```

`moves` defaults to `[]` (a pass). Each entry consumes exactly one die — the
clients expand a combined multi-die drag into sequential single hops before
sending; the server has no notion of a combined move
([ADR-001](../decisions/adr-001-combined-moves.md)).

Each hop goes through `_apply_single_move`, which re-derives `get_legal_moves`
and rejects anything not in it. When a bear-off matches several dice, the
**smallest** matching die is consumed, keeping larger dice free for later
oversized bear-offs.

Moves are applied to a deep copy; **if any check fails nothing is saved** and
the pre-turn `board_state`, `dice_values`, and `current_turn` are intact
(asserted in [`test_seat_security.py`](../../backend/game/tests/test_seat_security.py)).
On success the turn passes to the opponent with `dice_values=[]`, or the game
finishes if the last checker came off.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement — checked first |
| 400 | the [claim-vs-move race](#the-claim-vs-move-race) — the game finished as a `timeout` first |
| 400 | `"Game is not active."` |
| 400 | pending double (`"...accept or drop first."`) |
| 400 | `"No dice rolled for this turn."` — `dice_values` empty |
| 400 | `"moves must be a list."` |
| 400 | `"Each move requires from_point and to_point."` |
| 400 | `"Illegal move."` — any single hop is not legal |
| 400 | **maximal dice usage** (below) |
| 400 | **higher-die rule** (below) |
| 404 | unknown id |

**Maximal dice usage.** After replaying the staged moves the view compares dice
consumed against `max_moves_usable(pre_turn_board, player, dice)` — a recursive
search over every order of play. If a longer legal sequence existed:

> `"You must use as many dice as possible. A legal move remains for an unused die."`

This is what makes passing with an empty `moves` list legal *only* when the roll
is genuinely dead (`max_usable == 0`). Clients mirror it as a Confirm-button
affordance; the server is authoritative.

**Higher-die rule.** `higher_die_required_moves` applies when the roll is a
non-double two-die roll, exactly one die is playable (`max_usable == 1`), and
*either* die individually has a legal move. It is **general** — bar entry, blocked
mid-board positions and bear-off alike, not bear-off only. The single staged
`(from_point, to_point)` must be in the returned permitted set, or:

> `"When only one die can be played, you must play the higher die (2)."`

(the parenthesised number is the higher die of that roll). The check runs *after*
maximal usage, which guarantees exactly one staged move whenever the rule is live —
so only `moves[0]` is inspected. Both clients mirror it as a Confirm-button gate;
the server is authoritative. See [game-logic.md](game-logic.md#higher-die-rule--higher_die_required_moves)
and [`test_higher_die.py`](../../backend/game/tests/test_higher_die.py).

### `POST /api/games/{id}/offer_double/`

No body. Sets `double_offered_by` to the current-turn seat. While that is set,
`roll_dice` and `confirm_turn` both return 400 until the offer is answered.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 403 | seat enforcement against `current_turn` (opponent gets `"It's not your turn."`) |
| 400 | the [claim-vs-move race](#the-claim-vs-move-race) — the game finished as a `timeout` first |
| 400 | `"Game is not active."` |
| 400 | `"The doubling cube is disabled during the Crawford game."` |
| 400 | `"A double has already been offered."` |
| 400 | `"You can only double before rolling."` — `dice_values` non-empty |
| 400 | `"Your opponent owns the cube — only they may double."` |
| 400 | `"The cube is already at its maximum value (64)."` |

A centered cube (`cube_owner = null`) may be doubled by either player; the cube
owner may redouble.

### `POST /api/games/{id}/respond_to_double/`

| Field | Type | Required |
|-------|------|----------|
| `accept` | boolean (strictly `true`/`false`) | yes |

- **Accept** → `cube_value *= 2`, `cube_owner = responder`,
  `double_offered_by = null`. The offerer then rolls as normal.
- **Drop** → the game finishes immediately: `winner = double_offered_by`,
  `win_type = "drop"`, `points_value = cube_value` (the **pre-double** value),
  and the linked match score updates.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | the [claim-vs-move race](#the-claim-vs-move-race) — the game finished as a `timeout` first |
| 400 | `"Game is not active."` |
| 400 | `"No double has been offered."` |
| 403 | seat enforcement against the **responder** seat (`opponent(double_offered_by)`) — the offerer answering their own double gets `"It's not your turn."` |
| 400 | `"accept must be true or false."` — missing or non-boolean |

Check order is unusual here: game-state validation runs **before** the
permission check, so a non-participant hitting a finished game gets 400, not 403.

### `POST /api/games/{id}/abandon/`

No body. The escape hatch for a game **deadlocked by a closed seat**: the player
who owes the next action deleted their account, so
[seat enforcement](#seat-enforcement) refuses that seat to *everyone* — including
the surviving opponent — and the game can never advance again.

**This is not a resign button.** Resigning has scoring semantics (you concede
points); this endpoint has none. It fires only on a genuine deadlock.

Preconditions, in the order they are checked:

1. **The game is `active`.** A `finished` game has nothing to close out; a
   `waiting` game has no seat that owes an action yet.
2. **The seat that owes the next action is closed** (`player*_deleted`). That
   seat is `current_turn` — *except* when `double_offered_by` is set, where the
   game is waiting on the offerer's **opponent**, computed exactly as
   `respond_to_double` does. So a closed *offerer* with a pending double is not a
   deadlock (the survivor can still answer), and a closed seat that is simply not
   to move is not a deadlock yet either.
3. **The caller may act for the surviving seat**, judged by the same
   `_seat_permission_error` every gameplay action uses, with `seat = opponent(blocked)`.
   A registered survivor must be logged in as themselves; a guest survivor is
   anonymous-playable — the documented guest-seat trade-off, applied
   consistently. If **both** seats are closed the survivor check fails too and
   nobody can abandon, which is correct: there is no survivor to act for.

On success the outcome **invents nothing**: `status="finished"`, `winner=null`,
`win_type="abandoned"`, `points_value=0`, and `dice_values`/`double_offered_by`
cleared. The linked match's score is **not touched** — writing points nobody won
is precisely why auto-forfeit was rejected — but the match is set
`status="finished"` (still no winner, still no score change), because `next_game`
copies the seat-closure flags onto the game it creates and an open match would
let the survivor mint an endless series of games dead on arrival. A game with no
match is abandoned just the same.

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | `"Game is already finished."` — including abandoning twice |
| 400 | `"Game is not active."` — e.g. a `waiting` game |
| 400 | `"This game is not abandoned — the player to act still has an open seat."` |
| 403 | seat enforcement against the **surviving** seat — checked last, after both state checks |
| 404 | unknown id |

Note the check order is the reverse of the gameplay actions': state first, seat
permission last. Covered by
[`test_abandon.py`](../../backend/game/tests/test_abandon.py).

**Both clients call it**, and both offer it to the surviving seat only —
[`AbandonGamePanel.jsx`](../../frontend/src/components/AbandonGamePanel.jsx) on web,
[`AbandonGameSection.jsx`](../../mobile/src/components/AbandonGameSection.jsx) on
mobile, each behind a `canAbandon` predicate that mirrors the preconditions above
(`canAbandon` in [`seats.js`](../../frontend/src/utils/seats.js) /
[`gating.js`](../../mobile/src/game/gating.js)). The deadlock itself is surfaced as a
banner ("your opponent deleted their account — this game can't continue") and both
pollers stop on it. The predicates are affordance, not authorization — the server
re-checks everything.

### `POST /api/games/{id}/claim_timeout/`

No body. The **inactivity forfeit**: the opponent has left the game waiting on
them past `turn_deadline`, and the player still present claims the win. Rationale
and the alternatives rejected are in
[ADR-002](../decisions/adr-002-inactivity-forfeit.md).

**This is not `abandon`, and the two are not interchangeable.** `abandon` closes
out a game *deadlocked by a closed seat* and invents nothing — no winner, no
points. `claim_timeout` awards a real win to a real player against a seat that
still exists and simply stopped playing. A closed seat therefore 400s here and
sends you to [`abandon`](#post-apigamesidabandon) instead.

**Evaluation is pull-based.** There is no scheduler in this stack — no Celery, no
cron — so a deadline can only be evaluated when someone hits the API. Nothing
sweeps expired games in the background; the opponent must ask. For a live game
the other client's ~3.5 s poll effectively *is* the sweeper.

Preconditions, all read off the same state the serializer exposes as
[`turn_deadline`](#the-turn-clock-fields):

1. **The game is `active`.**
2. **Neither seat is closed** (`player*_deleted`).
3. **Both seats are registered** — both user FKs non-null. A guest seat is
   unverifiable, so without this rule anyone holding the game id could claim,
   including a hotseat player farming their own second seat.
4. **A clock is recorded** (`turn_started_at` is set).
5. **The deadline has elapsed** — `now() >= turn_started_at + TURN_TIMEOUT_HOURS`.
6. **The caller may act for the claimant seat**, judged by the same
   `_seat_permission_error` every gameplay action uses. The **idle** seat is
   `turn_waiting_seat`; the **claimant** is its opponent.

On success: `status="finished"`, `winner` = the claimant seat,
`win_type="timeout"`, `points_value = 1 × cube_value`, `dice_values` and
`double_offered_by` cleared, and the match score updated — it runs through
`_apply_game_result` exactly like a board win or a drop. **A single point, not a
gammon:** you cannot prove a gammon the opponent never let you play, so one is
the defensible floor, and multiplying by the live cube keeps the stake the two
players had actually agreed to.

**Stats need no special case.** `"timeout"` is deliberately **not** added to the
`abandoned` exclusion in `UserSerializer._stats`: a timeout has a real `winner`,
so `losses = total − wins` already scores it correctly on both sides
([`GET /api/auth/me/`](#get-apiauthme)).

**200** → the updated game.

| Status | Trigger |
|--------|---------|
| 400 | `"Game is not active."` — `waiting` or `finished`, **including a second claim** (the first one finished the game) |
| 400 | `"A player deleted their account, so this game is not stalled — it is deadlocked. Use abandon to close it out; …"` — a closed seat |
| 400 | `"Timeout wins are only available when both players are registered accounts."` — either seat is a guest |
| 400 | `"This game has no turn clock running."` — `turn_started_at` is null |
| 400 | `"Your opponent still has time to move — Nh Nm remaining."` — the deadline hasn't elapsed |
| 403 | seat enforcement against the **claimant** seat — the idle player claiming their own timeout gets `"It's not your turn."` |
| 404 | unknown id |

Note the check order, which matches [`abandon`](#post-apigamesidabandon) rather
than the gameplay actions: **every state check runs before the permission
check**, so a stranger hitting a finished or not-yet-expired game gets 400, not
403. The whole action runs inside `transaction.atomic()` on a locked row, so the
deadline read and the "already finished?" test see the same row this action
writes — a replayed request loses.

**Both clients offer it to the claimant seat only**, behind a `canClaimTimeout`
predicate that is the **third** member of the `seats.js` / `gating.js`
stay-in-sync obligation, and render a countdown extrapolated from
`turn_deadline` against a [`server_now`](#server_now--the-clients-clock-is-not-trusted)-corrected
clock rather than from the poll or the raw device clock — see
[clients.md](clients.md#closed-seats-and-the-inactivity-clock-the-predicates-both-clients-share).
As everywhere else, the predicate is affordance; the server re-checks all six
preconditions.

---

## Matches

### The `Match` payload

`MatchSerializer`, `fields = "__all__"` plus `current_game_id`:
`id`, `player1_user`, `player2_user`, `player1_name`, `player2_name`,
`player1_deleted`, `player2_deleted`,
`target_points`, `player1_score`, `player2_score`,
`status` (`"active"`/`"finished"`), `winner` (`"p1"`/`"p2"`/null),
`created_at`, `updated_at`, `current_game_id`.

`current_game_id` resolves to the match's first `status="active"` game, falling
back to its most recent game, else null. Writable fields: `player1_name`,
`player2_name`, `target_points` — everything else is read-only, including the
two `player*_deleted` closed-seat flags (same meaning as on `Game`).

`MatchSerializer` has **no `viewer_seat`**; that field is game-only.

### `GET /api/matches/`

**200** → array of matches, **scoped to the requester**. No `?status` filter (unlike
games). Paginated at 100 per page (bare array).

**Scoping.** `_match_list_scope_q(user)` in
[`views.py`](../../backend/game/views.py) is the match analogue of
[`_list_scope_q`](#get-apigames) and is deliberately **one clause shorter**:

| Rule | Rows | Why |
|------|------|-----|
| fully guest | **both** seat FKs null **and** neither seat closed | guest/hotseat resume, with no account to scope by; no user ids, no account names |
| your own | either seat's user FK is the requester, whatever the status | registered players keep their full match history |

**There is no public-lobby clause, because a match has no lobby state.**
`Game.status` has a `"waiting"` value whose entire purpose is advertising an open
seat to strangers; `Match.status` is only `active`/`finished`. Joinability is implied
by an empty `player2_name`, and an open match is advertised through its *first game*,
which sits in the `waiting` lobby carrying a `match` id — so the lobby already works
without listing matches at all. A "player2_name is blank" clause here would re-expose
exactly the registered-player rows this closes.

As with games, scoping applies to **`list` only**: `GET /api/matches/{id}/` and the
detail actions stay open, because sharing a match by id/link is how an online match
is joined and resumed. This bounds *enumeration*, not access to a match you have the
id for. Covered by
[`test_match_list_scoping.py`](../../backend/game/tests/test_match_list_scoping.py).

### `POST /api/matches/`

| Field | Type | Required |
|-------|------|----------|
| `player1_name` | string | no — defaults to the authenticated username, else `"Player 1"` |
| `player2_name` | string | no — omit for an online/link match |
| `target_points` | int, one of **3, 5, 7, 9** | no — defaults to 5 |

Creates the match **and its first game** in one call (initial board,
`current_turn="p1"`), `active` if `player2_name` was given, else `waiting`.

**201** → the match (use `current_game_id` to reach the game).
**400** → `{"error": "target_points must be 3, 5, 7, or 9."}` for any other value.

### `POST /api/matches/{id}/next_game/`

No body. Starts the next game after the previous one finished. The previous
winner moves first (`"p1"` if there is no finished game yet).

Assigns `crawford_game=True` when a player has just reached match point
(`target_points − 1` equals either score) **and** no game in the match is already
flagged Crawford — exactly one Crawford game per match. It also copies the
match's `player1_deleted` / `player2_deleted` onto the new game, so a closed seat
stays closed instead of reappearing as a guest seat on a fresh board.

**201** → the new game (`GameSerializer`).

| Status | Trigger |
|--------|---------|
| 403 | `_match_permission_error` (see below) — checked first |
| 400 | `"Match is already finished."` |
| 400 | `"A game is already in progress."` — an `active` or `waiting` game exists |
| 404 | unknown id |

**Participant enforcement.** `_match_permission_error` is the match-level lift of
the seat rule: a request is allowed if the caller could act for *either* seat.

| Requester | Result |
|-----------|--------|
| a registered participant (owns either seat) | allowed |
| any other logged-in account | 403 `"You are not a participant in this match."` |
| anonymous, ≥ 1 seat null **and not closed** | allowed (guest/hotseat matches) |
| anonymous, both seats registered *or* closed | 403 `"This match belongs to registered players. Log in to continue it."` |

A **closed** seat does not count as a guest seat despite its null FK — otherwise
deleting an account would silently open every match you were in to anonymous
callers.

### `POST /api/matches/{id}/join/`

Join a match as player 2 (online match links).

| Field | Type | Required |
|-------|------|----------|
| `player2_name` | string | required for guests; authenticated users default to their username |

Sets the match's `player2_user`/`player2_name` and promotes the match's first
`waiting` game to `active` with the same player-2 identity.

**200** → the updated match.

| Status | Trigger |
|--------|---------|
| 400 | `"Match already has two players."` — `player2_name` already set |
| 400 | `"player2_name is required for guest join."` |
| 404 | unknown id |

---

## Seat enforcement

`_seat_permission_error` in [`views.py`](../../backend/game/views.py) guards the
six actions that mutate a game: `roll_dice`, `confirm_turn`, `offer_double`,
`respond_to_double`, `abandon` and `claim_timeout`. It checks the seat being
acted for — `game.current_turn` by default, the explicit responder seat for
`respond_to_double`, the **surviving** seat for `abandon`, or the **claimant**
seat (the waiting seat's opponent) for `claim_timeout`. On rejection:
**403** with `{"error": "<message>"}`.

| Seat FK | Requester | Result |
|---------|-----------|--------|
| **null + `player*_deleted`** (closed) | **anyone, including the surviving opponent** | **403** `"This player deleted their account — their seat is closed."` |
| registered user | that user | allowed |
| registered user | the other participant | 403 `"It's not your turn."` |
| registered user | another logged-in account | 403 `"You are not a participant in this game."` |
| registered user | anonymous | 403 `"This seat belongs to a registered player. Log in as them to play it."` |
| null (guest) | anonymous | **allowed** |
| null (guest) | a participant of this game | allowed (covers hotseat) |
| null (guest) | another logged-in account | 403 `"You are not a participant in this game."` |

The closed-seat row is checked **first**, before every other branch. A seat is
closed when its flag is true *and* its FK is null — i.e. a registered player was
there and deleted their account (`DELETE /api/auth/me/`). Without it the null FK
would fall through to the guest rule and the seat would become anonymously
playable by anyone holding the game id. The surviving opponent is refused too:
they satisfy the participant test on the orphaned seat and could otherwise play
both sides of the board. Consequence: such a game **deadlocks** — no action on
the closed seat ever succeeds and nothing auto-forfeits it. The only way out is
[`abandon`](#post-apigamesidabandon), which does not play the seat — it closes
the game out unscored. See
[data-model.md](data-model.md#closed-seats-player_deleted). Note that
[`claim_timeout`](#post-apigamesidclaim_timeout) is **not** an alternative exit
here: it refuses a closed seat outright, precisely so a deadlock never turns into
points nobody won.

Consequences worth knowing:

- **Fully-guest games are unrestricted** — no FKs means nothing to verify.
- Enforcement is exactly as strong as the seat FKs: a guest seat is
  unverifiable, so an attacker can log out and act on one anonymously. See
  [auth.md](auth.md#security-note-current-limitations).
- The **web UI does not gate turn ownership** locally — an unauthorized click
  surfaces the server's 403. Mobile hides controls via
  [`gating.js`](../../mobile/src/game/gating.js) as UX on top of the same rules.
  Two branches both clients *do* model are the **closed seat** and the
  **inactivity clock**: `isDeadlocked` / `canAbandon` / `canClaimTimeout` live in
  `gating.js` and in [`seats.js`](../../frontend/src/utils/seats.js) as an
  identical, must-stay-in-sync trio, because a deadlock has to be *explained*
  rather than left as a silent 403, and a claim has to be *offered* rather than
  guessed at.
- `next_game` is guarded by the separate `_match_permission_error`
  ([above](#post-apimatchesidnext_game)); `join` on either resource is **not**
  guarded at all, and `PUT`/`PATCH`/`DELETE` are no longer routed.

Covered by [`test_seat_security.py`](../../backend/game/tests/test_seat_security.py),
the permission tests in [`test_cube.py`](../../backend/game/tests/test_cube.py),
the closed-seat tests in
[`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py),
and [`test_abandon.py`](../../backend/game/tests/test_abandon.py).

---

## Planned / Not Yet Implemented

Not in the code today — do not assume them:

- **Filtering beyond `?status`.** No ordering param and no search. (Pagination
  *does* exist — see [Conventions](#conventions).)
- **A "my games" endpoint.** There is no *explicit* filter by the requesting user —
  though both list routes are now scoped to them ([games](#get-apigames),
  [matches](#get-apimatches)), so a logged-in caller's lists are already their own
  rows plus (for games) the open lobby.
- **Real-time push.** No WebSockets/Channels/ASGI and no long-poll endpoint. **Both**
  clients poll the game detail route on a ~3.5 s timer
  ([mobile](../../mobile/src/game/useGame.js),
  [web](../../frontend/src/hooks/useGame.js)).
- **Matchmaking / lobby queue endpoints.** Pairing is manual via
  `?status=waiting` plus `join`. No queue, ranking, or auto-pairing route.
- **Resign and rematch endpoints.** A game can only end on the board, by dropping
  a double, by an opponent running out the clock
  ([`claim_timeout`](#post-apigamesidclaim_timeout)), or — for the one deadlock
  case — via [`abandon`](#post-apigamesidabandon), which is *not* a resign: it
  scores nothing. There is no way to **concede** points to an opponent, and no
  route to replay a finished match.
- **A background sweeper for expired turns.** Timeout claims are still
  pull-based; **nothing forfeits an idle game until the opponent calls
  `claim_timeout`**, by design ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)).
  There is no Celery and no in-process scheduler. What *does* exist now is a
  management command, `manage.py send_turn_reminders`, which **mails** the seat
  on the clock before its deadline and forfeits nothing — see
  [railway-deploy.md](../operations/railway-deploy.md#8-schedule-the-turn-reminder-cron).
  It is inert until a platform cron invokes it.
- **Push notifications.** The reminder above is email only. There is no device
  token, no APNs/FCM registration and no notification endpoint anywhere in the
  tree, so a player who has not **confirmed** their address is still told nothing
  ([ADR-003](../decisions/adr-003-email-verification.md) — an address is now
  required at registration, but only a verified one is mailed).
- **Live chess-style clocks.** `turn_deadline` is a single per-turn deadline.
  There is no reserve time, no Fischer/Bronstein increment, no per-player
  accumulated-time field, and no clock mode at game creation — deferred until
  presence exists ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)).
- **Mobile deep links for either emailed link.** Both the reset link and the
  verification link are built from `FRONTEND_BASE_URL` — the **web** origin — so
  a mobile user who taps either finishes in a browser. There is no
  `backgammon://reset-password/...` or `backgammon://verify-email/...` route, and
  `FRONTEND_BASE_URL` is a single value with nowhere to put a second one.
- **Chat.** No endpoint exists.
- **A logout endpoint.** The blacklist app *is* installed and is used by refresh
  rotation and by account deletion, but no route revokes a token on demand —
  clients just discard them.
- **A change-password endpoint** (authenticated, old password → new). Reset by
  emailed token exists ([above](#post-apiauthpassword-resetconfirm)); there is no
  route for a logged-in user to change a password they still know.
- **API versioning and an OpenAPI/schema endpoint.** Paths are unversioned and
  no schema generator is installed; the browsable `DefaultRouter` root is the
  only self-description.
