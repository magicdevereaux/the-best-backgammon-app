# Going Live — Production-Readiness Audit

An honest audit of what stands between the current tree and a deployed backend +
a shipped web app + a store-approved mobile app.

> **Ground rule:** this doc describes the code **as it is today**. Every item
> cites the file and line it was found in. Nothing here is speculative, and
> nothing is marked done that wasn't read back out of the tree.

Re-audited **2026-08-02** against HEAD `a5bd752`, after six further commits closed
the last of the substantial code work: match-list scoping, the password-reset
client UI at both ends, the `abandon` control on both clients, and the
generalisation of the higher-die rule with a port into both JS engines. Line
numbers in `views.py` moved and were re-read for this pass; `settings.py`,
`serializers.py` and `models.py` are untouched since the previous audit, so their
citations below still hold as written.

## Current state

The original audit found 11 hard blockers. **All of them are closed**, and so is
nearly everything the later passes added. The backend is env-driven,
containerised, throttled, cache-configurable and Sentry-ready; it passes Django's
own deployment checks cleanly and CI enforces that; both clients can be pointed
at a real API by configuration; both poll; both explain a seat closed by account
deletion *and* offer the way out of it; password reset now works end to end from
inside the apps; the rules engine matches the official higher-die rule in all
three copies; legal drafts exist.

