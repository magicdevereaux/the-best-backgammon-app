# Going Live — Production-Readiness Audit

An honest audit of what stands between the current tree and a deployed backend +
a shipped web app + a store-approved mobile app.

> **Ground rule:** this doc describes the code **as it is today**. Every item
> cites the file and line it was found in. Nothing here is speculative, and
> nothing is marked done that wasn't read back out of the tree.

Re-audited **2026-07-26** against HEAD `ef22c3b` **plus the uncommitted working
tree** (a hardening pass was still landing while this was written — re-verify
line numbers after any edit).

## Current state

The original audit found 11 hard blockers. **Most of them are closed.** The
backend is now env-driven, containerised, throttled, and passes Django's own
deployment checks cleanly; both clients can be pointed at a real API by
configuration; CI runs all three suites; legal drafts exist. What remains splits
almost perfectly in two: **decisions and credentials only the owner can supply**,
and a short list of **real code gaps**, one of which is a genuine security hole.

Verified this pass, by running it:

```
$ cd backend && DEBUG=False SECRET_KEY=<50-char random> ALLOWED_HOSTS=example.com \
    venv/Scripts/python.exe manage.py check --deploy
System check identified no issues (0 silenced).
```

Six warnings → zero. All three suites are green: **backend 296**, **web 207**,
**mobile 114** (617 total), and [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
runs each on every push.

Still true, and still good news: **no secrets are committed.** `git status`
shows no `.env`, and [`.gitignore`](../../.gitignore) covers `db.sqlite3`,
`venv/`, `.env`, `.env.production`, `secrets.json`, `*.pem` / `*.key`. The
`.env.example` files are placeholders with empty values.

**Order of operations from here.** (1) Fix the deleted-account seat hole
([2.1](#21-a-deleted-accounts-seat-becomes-an-anonymous-playable-guest-seat)) —
it is a live security bug and needs no infrastructure. (2) Owner picks a host,
provisions Postgres, sets the env vars ([section 1](#1-blocked-on-the-owner)).
(3) Deploy, smoke-test, turn on backups. (4) Build web with
`REACT_APP_API_BASE_URL`, build mobile with `EXPO_PUBLIC_API_URL`, test both off
the dev LAN. (5) Fill the legal `[TODO]`s, host the policy, submit.

---

## 1. Blocked on the owner

No coding session can close these. They need a decision, a credential, a
purchase, or a human signature. Everything here is *config-shaped* — the code
side is already built and waiting for the value.

### 1.1 Pick a host and provision PostgreSQL

The app is host-agnostic and ready to deploy: the root
[`Dockerfile`](../../Dockerfile) builds from the repo root, runs `collectstatic`
at build time, runs as a non-root user, has a `HEALTHCHECK` against `/healthz/`,
and starts `migrate && gunicorn`. [`Procfile`](../../Procfile) covers
Heroku-style hosts. Nothing host-specific is committed, on purpose.

`DATABASES` ([`settings.py:126–133`](../../backend/backgammon/settings.py)) reads
`DATABASE_URL` through `dj-database-url` and falls back to local SQLite;
`psycopg2-binary` is pinned in [`requirements.txt`](../../backend/requirements.txt).
The owner must provision a managed Postgres, set `DATABASE_URL`, and **verify the
migrations apply cleanly on an empty Postgres before cutting over** — they have
only ever been run against SQLite.

### 1.2 Domain, TLS, and the production environment

Buy/point a domain and let the platform terminate TLS. The app already trusts
`X-Forwarded-Proto` and redirects to HTTPS when `DEBUG=False`
([`settings.py:239–250`](../../backend/backgammon/settings.py)).

Then set these on the host — **never in a committed file**. Full annotated list
in [`backend/.env.example`](../../backend/.env.example):

| Variable | Notes |
|---|---|
| `SECRET_KEY` | Required. Startup **fails loudly** without it when `DEBUG=False` ([`settings.py:57–67`](../../backend/backgammon/settings.py)). Generate fresh; never the committed dev key. |
| `DEBUG` | `False`. This one flag turns on the whole hardening block. |
| `ALLOWED_HOSTS` | The real hostname(s). Default is dev-only and includes a stale LAN IP ([`settings.py:71–73`](../../backend/backgammon/settings.py)). |
| `DATABASE_URL` | Postgres URL. |
| `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` | The web app's origin ([`settings.py:183–184`](../../backend/backgammon/settings.py)). Defaults are `http://localhost:3000`. |
| `SECURE_HSTS_SECONDS` | **Caution.** Defaults to 1 year *with* `includeSubDomains` and `preload`. Set it to `60` for the first deploys and ramp — HSTS is very hard to undo. |
| `THROTTLE_RATE_*` | Optional; defaults are sane (see [2.3](#23-throttle-counters-are-per-process)). |

### 1.3 Store the mobile API URL and submission credentials

The mobile client resolves its backend by an explicit precedence chain and
**refuses to guess in a release build** ([`config.js:58–127`](../../mobile/src/api/config.js)):
`MANUAL_OVERRIDE` → `EXPO_PUBLIC_API_URL` → `expo.extra.apiUrl` → Metro `hostUri`
(dev only) → loopback (dev only). A non-`https://` URL in a release build is
reported as a configuration error rather than failing as an opaque network
timeout. The values it needs are blank and marked `OWNER TODO`:

- [`eas.json:33`](../../mobile/eas.json) — `preview.env.EXPO_PUBLIC_API_URL` (staging)
- [`eas.json:41`](../../mobile/eas.json) — `production.env.EXPO_PUBLIC_API_URL`
- [`app.json:48`](../../mobile/app.json) — `expo.extra.apiUrl` (fallback)
- [`eas.json:51`](../../mobile/eas.json) — `submit.production` is `{}`. iOS needs
  `appleId`, `ascAppId`, `appleTeamId`; Android needs `serviceAccountKeyPath`
  and `track`.

Also owner-side: create the App Store Connect and Play Console entries, produce
screenshots per required device size, write the listing copy, and complete the
IARC age rating.

### 1.4 Set the web build's API origin

[`frontend/src/api/config.js`](../../frontend/src/api/config.js) reads
`REACT_APP_API_BASE_URL` (empty → root-relative, which is what the CRA dev proxy
wants) and every API module routes through `apiUrl()` — including the refresh
call in [`authApi.js:26`](../../frontend/src/api/authApi.js), which bypasses
`apiClient`. CRA inlines the value **at build time**, so it must be set in the
host's build environment, not at runtime. See
[`frontend/.env.example`](../../frontend/.env.example).

### 1.5 Publish the legal documents

Drafts exist and were written against the actual code — no analytics, ads, or
third-party SDKs are claimed, because none exist:
[`privacy-policy.md`](../legal/privacy-policy.md),
[`terms-of-service.md`](../legal/terms-of-service.md), with the blocking
checklist in [`docs/legal/README.md`](../legal/README.md).

They are **not publishable as-is**: **20 `[TODO]` placeholders in the privacy
policy and 15 in the terms** cover the legal entity name, contact email, dates,
jurisdiction and venue, hosting provider and log retention, minimum age,
GDPR/CCPA applicability, and the liability cap. A lawyer should read both. Then
host them at stable public URLs (Play additionally wants a web-accessible
account-deletion request URL) and link them from both clients and both store
listings.

> One correction the drafts need: they still say account deletion is
> unimplemented. It **is** implemented now — see [3.11](#3-done). That section of
> both documents, and of `docs/legal/README.md`, is stale.

### 1.6 Backups, admin credentials, and monitoring accounts

- Enable the managed database's automated backups and **test a restore once**.
  Untested backups are not backups. Nothing in the repo can do this.
- Choose a strong superuser password and decide how `/admin/` is protected (see
  [2.5](#25-django-admin-is-publicly-exposed-at-a-predictable-path)).
- If you want error alerting, create the Sentry (or equivalent) project and
  supply a DSN — the code side is a small change, the account is not
  ([2.7](#27-no-error-monitoring)).

---

## 2. Still open in code

Real remaining work, ranked by severity.

### 2.1 A deleted account's seat becomes an anonymous-playable guest seat

**Severity: high. This is a live security hole, and it was introduced by the
account-deletion feature.**

Every user FK on `Game` and `Match` is `on_delete=models.SET_NULL`
([`models.py:6–11`](../../backend/game/models.py),
[`models.py:37–42`](../../backend/game/models.py)), and
`_purge_unjoined_lobby_entries` ([`views.py:158`](../../backend/game/views.py))
only removes `status="waiting"` lobby adverts — an **in-progress** game is kept
deliberately (asserted by `test_in_progress_game_is_not_destroyed` in
[`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py)).
So after Alice deletes her account mid-game, `game.player1_user_id` is `NULL`.

`_seat_permission_error` ([`views.py:247–286`](../../backend/game/views.py)) reads
a null seat FK as *"this is a guest seat, and guests are unverifiable"*:

```python
if user_id is None or is_participant:
    return None                      # views.py:284 — anonymous request allowed
```

There is no field distinguishing "never had an account" from "had one and
deleted it", so **any anonymous caller can now roll, move, confirm turns, and
offer/answer doubles on the deleted player's seat** in every unfinished game
they were in. Secondarily, the surviving opponent satisfies `is_participant` on
the orphaned seat and can play both sides. `_match_permission_error`
([`views.py:289–318`](../../backend/game/views.py)) has the same shape, so
`next_game` opens to anonymous callers on that match too.

**Fix (pick one).** Either (a) add a per-seat `player1_seat_closed` /
`player2_seat_closed` boolean (or a single `seat_closed` char field mirroring the
`"p1"`/`"p2"` convention) set during deletion, and treat a closed seat as
*nobody may act* in both permission helpers; or (b) resolve the account's
unfinished games at deletion time — forfeit them to the opponent, or mark them
`status="finished"` with a new `win_type` — so no orphaned seat is ever
playable. (a) preserves history and is the smaller change. Whichever lands needs
a test in `test_account_deletion.py` asserting an anonymous `roll_dice` on the
orphaned seat returns 403.

### 2.2 `GET /api/games/` is still public and unscoped

`GameViewSet.get_queryset` ([`views.py:536–541`](../../backend/game/views.py)) is
`Game.objects.all()` with only an optional `?status=` filter, the default
permission is `AllowAny` ([`settings.py:211–214`](../../backend/backgammon/settings.py)),
and `GameSerializer` uses `fields = "__all__"`
([`serializers.py:20–28`](../../backend/game/serializers.py)) — full board state,
both usernames, and both user IDs.

Pagination now bounds a *single* response to 100 rows
([`BareListPagination`, `views.py:40–62`](../../backend/game/views.py)), but
`?page=N` walks the whole table, and the anon throttle (120/min) allows ~12,000
rows a minute per IP. The exposure is unchanged; only the blast radius per
request shrank.

**Fix.** Scope the default `list` to open/lobby games plus the requester's own
games. Keep retrieve-by-id open — link sharing depends on it, and the lobby list
is legitimately anonymous. Note both clients consume these endpoints as **bare
arrays**, so any change must preserve that shape (the pagination class returns a
bare array for exactly this reason — see its docstring).

### 2.3 Throttle counters are per-process

There is **no `CACHES` setting** in
[`settings.py`](../../backend/backgammon/settings.py) (verified by grep), so DRF's
throttles fall back to Django's default `LocMemCache` — **per worker process, and
wiped on restart**. The Dockerfile and Procfile both default to
`--workers 3`, so the effective limits are ~3× the configured ones (`login`
10/hour becomes ~30/hour), and a deploy resets every counter.

**Fix.** Add a shared `CACHES` backend (Redis, or `django.core.cache.backends.db`
if you'd rather not run one) and point it at the platform's cache add-on. Until
then, treat the numbers in
[`.env.example:52–56`](../../backend/.env.example) as upper bounds divided by
`WEB_CONCURRENCY`.

### 2.4 Guest seats are unverifiable by design

A seat with a null user FK has no server identity to check, so anonymous
requests on it are allowed — see the policy docstring at
[`views.py:247–271`](../../backend/game/views.py). This is what keeps
hotseat/guest play working without an account, and it is a deliberate,
documented trade-off rather than an oversight. It is listed here because it is
also the mechanism [2.1](#21-a-deleted-accounts-seat-becomes-an-anonymous-playable-guest-seat)
abuses.

**Fix (larger).** A guest token minted at game creation and stored client-side,
checked alongside the user FK. Not required for launch; required before anyone
plays for anything that matters.

### 2.5 Django admin is publicly exposed at a predictable path

[`backgammon/urls.py:7`](../../backend/backgammon/urls.py) mounts `admin/` with no
IP allowlist and no 2FA. And note **DRF throttles do not cover it** — the admin
login is a plain Django view, so the `login` scope
([`views.py:98`](../../backend/game/views.py)) protects `/api/auth/login/` only.
Admin compromise is total compromise.

**Fix.** Move it to a non-obvious path, restrict by IP or put it behind the
platform's auth proxy, and add `django-axes` (or equivalent) if you want lockout
on the admin form specifically.

### 2.6 No email on accounts, so there is no password recovery

`RegisterSerializer` ([`serializers.py:191–224`](../../backend/game/serializers.py))
takes username + password only. No email verification, no password reset, no
password-change endpoint. A user who forgets their password loses their entire
match history and you handle it by hand — and account deletion now requires the
password ([`AccountDeleteSerializer`, `serializers.py:165–188`](../../backend/game/serializers.py)),
so a forgotten password blocks self-service deletion too, which is exactly the
flow store reviewers test.

**Fix.** Optional-but-encouraged email at registration plus Django's
password-reset flow (needs an email backend: SES, Postmark, Resend).
Verification can wait; recovery cannot.

### 2.7 No error monitoring

`LOGGING` ([`settings.py:263–302`](../../backend/backgammon/settings.py)) writes
structured logs to stdout, which every container platform captures — that gap is
closed. But there is still no Sentry/Rollbar integration (grep for `sentry`
across `backend/` returns nothing outside `venv/`) and no `ADMINS` email, so a
500 notifies nobody. You'd learn about outages from players.

**Fix.** `sentry-sdk[django]` is ~10 lines plus a DSN env var. Tag the
release/environment so web and mobile errors are distinguishable.

### 2.8 CI doesn't run `check --deploy` or the web build

[`ci.yml`](../../.github/workflows/ci.yml) runs all three suites, but the comment
at [`ci.yml:56–62`](../../.github/workflows/ci.yml) declines to run
`manage.py check --deploy` on the grounds that "the env var contract doesn't
exist in the repo yet." **That is now stale** — the contract exists
([`backend/.env.example`](../../backend/.env.example)) and a production-shaped
run passes clean. `npm run build` is also never exercised, so a build-only
breakage (CRA is stricter than the test transform) reaches you at deploy time.

**Fix.** Add a `check --deploy` step with `DEBUG=False`, a throwaway
`SECRET_KEY`, and `ALLOWED_HOSTS=example.com`, plus a `npm run build` step in the
web job. Delete the stale comment.

### 2.9 No OTA updates: `expo-updates` is not installed

[`eas.json:27,37`](../../mobile/eas.json) declare `"channel": "preview"` and
`"channel": "production"`, but `expo-updates` is absent from
[`mobile/package.json`](../../mobile/package.json) and
[`app.json`](../../mobile/app.json) has no `runtimeVersion` or `updates` block.
The channels are inert — every JS fix needs a full store resubmission and review.
For a client that re-implements the rules engine locally, that is a slow path for
a rules bug.

**Fix.** `npx expo install expo-updates`, set a `runtimeVersion` policy, verify
`eas update` publishes to the right channel.

### 2.10 Rules and API surface

- **The higher-die rule is enforced only during bear-off.**
  `higher_die_required_moves` is server-only and bear-off-scoped; the official
  rule is general. See [game-logic.md](../architecture/game-logic.md). A
  rules-literate player will report it as a bug.
- **`move_checker` is dead API surface.** No client uses it
  ([`views.py:637`](../../backend/game/views.py)); it is extra attack surface for
  zero benefit. Consider removing it.
- **Web online play has no auto-refresh.** Mobile polls ~3.5s
  ([`useGame.js`](../../mobile/src/game/useGame.js)); the web client needs a
  manual reload to see an opponent's move or a pending double. Polling is the
  cheap fix; WebSockets is the real one (**Planned**, see
  [CLAUDE.md](../../CLAUDE.md)).

### 2.11 Polish and hygiene

- **Web page metadata.** [`frontend/public/`](../../frontend/public/) contains only
  `index.html` — no favicon, `manifest.json`, `robots.txt`, Open Graph tags, or
  `<meta name="description">`, and the title is just "Backgammon". Shared game
  links preview as a bare URL.
- **Tracked scratch files.** `git ls-files` still shows
  `mobile/MOBILE_PROGRESS.md` and `mobile/.claude/settings.json`; the former is
  session notes that probably belong outside the repo.
- **Mobile version numbers.** [`app.json`](../../mobile/app.json) declares
  `version 1.0.0` / `buildNumber "1"` / `versionCode 1`, but
  [`eas.json:15`](../../mobile/eas.json) sets `"appVersionSource": "remote"` with
  `autoIncrement` on production — EAS, not the file, owns build numbers. Harmless
  once you know which is authoritative.
- **No load testing.** Nobody knows what concurrency this survives. One `k6` or
  `locust` run against the deployed API is cheap insurance.
- **No matchmaking.** Online play is link/code only, so a store user with no
  friend to send a link to has nothing to do online. A product risk, not a
  technical blocker. See [overview.md](../architecture/overview.md).

---

## 3. Done

Closed since the first audit. Recorded so the next reader doesn't redo them —
each was verified by reading the file, not by trusting a changelog.

1. **Settings are fully env-driven.** `SECRET_KEY` from the environment, with a
   dev fallback and a hard `ImproperlyConfigured` when `DEBUG=False`
   ([`settings.py:55–67`](../../backend/backgammon/settings.py)); `DEBUG`,
   `ALLOWED_HOSTS`, `DATABASE_URL`, CORS/CSRF origins, throttle rates, HSTS, and
   log level all read via `env_bool` / `env_list` helpers. `python-dotenv` loads
   an optional `backend/.env`. **Local dev still needs no `.env` at all** —
   every default is the previous hardcoded value.
2. **`check --deploy` is clean.** Zero issues with `DEBUG=False`, down from six.
   The whole `SECURE_*` block — SSL redirect, proxy SSL header, HSTS with
   subdomains + preload, secure session/CSRF cookies, nosniff, referrer policy,
   `X_FRAME_OPTIONS = DENY` — is gated on `not DEBUG`
   ([`settings.py:239–250`](../../backend/backgammon/settings.py)), with
   `/healthz/` exempted from the HTTPS redirect for in-network probes.
3. **Dependencies pinned and production-complete.**
   [`requirements.txt`](../../backend/requirements.txt) pins exact versions and
   adds `gunicorn`, `whitenoise`, `dj-database-url`, `psycopg2-binary`,
   `python-dotenv`.
4. **Postgres is a config change, not a code change** — `DATABASE_URL` via
   `dj-database-url` with `conn_max_age`, health checks, and optional SSL
   ([`settings.py:126–133`](../../backend/backgammon/settings.py)). (Provisioning
   is still owner work — [1.1](#11-pick-a-host-and-provision-postgresql).)
5. **Static files work.** `STATIC_ROOT`, WhiteNoise middleware immediately after
   `SecurityMiddleware`, and `CompressedManifestStaticFilesStorage` outside
   `DEBUG` ([`settings.py:88–99, 151–174`](../../backend/backgammon/settings.py)).
6. **Deploy manifests exist.** Root [`Dockerfile`](../../Dockerfile) (non-root
   user, build-time `collectstatic`, `HEALTHCHECK`, `migrate` + gunicorn),
   [`Procfile`](../../Procfile), [`.dockerignore`](../../.dockerignore) (excludes
   `.env`, `db.sqlite3`, `venv/`, `node_modules/`), and an annotated
   [`backend/.env.example`](../../backend/.env.example).
7. **`/healthz/` exists** — [`backgammon/health.py`](../../backend/backgammon/health.py),
   unauthenticated, `never_cache`, `SELECT 1`, 200/503, wired at
   [`urls.py:10`](../../backend/backgammon/urls.py).
8. **Generic write verbs are gone.** Both viewsets dropped `ModelViewSet` for
   explicit Create/List/Retrieve mixins
   ([`views.py:366–371`](../../backend/game/views.py),
   [`views.py:511–516`](../../backend/game/views.py)), so `PUT`/`PATCH`/`DELETE`
   on games and matches are 405 rather than unguarded. Covered by
   `WriteVerbsRemovedTest` in
   [`test_hardening.py`](../../backend/game/tests/test_hardening.py).
9. **`next_game` is permission-checked** — `_match_permission_error`
   ([`views.py:289–318`](../../backend/game/views.py)), called before any state
   check, with the participant/stranger/anonymous matrix tested.
10. **Registration runs `AUTH_PASSWORD_VALIDATORS`.** `RegisterSerializer.validate`
    ([`serializers.py:200–221`](../../backend/game/serializers.py)) calls
    `password_validation.validate_password` with a `User(username=...)` so the
    similarity validator works, and re-raises as a DRF field error. `"password"`
    and `"12345678"` are now rejected.
11. **Account deletion exists, end to end.** `DELETE /api/auth/me/`
    ([`MeView`, `views.py:174–218`](../../backend/game/views.py)) requires the
    account's own password, blacklists every outstanding refresh token
    (`_blacklist_refresh_tokens`), purges unjoined lobby adverts, and anonymises
    rather than cascades game history. UI on both clients
    ([`DeleteAccountPanel.jsx`](../../frontend/src/components/DeleteAccountPanel.jsx),
    [`DeleteAccountSection.jsx`](../../mobile/src/components/DeleteAccountSection.jsx)),
    with a dedicated backend suite
    ([`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py)).
    This is the App Store / Play requirement. **But see
    [2.1](#21-a-deleted-accounts-seat-becomes-an-anonymous-playable-guest-seat)**
    — the feature opened a permission hole.
12. **List endpoints are paginated** — `BareListPagination`
    ([`views.py:40–62`](../../backend/game/views.py)), 100/page, `?page_size=` up
    to 200. It returns a **bare JSON array, not DRF's
    `{count, next, previous, results}` envelope**, deliberately: both clients
    `.map()` over the response and an envelope would break the lobby on web and
    silently empty it on mobile.
13. **Auth endpoints are throttled.** Global anon/user rates plus scoped limits
    on login (`10/hour`), register (`5/hour`), and refresh (`60/hour`)
    ([`settings.py:201–224`](../../backend/backgammon/settings.py);
    `LoginView` / `RegisterView` / `RefreshView`,
    [`views.py:90–120`](../../backend/game/views.py)). `OptionalScopedRateThrottle`
    treats a missing rate as unthrottled instead of a 500, and reads
    `api_settings` live so the rates are testable. Rates are auto-disabled under
    `manage.py test`. **Caveat: the counters are per-process — see
    [2.3](#23-throttle-counters-are-per-process).**
14. **Refresh tokens rotate and are revocable.** `token_blacklist` in
    `INSTALLED_APPS` ([`settings.py:83`](../../backend/backgammon/settings.py)),
    `ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION`
    ([`settings.py:226–233`](../../backend/backgammon/settings.py)).
15. **Logging is configured** — console handler, `LOG_LEVEL` env var, and
    `django.request` pinned to WARNING outside dev so the suite stays readable
    ([`settings.py:261–302`](../../backend/backgammon/settings.py)).
16. **The web build can reach a remote API.** `REACT_APP_API_BASE_URL` +
    `apiUrl()` ([`frontend/src/api/config.js`](../../frontend/src/api/config.js)),
    used by `apiClient.js` **and** by the raw refresh `fetch` in `authApi.js`
    that bypasses it. [`frontend/.env.example`](../../frontend/.env.example)
    documents it, with tests in `api/__tests__/config.test.js`.
17. **The mobile build can reach a remote API, and fails loudly if it can't.**
    `resolveApiConfig` ([`mobile/src/api/config.js:58–127`](../../mobile/src/api/config.js))
    implements the documented precedence chain, rejects relative URLs, rejects
    plaintext `http://` in release builds (iOS ATS / Android
    `usesCleartextTraffic`), and surfaces a configuration error instead of
    silently pointing at loopback. `assertApiConfigured()` routes the failure
    into the UI's normal error path.
18. **CI exists.** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
    runs backend / web / mobile as three jobs on every push and PR, with
    concurrency cancellation and the correct per-suite invocation (`npm test --`
    for CRA, bare `npx jest` for Expo — swapping them fails confusingly).
19. **Legal drafts written** — [`privacy-policy.md`](../legal/privacy-policy.md),
    [`terms-of-service.md`](../legal/terms-of-service.md), and a
    [README](../legal/README.md) listing what stands between drafts and
    publication. Honest about what the app actually collects. Publishing them is
    owner work ([1.5](#15-publish-the-legal-documents)).