What remains splits two ways, and only the first is substantial. **Decisions and
credentials only the owner can supply** ([section 1](#1-blocked-on-the-owner)) —
now the bulk of the remaining work, and it includes three subsystems that are
*coded and dormant*: `REDIS_URL`, `SENTRY_DSN` and the `EMAIL_*` vars are all read
by `settings.py` and set nowhere, so throttle counters are still per-worker, a 500
still notifies nobody, and reset mail still goes to Django's console backend.
**Real code gaps** ([section 2](#2-still-open-in-code)) are down to three, none of
them a bug: a deliberate design trade-off
([2.1](#21-guest-seats-are-unverifiable-by-design)), admin login hardening
([2.2](#22-django-admin-has-no-2fa-ip-allowlist-or-lockout) — the *path* is now
env-configurable, but 2FA, IP allowlist and lockout are all still absent), and
polish ([2.3](#23-polish-and-hygiene)). The third category the last pass needed —
server capabilities no client called — is **empty**: `abandon`, password reset
and the higher-die rule all have callers now.

Verified in the 2026-07-26 pass, by running it (settings are untouched since),
and now run on every push by CI ([3.26](#3-done)):

```
$ cd backend && DEBUG=False SECRET_KEY=<50-char random> ALLOWED_HOSTS=example.com \
    venv/Scripts/python.exe manage.py check --deploy
System check identified no issues (0 silenced).
```

Six warnings → zero. All three suites are green as of **2026-08-02**:
**backend 450**, **web 312**, **mobile 190** (952 total), and
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs each on every
push. The backend count moved from 441 in the previous pass: the `ADMIN_URL`
tests in [2.2](#22-django-admin-has-no-2fa-ip-allowlist-or-lockout) and the
transaction tests account for the difference.

Still true, and still good news: **no secrets are committed.** `git status`
shows no `.env`, and [`.gitignore`](../../.gitignore) covers `db.sqlite3`,
`venv/`, `.env`, `.env.production`, `secrets.json`, `*.pem` / `*.key`. The
`.env.example` files are placeholders with empty values.

**Order of operations from here.** There is no code work left standing between
the tree and a deploy, so every remaining step is infrastructure or paperwork.
(1) Owner provisions Postgres on Railway and sets the env vars
([section 1](#1-blocked-on-the-owner); runbook in
[railway-deploy.md](railway-deploy.md)) — and while in that tab, sets
`REDIS_URL`, `SENTRY_DSN` and the `EMAIL_*` / `FRONTEND_BASE_URL` values, which
cost nothing extra and switch on three subsystems that are otherwise inert.
**`FRONTEND_BASE_URL` graduated from theoretical to load-bearing this pass**: the
web client now actually serves `/reset-password/:uid/:token`, so a wrong value is
the difference between a working reset and a dead link.
(2) Deploy, smoke-test, turn on backups. (3) Build web with
`REACT_APP_API_BASE_URL`, build mobile with `EXPO_PUBLIC_API_URL`, test both off
the dev LAN. (4) Fill the legal `[TODO]`s, host the policy, submit.

The one item in [section 2](#2-still-open-in-code) worth attention *before* real
users arrive is [2.2](#22-django-admin-has-no-2fa-ip-allowlist-or-lockout). The
code half is done — the admin path is now the `ADMIN_URL` env var — so all that
is left there is **setting it to something unguessable at deploy time**, and then
deciding whether 2FA / an IP allowlist / `django-axes` are worth adding on top.
[2.1](#21-guest-seats-are-unverifiable-by-design) is a design trade-off, not a
defect, and [2.3](#23-polish-and-hygiene) is housekeeping.

---

## 1. Blocked on the owner

No coding session can close these. They need a decision, a credential, a
purchase, or a human signature. Everything here is *config-shaped* — the code
side is already built and waiting for the value.

### 1.1 Pick a host and provision PostgreSQL

> **Decided: Railway.** The step-by-step runbook — service creation, the
> Postgres plugin and `DATABASE_URL` reference, every env var, migrations,
> superuser, custom domain, and a first-deploy smoke test — is
> [railway-deploy.md](railway-deploy.md). [`railway.json`](../../railway.json)
> pins the Dockerfile builder and the `/healthz/` health check. **No deploy has
> run yet**, so everything below is still open; provisioning Postgres and
> supplying the values in [1.2](#12-domain-tls-and-the-production-environment)
> remains owner work.

The app is host-agnostic and ready to deploy: the root
[`Dockerfile`](../../Dockerfile) builds from the repo root, runs `collectstatic`
at build time, runs as a non-root user, has a `HEALTHCHECK` against `/healthz/`,
and starts `migrate && gunicorn`. [`Procfile`](../../Procfile) covers
Heroku-style hosts. Nothing host-specific is committed, on purpose.

`DATABASES` ([`settings.py:187–194`](../../backend/backgammon/settings.py)) reads
`DATABASE_URL` through `dj-database-url` and falls back to local SQLite;
`psycopg2-binary` is pinned in [`requirements.txt`](../../backend/requirements.txt).
The owner must provision a managed Postgres and set `DATABASE_URL`. The old
warning here — *"verify the migrations apply cleanly on an empty Postgres before
cutting over, they have only ever been run against SQLite"* — is **discharged as
of 2026-08-02**: all 34 migrations apply clean to an empty Postgres 16 and the
full backend suite passes there. Evidence, the compatibility audit, and the two
settings still to change at cutover (notably `DB_SSL_REQUIRE=True`) are in
[postgres-readiness.md](postgres-readiness.md).

### 1.2 Domain, TLS, and the production environment

Buy/point a domain and let the platform terminate TLS. The app already trusts
`X-Forwarded-Proto` and redirects to HTTPS when `DEBUG=False`
([`settings.py:355–375`](../../backend/backgammon/settings.py)).

Then set these on the host — **never in a committed file**. Full annotated list
in [`backend/.env.example`](../../backend/.env.example):

| Variable | Notes |
|---|---|
| `SECRET_KEY` | Required. Startup **fails loudly** without it when `DEBUG=False` ([`settings.py:116–127`](../../backend/backgammon/settings.py)). Generate fresh; never the committed dev key. |
| `DEBUG` | `False`. This one flag turns on the whole hardening block. |
| `ALLOWED_HOSTS` | The real hostname(s). Default is dev-only and includes a stale LAN IP ([`settings.py:132–137`](../../backend/backgammon/settings.py)). |
| `DATABASE_URL` | Postgres URL. |
| `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` | The web app's origin ([`settings.py:254–255`](../../backend/backgammon/settings.py)). Defaults are `http://localhost:3000`. |
| `SECURE_HSTS_SECONDS` | **Caution.** Defaults to 1 year *with* `includeSubDomains` and `preload`. Set it to `60` for the first deploys and ramp — HSTS is very hard to undo. |
| `THROTTLE_RATE_*` | Optional; defaults are sane. |
| `REDIS_URL` | **Optional, strongly recommended.** Unset → `LocMemCache`, so DRF's throttle counters are per gunicorn worker and reset on deploy. Set → `RedisCache` and the limits become global ([`settings.py:63–90, 196–204`](../../backend/backgammon/settings.py)). Provisioning is owner work; see [3.22](#3-done). |
| `SENTRY_DSN` | **Optional, strongly recommended.** Unset → `sentry_sdk.init()` is never called and a 500 reports nowhere. Set → errors ship, tagged by `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` ([`settings.py:445–473`](../../backend/backgammon/settings.py)). See [3.25](#3-done). |
| `ADMINS` | Optional. `Name <addr>` pairs, comma-separated; attaches Django's `mail_admins` handler to `django.request` ([`settings.py:429–443`](../../backend/backgammon/settings.py)). Needs `EMAIL_HOST` to actually send. |
| `EMAIL_HOST` + `EMAIL_PORT` / `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` / `EMAIL_USE_TLS` / `DEFAULT_FROM_EMAIL` | **Required for password reset to leave the box.** With `EMAIL_HOST` unset the backend is Django's **console** backend — the reset mail is printed to the log and never delivered ([`settings.py:317–345`](../../backend/backgammon/settings.py)). |
| `FRONTEND_BASE_URL` | The origin the reset link points at. Defaults to `http://localhost:3000`, which is wrong in production and silently so — the email will contain a link nobody can open ([`settings.py:348–352`](../../backend/backgammon/settings.py)). |

### 1.3 Store the mobile API URL and submission credentials

The mobile client resolves its backend by an explicit precedence chain and
**refuses to guess in a release build** ([`config.js:58–127`](../../mobile/src/api/config.js)):
`MANUAL_OVERRIDE` → `EXPO_PUBLIC_API_URL` → `expo.extra.apiUrl` → Metro `hostUri`
(dev only) → loopback (dev only). A non-`https://` URL in a release build is
reported as a configuration error rather than failing as an opaque network
timeout. The values it needs are blank and marked `OWNER TODO`:

- [`eas.json:46`](../../mobile/eas.json) — `preview.env.EXPO_PUBLIC_API_URL` (staging)
- [`eas.json:54`](../../mobile/eas.json) — `production.env.EXPO_PUBLIC_API_URL`
- [`app.json:59`](../../mobile/app.json) — `expo.extra.apiUrl` (fallback)
- [`eas.json:64`](../../mobile/eas.json) — `submit.production` is `{}`. iOS needs
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

They are **not publishable as-is**: **18 `[TODO]` placeholders in the privacy
policy and 14 in the terms** (counted 2026-08-02; the "20 and 15" in the previous
pass was stale) cover the legal entity name, contact email, dates,
jurisdiction and venue, hosting provider and log retention, minimum age,
GDPR/CCPA applicability, and the liability cap. A lawyer should read both. Then
host them at stable public URLs (Play additionally wants a web-accessible
account-deletion request URL) and link them from both clients and both store
listings.

> **Factual corrections applied 2026-08-02.** Three claims in the drafts had gone
> stale and were rewritten this pass:
>
> - The privacy policy said *"some game records can currently be modified or
>   deleted by any caller"*. **False** — both viewsets dropped `ModelViewSet`, so
>   PUT/PATCH/DELETE are off the routed surface and return 405 ([3.8](#3-done)).
>   Removed; the remaining, still-true disclosure is unauthenticated **read**.
> - Both drafts said *"there is no password reset"* and that no email is
>   collected. **False** — reset ships end to end ([3.23](#3-done),
>   [3.32](#3-done)) and `email` is an optional field on register and on
>   `PATCH /api/auth/me/`. Both now describe it, with the correct caveat that an
>   account with **no address on file** still cannot be recovered.
> - The earlier note here claimed the drafts still call account deletion
>   unimplemented. **That claim was itself stale** — the policy's "Account
>   deletion" section has described the shipped behaviour since 2026-07-26.
>   `docs/legal/README.md` has been reconciled to match.
>
> Still outstanding in the drafts: the `[TODO]` placeholders above, and the
> `[TODO — REQUIRED BEFORE STORE SUBMISSION]` notice on the deletion section,
> which waits on a hosted web-accessible deletion-request URL.

### 1.6 Backups, admin credentials, and the three dormant subsystems

- Enable the managed database's automated backups and **test a restore once**.
  Untested backups are not backups. Nothing in the repo can do this.
- **Set `ADMIN_URL`** to something unguessable, and choose a strong superuser
  password. The variable exists and defaults to `admin`, so leaving it unset ships
  the admin at the path every scanner already probes. See
  [2.2](#22-django-admin-has-no-2fa-ip-allowlist-or-lockout) for what this does
  and does not buy, and decide there whether you also want 2FA, an IP allowlist,
  or `django-axes`.
- **Sentry.** The code side is done — `sentry-sdk[django]` is pinned and
  initialised the moment `SENTRY_DSN` is non-empty ([3.25](#3-done)). Create the
  project, paste the DSN. Until then a 500 still notifies nobody.
- **Redis.** Same shape: `CACHES` switches to `RedisCache` on `REDIS_URL` and the
  `redis` client is pinned ([3.22](#3-done)). Add the platform's Redis plugin and
  reference its URL, or accept per-worker throttle counters.
- **An outbound mail route.** Password reset is built and tested on the server
  ([3.23](#3-done)) and reachable from both clients ([3.32](#3-done)), but it
  ships nothing without `EMAIL_HOST` — with it unset, Django's console backend
  prints the reset link to the deploy log. **This is now the only thing standing
  between a locked-out user and their account**, since the client half is done.
  Pick any SMTP-speaking provider (SES, Postmark, Resend, Mailgun), set the
  `EMAIL_*` vars, and set `FRONTEND_BASE_URL` to the web client's origin — the
  link is served by the web router and by nothing else, so a wrong value produces
  mail nobody can act on.

### 1.7 Link the EAS update channels so OTA actually publishes

**The build-side half of OTA is done and the publish-side half is not.**
`expo-updates` is installed ([`mobile/package.json:14`](../../mobile/package.json)),
[`app.json:8–10, 36–41`](../../mobile/app.json) carries a `runtimeVersion` policy
of `appVersion` and an `updates` block pointing at the committed project id, and
[`eas.json`](../../mobile/eas.json) declares `preview` / `production` channels —
see [3.27](#3-done).

What is missing needs an EAS account, so no coding session can do it: run
`eas update:configure`, create the branches, link `production` → `production` and
`preview` → `preview`, and publish once with `eas update --branch production`.
**Until that runs, both channels remain inert and every JS fix still needs a full
store resubmission** — which is the whole cost the install was meant to remove.
Marked `OWNER TODO` in both `eas.json` and `app.json`.

Also remember what the `appVersion` policy implies: an update only reaches
binaries built from the *same* `expo.version`, so any native change (new native
module, SDK bump, config plugin) must bump `app.json`'s `version` and ship a new
store build rather than an OTA.

---

## 2. Still open in code

Three items, and none of them is a bug. What used to live here — match-list
scoping, the password-reset client, the missing `abandon` caller, the
bear-off-only higher-die rule — is in [section 3](#3-done) now.

### 2.1 Guest seats are unverifiable by design

A seat with a null user FK **and no closure flag** has no server identity to
check, so anonymous requests on it are allowed — see the policy docstring at
[`views.py:420–472`](../../backend/game/views.py). This is what keeps
hotseat/guest play working without an account, and it is a deliberate,
documented trade-off rather than an oversight. It used to be the mechanism a
deleted account's orphaned seat fell through; that path is now closed
([3.20](#3-done)), and what remains is the original, intended hole: a genuine
guest seat is playable by whoever holds the game id.

The same null-FK-means-guest rule is now load-bearing in **both** list-scoping
rules: the "fully-guest" disjunct of `_list_scope_q` ([3.21](#3-done)) and the
matching one in `_match_list_scope_q` ([3.31](#3-done)) keep hotseat resume
working precisely because such rows carry no account-linked identity to scope by.
Closing this gap would let both clauses be tightened.

**Fix (larger).** A guest token minted at game creation and stored client-side,
checked alongside the user FK. Not required for launch; required before anyone
plays for anything that matters.

### 2.2 Django admin has no 2FA, IP allowlist, or lockout

**Partially closed.** The *path* is no longer hard-coded:
[`backgammon/urls.py`](../../backend/backgammon/urls.py) mounts the admin at
`settings.ADMIN_URL`, read from the `ADMIN_URL` env var via `env_url_path` in
[`settings.py`](../../backend/backgammon/settings.py) and defaulting to `"admin"`
so local dev still needs no `.env`. Slashes are stripped, and a blank or
slash-only value falls back to the default rather than mounting the admin at the
site root. Covered by `AdminUrlConfigTest` in
[`test_hardening.py`](../../backend/game/tests/test_hardening.py). Documented in
[`.env.example`](../../backend/.env.example).

Be clear about what that buys: **obscurity, not security**. It takes the login
form out of the reach of the bots that probe `/admin/` all day, which is worth
having, and it does nothing at all against anyone who learns the path. Setting a
real value is now [owner work](#16-backups-admin-credentials-and-the-three-dormant-subsystems),
not code work.

**Still open, and unchanged:**

- **No 2FA** on the admin login.
- **No IP allowlist** and no auth proxy in front of it.
- **No lockout** — `django-axes` or equivalent is not installed.
- **DRF throttles still do not cover it.** The admin login is a plain Django
  view, so the `login` scope
  ([`LoginView`, `views.py:102–111`](../../backend/game/views.py)) protects
  `/api/auth/login/` only. An unmoved, unthrottled admin form is unlimited
  password guessing.

Admin compromise is still total compromise, so set `ADMIN_URL` at deploy time and
treat the four items above as the real fix.

### 2.3 Polish and hygiene

- **Password reset finishes in a browser on mobile.** The client half shipped
  ([3.32](#3-done)) but only three quarters of it: mobile can *request* a reset
  (`requestPasswordReset`, [`mobile/src/api/auth.js:93`](../../mobile/src/api/auth.js),
  reachable from the login screen's "Forgot password?" mode) and it can *set* an
  email, but there is **no mobile route for the link itself**. `mobile/app/` holds
  `_layout` / `index` / `login` / `profile` / `game/[id]` and nothing else, and
  `build_password_reset_url` ([`views.py:282–296`](../../backend/game/views.py))
  builds the link from `FRONTEND_BASE_URL` — the **web** origin — so a mobile user
  who taps it lands in a browser and finishes there. The screen says so out loud
  ("The link opens in your browser",
  [`mobile/app/login.jsx:69–72`](../../mobile/app/login.jsx)), which makes it
  honest rather than broken, and it costs nothing at launch because the reset
  itself completes and the new password works in the app. **Fix (not a
  one-liner):** a `mobile/app/reset-password/[uid]/[token].jsx` route, *plus* a
  way for the mail to address it — either the `backgammon://` scheme already
  declared at [`app.json:5`](../../mobile/app.json) (which would need a second
  server-side link setting, since `FRONTEND_BASE_URL` is a single value) or a
  proper universal-link / app-link setup so the web URL opens the app when it is
  installed. Neither exists today.
- ~~**Tracked scratch files.**~~ **Closed 2026-08-02.** `mobile/MOBILE_PROGRESS.md`
  and `mobile/.claude/settings.json` were removed from the index with
  `git rm --cached` (both still exist on disk) and
  [`.gitignore`](../../.gitignore) now carries `**/.claude/settings.json`,
  `**/.claude/settings.local.json` and `mobile/MOBILE_PROGRESS.md`. Note the
  patterns are deliberately narrow: `.claude/skills/` stays **tracked**, because
  the `railway-deploy` skill lives there and is meant to be shared.
- **Mobile version numbers.** [`app.json`](../../mobile/app.json) declares
  `version 1.0.0` / `buildNumber "1"` / `versionCode 1`, but
  [`eas.json:28`](../../mobile/eas.json) sets `"appVersionSource": "remote"` with
  `autoIncrement` on production — EAS, not the file, owns build numbers. Harmless
  once you know which is authoritative, and note `runtimeVersion` deliberately
  does *not* depend on those values ([1.7](#17-link-the-eas-update-channels-so-ota-actually-publishes)).
- **No OG image or absolute `og:url`.** The page metadata that shipped
  ([3.29](#3-done)) deliberately omits both, because each needs an absolute URL
  and no domain exists yet. Until they are added a shared game link previews as
  title + description with no image. The exact tags to add, and the 1200×630
  `og.png` they need, are spelled out in an `OWNER TODO` comment in
  [`frontend/public/index.html`](../../frontend/public/index.html) (still present,
  re-read this pass). Same comment notes the missing PNG/ICO favicon fallback and
  the 192/512px manifest icons.
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
   ([`settings.py:116–127`](../../backend/backgammon/settings.py)); `DEBUG`,
   `ALLOWED_HOSTS`, `DATABASE_URL`, CORS/CSRF origins, throttle rates, HSTS, and
   log level all read via `env_bool` / `env_list` helpers. `python-dotenv` loads
   an optional `backend/.env`. **Local dev still needs no `.env` at all** —
   every default is the previous hardcoded value.
2. **`check --deploy` is clean.** Zero issues with `DEBUG=False`, down from six.
   The whole `SECURE_*` block — SSL redirect, proxy SSL header, HSTS with
   subdomains + preload, secure session/CSRF cookies, nosniff, referrer policy,
   `X_FRAME_OPTIONS = DENY` — is gated on `not DEBUG`
   ([`settings.py:355–375`](../../backend/backgammon/settings.py)), with
   `/healthz/` exempted from the HTTPS redirect for in-network probes.
3. **Dependencies pinned and production-complete.**
   [`requirements.txt`](../../backend/requirements.txt) pins exact versions and
   adds `gunicorn`, `whitenoise`, `dj-database-url`, `psycopg2-binary`,
   `python-dotenv`.
4. **Postgres is a config change, not a code change** — `DATABASE_URL` via
   `dj-database-url` with `conn_max_age`, health checks, and optional SSL
   ([`settings.py:187–194`](../../backend/backgammon/settings.py)). (Provisioning
   is still owner work — [1.1](#11-pick-a-host-and-provision-postgresql).)
5. **Static files work.** `STATIC_ROOT`, WhiteNoise middleware immediately after
   `SecurityMiddleware`, and `CompressedManifestStaticFilesStorage` outside
   `DEBUG` ([`settings.py:149–153, 222–245`](../../backend/backgammon/settings.py)).
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
   ([`views.py:652–657`](../../backend/game/views.py),
   [`views.py:809–814`](../../backend/game/views.py)), so `PUT`/`PATCH`/`DELETE`
   on games and matches are 405 rather than unguarded. Covered by
   `WriteVerbsRemovedTest` in
   [`test_hardening.py`](../../backend/game/tests/test_hardening.py).
9. **`next_game` is permission-checked** — `_match_permission_error`
   ([`views.py:473–512`](../../backend/game/views.py)), called before any state
   check, with the participant/stranger/anonymous matrix tested.
10. **Registration runs `AUTH_PASSWORD_VALIDATORS`.** `RegisterSerializer.validate`
    ([`serializers.py:250–270`](../../backend/game/serializers.py)) calls
    `password_validation.validate_password` with a `User(username=...)` so the
    similarity validator works, and re-raises as a DRF field error. `"password"`
    and `"12345678"` are now rejected.
11. **Account deletion exists, end to end.** `DELETE /api/auth/me/`
    ([`MeView`, `views.py:211–270`](../../backend/game/views.py)) requires the
    account's own password, blacklists every outstanding refresh token
    (`_blacklist_refresh_tokens`), purges unjoined lobby adverts, and anonymises
    rather than cascades game history. UI on both clients
    ([`DeleteAccountPanel.jsx`](../../frontend/src/components/DeleteAccountPanel.jsx),
    [`DeleteAccountSection.jsx`](../../mobile/src/components/DeleteAccountSection.jsx)),
    with a dedicated backend suite
    ([`test_account_deletion.py`](../../backend/game/tests/test_account_deletion.py)).
    This is the App Store / Play requirement. The permission hole it originally
    opened is closed — see [3.20](#3-done).
12. **List endpoints are paginated** — `BareListPagination`
    ([`views.py:52–75`](../../backend/game/views.py)), 100/page, `?page_size=` up
    to 200. It returns a **bare JSON array, not DRF's
    `{count, next, previous, results}` envelope**, deliberately: both clients
    `.map()` over the response and an envelope would break the lobby on web and
    silently empty it on mobile.
13. **Auth endpoints are throttled.** Global anon/user rates plus scoped limits
    on login (`10/hour`), register (`5/hour`), refresh (`60/hour`), and — added
    with the reset flow — `password_reset` (`5/hour`) and
    `password_reset_confirm` (`20/hour`)
    ([`settings.py:268–305`](../../backend/backgammon/settings.py);
    `LoginView` / `RegisterView` / `RefreshView` /
    `PasswordResetRequestView` / `PasswordResetConfirmView`,
    [`views.py:102–147`, `:327–391`](../../backend/game/views.py)).
    `OptionalScopedRateThrottle` treats a missing rate as unthrottled instead of
    a 500, and reads `api_settings` live so the rates are testable. Rates are
    auto-disabled under `manage.py test`. **Caveat: with no `REDIS_URL` set the
    counters are still per-process — see [3.22](#3-done).**
14. **Refresh tokens rotate and are revocable.** `token_blacklist` in
    `INSTALLED_APPS` ([`settings.py:144`](../../backend/backgammon/settings.py)),
    `ROTATE_REFRESH_TOKENS` + `BLACKLIST_AFTER_ROTATION`
    ([`settings.py:307–314`](../../backend/backgammon/settings.py)).
15. **Logging is configured** — console handler, `LOG_LEVEL` env var, and
    `django.request` pinned to WARNING outside dev so the suite stays readable
    ([`settings.py:380–421`](../../backend/backgammon/settings.py)).
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
    for CRA, bare `npx jest` for Expo — swapping them fails confusingly). It has
    since grown a deployment check and a production web build — [3.26](#3-done).
19. **Legal drafts written** — [`privacy-policy.md`](../legal/privacy-policy.md),
    [`terms-of-service.md`](../legal/terms-of-service.md), and a
    [README](../legal/README.md) listing what stands between drafts and
    publication. Honest about what the app actually collects. Publishing them is
    owner work ([1.5](#15-publish-the-legal-documents)).
20. **A deleted account's seat no longer becomes an anonymous-playable guest
    seat.** This was the audit's one live security hole: `on_delete=SET_NULL`
    anonymised the seat, and a null FK is exactly how the permission helpers
    recognise a *guest* seat, so deleting your account handed every unfinished
    game you were in to whoever knew the id. Closed in `7a8bab9` by adding the
    missing bit of state. `player1_deleted` / `player2_deleted` — a
    `BooleanField(default=False)` on **both** `Game`
    ([`models.py:56–57`](../../backend/game/models.py)) and `Match`
    ([`models.py:19–20`](../../backend/game/models.py)), migration
    [`0004_game_player1_deleted_game_player2_deleted_and_more.py`](../../backend/game/migrations/0004_game_player1_deleted_game_player2_deleted_and_more.py)
    — are set by `_close_deleted_account_seats`
    ([`views.py:186–210`](../../backend/game/views.py)), which runs *before*
    `user.delete()` ([`views.py:265–266`](../../backend/game/views.py)) while the
    rows are still reachable by user. Null FK **+ flag** = closed; null FK **+ no
    flag** = genuine guest, unchanged.

    Four call sites consume it. `_seat_permission_error` refuses a closed seat
    before any other branch ([`views.py:456–457`](../../backend/game/views.py)),
    and refuses **everyone** — the surviving opponent included, since they
    satisfy `is_participant` on the orphaned seat and could otherwise play both
    sides. `_match_permission_error`'s anonymous fallback now requires a seat
    that is null **and not closed**
    ([`views.py:505–511`](../../backend/game/views.py)), so `next_game` no longer
    opens to anonymous callers. `next_game` copies both flags onto the game it
    creates ([`views.py:761–762`](../../backend/game/views.py)), or the closure
    would evaporate at the next game boundary. Both flags are **read-only** in
    `GameSerializer` and `MatchSerializer`
    ([`serializers.py:41–52`](../../backend/game/serializers.py),
    [`serializers.py:78–86`](../../backend/game/serializers.py)) — writable, a
    caller could close a seat at creation and grief the other player.

    Covered by `DeletedSeatIsClosedTest` and `SeatClosedFieldDefaultsTest`
    ([`test_account_deletion.py:335`, `:578`](../../backend/game/tests/test_account_deletion.py)),
    which assert 403 for anonymous `roll_dice` / `confirm_turn` /
    `offer_double` / `respond_to_double` / `next_game` on a closed seat, that a
    real guest seat still plays anonymously, and that rows written without the
    fields stay open. (The original pass also asserted it for `move_checker`;
    that endpoint has since been deleted — [3.30](#3-done) — and the assertion
    went with it.) **Its deliberate cost was the deadlock now handled by
    [3.24](#3-done), and that item's client residue is closed too —
    [3.33](#3-done).**

21. **`GET /api/games/` no longer enumerates the whole table.** `_list_scope_q`
    ([`views.py:514–556`](../../backend/game/views.py)) unions three disjuncts —
    open lobby games with neither seat closed, games either of whose seat FKs is
    the requester, and fully-guest games (both FKs null, neither flagged) — and
    `GameViewSet.get_queryset` applies it **to the `list` action only**
    ([`views.py:838–845`](../../backend/game/views.py)).

    **Read the scope of the fix precisely: it bounds *enumeration*, not
    *access*.** `retrieve` by id is still open to everyone, deliberately —
    joining an online game is done by sharing its link or code, and gating
    retrieve would break the only pairing mechanism the app has. What changed is
    that a stranger must now *know* an id instead of paging the table for them.
    The deliberate cost is on the `list` side too: in a mixed game (one guest
    seat, one registered seat) past `waiting`, the guest can no longer find the
    row in the list and needs the id — nothing better is possible without a guest
    identity ([2.1](#21-guest-seats-are-unverifiable-by-design)). Tested in
    [`test_game_list_scoping.py`](../../backend/game/tests/test_game_list_scoping.py).
    The bare-array response shape is unchanged, so both clients' `.map()` still
    works. **`GET /api/matches/` has since had the same treatment — see
    [3.31](#3-done).**
22. **A shared throttle cache is now configurable — but not provisioned, so the
    per-process fallback is still what runs.** `CACHES` is built by
    `cache_settings(REDIS_URL)`
    ([`settings.py:63–90, 196–204`](../../backend/backgammon/settings.py)):
    `REDIS_URL` set selects `django.core.cache.backends.redis.RedisCache` with a
    `backgammon` key prefix; unset gives `LocMemCache`. The `redis` client is
    pinned in [`requirements.txt`](../../backend/requirements.txt).

    **Nothing sets `REDIS_URL` anywhere today** — not in the repo, and there is
    no deployment to set it in — so every environment, including a future first
    Railway deploy, still gets `LocMemCache`. Until the owner provisions Redis
    and sets the var ([1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems)),
    the original problem is unchanged in practice: DRF's throttle counters live
    in each gunicorn worker (`--workers 3` by default in both the `Dockerfile`
    and the `Procfile`), so `login` at 10/hour behaves like ~30/hour and every
    counter resets on deploy. What closed is the *code* gap; the operational one
    is now one env var away.
23. **Password reset exists end to end on the server, and accounts can carry an
    email.** `RegisterSerializer.email` is optional and blank-tolerant
    ([`serializers.py:240`](../../backend/game/serializers.py)) so existing
    username+password registration is unchanged, and `PATCH /api/auth/me/` can
    add one later ([`MeView`, `views.py:211–270`](../../backend/game/views.py);
    `UserSerializer` marks every field but `email` read-only). `POST
    /api/auth/password-reset/` ([`views.py:327–364`](../../backend/game/views.py))
    mails `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`
    ([`build_password_reset_url`, `views.py:282–296`](../../backend/game/views.py))
    and `POST /api/auth/password-reset/confirm/`
    ([`views.py:367–391`](../../backend/game/views.py)) sets the new password and
    blacklists the account's outstanding refresh tokens — without that, a reset
    prompted by a compromise would leave the attacker's session alive. Both are
    wired in [`urls.py:25–26`](../../backend/game/urls.py) and throttled on their
    own scopes (`password_reset` 5/hour, `password_reset_confirm` 20/hour,
    [`settings.py:276–288`](../../backend/backgammon/settings.py)). The request
    endpoint returns **one fixed 200 body for hits and misses alike**, so it
    cannot be used as a membership oracle, and send failures are swallowed and
    logged for the same reason. Covered by
    [`test_password_reset.py`](../../backend/game/tests/test_password_reset.py).

    > **This was only the server half when it landed.** The client half has since
    > shipped on both clients — [3.32](#3-done) — so the flow is now reachable
    > end to end. What is still missing is operational, not code: with
    > `EMAIL_HOST` unset the mail goes to Django's console backend
    > ([1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems)).
24. **A closed seat is now explained by both clients, and the server offers an
    exit.** The deadlock itself is unchanged and still deliberate (it beats
    inventing a forfeit result — see [3.20](#3-done)); what was missing was
    telling the player and letting them out.

    Both clients read `player1_deleted` / `player2_deleted` through parallel
    helpers — [`frontend/src/utils/seats.js:12–42`](../../frontend/src/utils/seats.js)
    and [`mobile/src/game/gating.js:30–62`](../../mobile/src/game/gating.js), kept
    identical deliberately — which name the seat that owes the next action (the
    *responder* while a double is pending, otherwise `current_turn`, exactly as
    `respond_to_double` and `abandon` compute it). When it is closed, the turn
    banner is replaced with "your opponent deleted their account — this game can't
    continue" ([`GamePage.jsx:100–129`](../../frontend/src/pages/GamePage.jsx),
    [`app/game/[id].jsx:190–196`](../../mobile/app/game/[id].jsx)), and the
    survivor and a spectator read different sentences — web decides that from the
    server's `viewer_seat`, mobile from its device-local seat registry, because
    that is the ownership signal each one has. **Both pollers stop** rather than
    hammering a game nobody can advance
    ([`frontend/src/hooks/useGame.js:68–99`](../../frontend/src/hooks/useGame.js),
    [`mobile/src/game/useGame.js:136–155`](../../mobile/src/game/useGame.js)).

    `POST /api/games/{id}/abandon/`
    ([`views.py:1161–1244`](../../backend/game/views.py)) gives the survivor a
    non-scoring way out: it requires the game to be `active`, the blocked seat to
    be closed, and the caller to satisfy `_seat_permission_error` **for the
    surviving seat**; it then finishes the game with `winner=None`,
    `win_type="abandoned"`, `points_value=0`, and finishes the match without
    touching either score — leaving the match open would let the survivor mint an
    endless series of games that `next_game` stamps dead on arrival. If both
    seats are closed nobody can abandon, which is correct. Covered by
    [`test_abandon.py`](../../backend/game/tests/test_abandon.py).
    **Both clients call it now — [3.33](#3-done).**
25. **Error monitoring is wired — but no DSN is configured, so nothing reports
    today.** `sentry-sdk[django]` is pinned
    ([`requirements.txt`](../../backend/requirements.txt), with `certifi` for its
    transport) and `sentry_sdk.init()` runs **only** when `SENTRY_DSN` is
    non-empty and not under test
    ([`settings.py:93–109, 445–473`](../../backend/backgammon/settings.py)), with
    `send_default_pii=False` so usernames, IPs and request bodies never leave the
    box by default, and `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` /
    `SENTRY_TRACES_SAMPLE_RATE` as the tuning knobs. Separately, `ADMINS`
    (comma-separated `Name <addr>`) attaches Django's `mail_admins` handler to
    the `django.request` logger
    ([`settings.py:429–443`](../../backend/backgammon/settings.py)).

    **Neither is set anywhere**, and `mail_admins` additionally needs an
    `EMAIL_HOST`, so **a 500 still notifies nobody**. The code gap is closed; the
    account and the DSN are owner work
    ([1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems)).
26. **CI runs `check --deploy` and the production web build.**
    [`ci.yml:57–70`](../../.github/workflows/ci.yml) runs
    `manage.py check --deploy --fail-level WARNING` with `DEBUG=False`,
    `ALLOWED_HOSTS=example.com` and a per-run throwaway `SECRET_KEY` — the fail
    level is load-bearing, since `--deploy` reports its findings as `W0xx`
    warnings and would otherwise exit 0 with them buried in the log.
    [`ci.yml:102–111`](../../.github/workflows/ci.yml) adds `npm run build` under
    `CI=true`, where react-scripts promotes build warnings to errors, catching
    build-only breakage that the looser test transform never sees. The stale
    comment claiming "the env var contract doesn't exist in the repo yet" is
    gone.
27. **`expo-updates` is installed and the runtime version policy is set.**
    `expo-updates@~56.0.23` ([`mobile/package.json:14`](../../mobile/package.json),
    resolved by `npx expo install` against the installed SDK rather than a bare
    `npm install`), plus `runtimeVersion: {policy: "appVersion"}` and an
    `updates` block pointing at the already-committed project id
    ([`app.json:8–10, 36–41`](../../mobile/app.json)). `appVersion` rather than
    `nativeVersion` because `eas.json` sets `appVersionSource: "remote"`, so EAS
    owns `buildNumber`/`versionCode` and a policy folding those in would compute
    a runtime version that never matches what EAS built.

    **The channels are still inert.** `eas update:configure` has not been run and
    no EAS branch is linked to either channel, so nothing can be published and
    every JS fix still needs a store resubmission. That half needs an EAS
    account — [1.7](#17-link-the-eas-update-channels-so-ota-actually-publishes).
28. **The web client polls for opponent moves.** `useGame` runs a 3.5s interval
    ([`frontend/src/hooks/useGame.js:21, 86–99`](../../frontend/src/hooks/useGame.js)),
    matching mobile. It skips a tick whenever the local player has staged moves
    (a refresh must never clobber a turn in progress), when the game is
    `finished`, when it is deadlocked on a closed seat, and entirely for hotseat
    games where this device is the only thing that can change the board; only
    state whose `updated_at` actually changed is swapped in, so a stream of
    identical responses causes no re-render. Web online play is therefore no
    longer the doubly-degraded path it was — **client-side turn gating is still
    mobile-only**, so an out-of-turn web click still surfaces as the server's
    403. Real-time push remains **Planned** (see [CLAUDE.md](../../CLAUDE.md)).
29. **The web app has page metadata.** [`frontend/public/`](../../frontend/public/)
    now holds `favicon.svg`, `manifest.json` and `robots.txt` alongside
    `index.html`, which carries a real `<title>`, a `<meta name="description">`,
    a `theme-color` matching the app's background, and Open Graph + Twitter card
    tags. `og:url` and `og:image` are **deliberately absent**: both require an
    absolute URL, no domain has been chosen, and a relative `og:image` produces
    no preview at all while looking done. The exact tags to add later are in an
    `OWNER TODO` comment in the file — see
    [2.3](#23-polish-and-hygiene).
30. **`move_checker` is gone.** The endpoint was dead API surface — no client
    ever called it, and both clients drive the staging → `confirm_turn` flow —
    so the DRF action, its web API wrapper and its endpoint-only tests were
    deleted rather than left as attack surface for zero benefit.
    `GameViewSet`'s routed actions are now `roll_dice` / `confirm_turn` / `join`
    / `offer_double` / `respond_to_double` / `abandon`
    ([`views.py:817–822`](../../backend/game/views.py)), and a grep for
    `move_checker` across `backend/`, `frontend/src`, `mobile/src` and
    `mobile/app` returns nothing. Rules coverage was preserved: the tests that
    happened to exercise engine behaviour *through* the endpoint were repointed
    at `confirm_turn` rather than deleted, which is why the backend suite fell
    only from 421 to 412.
31. **`GET /api/matches/` no longer enumerates the whole table either.** The
    unfinished half of [3.21](#3-done) is closed: `_match_list_scope_q`
    ([`views.py:559–604`](../../backend/game/views.py)) is applied by
    `MatchViewSet.get_queryset` **to the `list` action only**
    ([`views.py:676–680`](../../backend/game/views.py)), which was a bare
    `Match.objects.all()` before. The exposure it shuts is the one the `Game`
    fix shut: `AllowAny` plus `fields = "__all__"`
    ([`serializers.py:74–88`](../../backend/game/serializers.py)) handed an
    anonymous caller `player1_user` / `player2_user` ids, both display names,
    both scores, `target_points`, status and timestamps for every row, 100 at a
    time via `?page=N`.

    **The rule has two clauses, not three, and the missing one was omitted on
    purpose.** Fully-guest matches (both FKs null, neither seat closed) stay
    visible so hotseat resume works; your own matches (either FK is you) stay
    visible whatever the status. There is **no public-lobby clause**, because a
    match has no lobby state — `Match.status` is only `active`/`finished`
    ([`models.py:24–28`](../../backend/game/models.py)), with no `waiting`
    analogue to `Game.status`. Open matches are advertised through their *first
    game*, which sits in the games lobby carrying a `match` id, so the lobby
    already works without listing matches at all. A "`player2_name` is blank"
    clause was considered and **rejected**: joinability is the only thing it
    would express, and it would re-expose precisely the registered-player rows
    this fix closes. `retrieve` by id stays open, exactly as for games — sharing
    a match by link/code is how an online match is joined and resumed, and both
    clients fetch a match by id. This bounds *enumeration*, not access. Covered
    by [`test_match_list_scoping.py`](../../backend/game/tests/test_match_list_scoping.py).
32. **Password reset is reachable from both clients, and both can supply an
    email.** The server half ([3.23](#3-done)) had no caller; it has three now.

    - **Email collection.** Both register forms take an optional email
      ([`RegisterPage.jsx:61–72`](../../frontend/src/pages/RegisterPage.jsx),
      [`mobile/app/login.jsx:128–145`](../../mobile/app/login.jsx)) and both
      profile screens can add or change one afterwards
      ([`EmailSettings.jsx`](../../frontend/src/components/EmailSettings.jsx) via
      `ProfilePage`, [`EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx)
      via `mobile/app/profile.jsx`), through `updateEmail`
      ([`authApi.js:105`](../../frontend/src/api/authApi.js),
      [`mobile/src/api/auth.js:74`](../../mobile/src/api/auth.js)) →
      `PATCH /api/auth/me/`. It stays **optional** on purpose: an account with no
      address simply has no recovery, which is the trade a guest-first app should
      let people make.
    - **Requesting a link.** Web has `/forgot-password`
      ([`ForgotPasswordPage.jsx`](../../frontend/src/pages/ForgotPasswordPage.jsx)),
      linked from the login form
      ([`LoginPage.jsx:62`](../../frontend/src/pages/LoginPage.jsx)); mobile has a
      third mode on its login screen behind "Forgot password?"
      ([`mobile/app/login.jsx:64–102, 157–161`](../../mobile/app/login.jsx)). Both
      render the server's fixed reply verbatim and **never branch on found vs not
      found**, preserving the endpoint's anti-enumeration property.
    - **Completing it.** Web routes `/reset-password/:uid/:token`
      ([`App.jsx:53`](../../frontend/src/App.jsx) →
      [`ResetPasswordPage.jsx`](../../frontend/src/pages/ResetPasswordPage.jsx)),
      matching `build_password_reset_url` exactly; a rejected token offers a link
      back to `/forgot-password` rather than a dead end.

    Wrappers are `requestPasswordReset` / `confirmPasswordReset`
    ([`authApi.js:140, 163`](../../frontend/src/api/authApi.js)) and
    `requestPasswordReset` ([`mobile/src/api/auth.js:93`](../../mobile/src/api/auth.js)).
    **Two residues, both in [2.3](#23-polish-and-hygiene):** the emailed link
    points at `FRONTEND_BASE_URL` — the *web* origin — and mobile has no route for
    it, so a mobile user finishes the reset in a browser (the screen says so); and
    nothing leaves the box at all until the owner sets `EMAIL_HOST`
    ([1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems)).
33. **Both clients call `abandon`.** The endpoint shipped with no caller
    ([3.24](#3-done)); the survivor of a deleted-account deadlock now has a
    button. Web wraps it as `abandonGame`
    ([`gameApi.js:61`](../../frontend/src/api/gameApi.js)) and mobile as the same
    ([`mobile/src/api/games.js:54`](../../mobile/src/api/games.js)), both routed
    through the game hook so the 200 response replaces local state without a
    refetch ([`frontend/src/hooks/useGame.js:251`](../../frontend/src/hooks/useGame.js),
    [`mobile/src/game/useGame.js:333`](../../mobile/src/game/useGame.js)).

    **The control renders for the surviving seat only**, on both clients, via a
    `canAbandon` predicate ([`frontend/src/utils/seats.js:64`](../../frontend/src/utils/seats.js),
    [`mobile/src/game/gating.js:117`](../../mobile/src/game/gating.js)) — so a
    spectator, the closed seat's own viewpoint, and the both-seats-closed case all
    come back false, and the panel appears only alongside the deadlock banner
    ([`GamePage.jsx:148`](../../frontend/src/pages/GamePage.jsx),
    [`mobile/app/game/[id].jsx:219`](../../mobile/app/game/[id].jsx)).

    **The two predicates answer "is that seat yours?" differently, and have to.**
    Mobile consults its device-local seat registry (`mySeats.includes(surviving)`);
    web has no such registry, so it uses the server's own answer, the
    `viewer_seat` field on `GameSerializer`
    ([`serializers.py:33, 56`](../../backend/game/serializers.py)) — and where the
    surviving seat is an unverifiable *guest* seat, web offers the button and lets
    an unauthorised click surface the 403, matching its ungated idiom everywhere
    else. What *is* shared is the closed-seat derivation beneath both:
    `isSeatClosed` / `otherSeat` / `blockedSeat` / `isDeadlocked` were rewritten to
    be identical in the two files, with the header comment in each saying so, since
    the clients must agree on when a game can no longer move. Affordance either
    way — the server re-checks every precondition. Covered by
    `AbandonGameSection.test.jsx`, `seats.test.js`, `gating.test.js` and both
    `useGame` suites.
34. **The higher-die rule is general, and both JS engines model it.** Two gaps in
    one: the rule was scoped to bear-off positions, and no client knew it existed.

    `higher_die_required_moves`
    ([`game_logic.py:201–245`](../../backend/game/game_logic.py)) now fires
    **anywhere on the board** — bar entry and ordinary blocked mid-board positions
    included — whenever a non-double roll has exactly one playable die *and* each
    die individually has a legal move. Its guard is `max_moves_usable(...) == 1`
    plus "the low die is playable too", so a position where only the high die
    works is left alone (there is no choice to restrict) and so is one where only
    the low die works (nothing to force). The bear-off-specific preferences —
    exact bear-off first, then oversized — survive as clauses that can only fire
    while bearing off, since `get_legal_moves` emits `to_point 25` only then.
    Enforced at `confirm_turn` immediately after the maximal-usage check
    ([`views.py:1018–1039`](../../backend/game/views.py)), which guarantees
    exactly one staged move whenever the rule is active, with a 400 naming the
    die.

    Ported to **both** JS engines as `higherDieRequiredMoves`
    ([`frontend/src/utils/gameLogic.js:248`](../../frontend/src/utils/gameLogic.js),
    [`mobile/src/game/logic.js:248`](../../mobile/src/game/logic.js) — the two
    files stay in sync by rule) and consumed by both `useGame` hooks
    ([`frontend/src/hooks/useGame.js:151`](../../frontend/src/hooks/useGame.js),
    [`mobile/src/game/useGame.js:208`](../../mobile/src/game/useGame.js)) to gate
    Confirm. **This closes the "clients don't model the higher-die rule" gap
    outright**: a client can no longer stage a turn the server will reject with a
    400. Covered by [`test_higher_die.py`](../../backend/game/tests/test_higher_die.py)
    and mirrored describe-blocks in `gameLogic.test.js` and `logic.test.js`.
