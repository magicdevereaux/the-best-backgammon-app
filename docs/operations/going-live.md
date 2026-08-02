# Going Live — Production-Readiness Audit

An honest audit of what stands between the current tree and a deployed backend +
a shipped web app + a store-approved mobile app.

> **Ground rule:** this doc describes the code **as it is today**. Every item
> cites the file and line it was found in. Nothing here is speculative, and
> nothing is marked done that wasn't read back out of the tree.

Re-audited **2026-08-01** against HEAD `3849294`, after the run of commits that
closed most of section 2 (list scoping, shared cache, password reset, the
closed-seat clients and `abandon`, Sentry, CI, OTA, web polling, web metadata,
and the removal of `move_checker`). Line numbers in `views.py`,
`serializers.py` and `settings.py` all moved and were re-read for this pass.

## Current state

The original audit found 11 hard blockers. **All of them are closed**, and so is
most of what the last two passes added. The backend is env-driven, containerised,
throttled, cache-configurable and Sentry-ready; it passes Django's own deployment
checks cleanly and CI now enforces that; both clients can be pointed at a real
API by configuration; both clients now poll, and both explain a seat closed by
account deletion; password reset exists end to end on the server; legal drafts
exist.

What remains splits three ways. **Decisions and credentials only the owner can
supply** ([section 1](#1-blocked-on-the-owner)) — including three new ones: the
code now *reads* `REDIS_URL`, `SENTRY_DSN` and the `EMAIL_*` vars, but none of
them is set anywhere, so the shared throttle cache, error reporting and outbound
mail are all wired-but-dormant. **Real code gaps** ([section 2](#2-still-open-in-code)),
of which two matter: `GET /api/matches/` is still the enumeration hole that
`GET /api/games/` no longer is ([2.1](#21-get-apimatches-is-still-public-and-unscoped)),
and the password-reset flow has **no client UI at either end**
([2.4](#24-password-reset-works-server-side-but-no-client-can-use-it)), so a real
user still cannot recover an account. And **things the server can now do that no
client asks for** — the `abandon` endpoint has no caller
([2.5](#25-nothing-calls-the-abandon-endpoint)).

Verified in the 2026-07-26 pass, by running it (settings are untouched since),
and now run on every push by CI ([3.26](#3-done)):

```
$ cd backend && DEBUG=False SECRET_KEY=<50-char random> ALLOWED_HOSTS=example.com \
    venv/Scripts/python.exe manage.py check --deploy
System check identified no issues (0 silenced).
```

Six warnings → zero. All three suites are green as of **2026-08-01**:
**backend 412**, **web 239**, **mobile 125** (776 total), and
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs each on every
push.

Still true, and still good news: **no secrets are committed.** `git status`
shows no `.env`, and [`.gitignore`](../../.gitignore) covers `db.sqlite3`,
`venv/`, `.env`, `.env.production`, `secrets.json`, `*.pem` / `*.key`. The
`.env.example` files are placeholders with empty values.

**Order of operations from here.** The remaining code gaps are narrow, so the
next step is still infrastructure. (1) Owner provisions Postgres on Railway and
sets the env vars ([section 1](#1-blocked-on-the-owner); runbook in
[railway-deploy.md](railway-deploy.md)) — and while in that tab, sets
`REDIS_URL`, `SENTRY_DSN` and the `EMAIL_*` / `FRONTEND_BASE_URL` values, which
cost nothing extra and switch on three subsystems that are otherwise inert.
(2) Deploy, smoke-test, turn on backups. (3) Build web with
`REACT_APP_API_BASE_URL`, build mobile with `EXPO_PUBLIC_API_URL`, test both off
the dev LAN. (4) Fill the legal `[TODO]`s, host the policy, submit.

Two items in [section 2](#2-still-open-in-code) are worth doing *before* real
users arrive rather than after. [2.4](#24-password-reset-works-server-side-but-no-client-can-use-it)
is a client-only job that turns a finished server feature into a usable one —
without it, "I forgot my password" is still a support ticket, and store reviewers
test exactly that path. [2.1](#21-get-apimatches-is-still-public-and-unscoped) is
half an hour of work of a shape already proven on `Game`.

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
The owner must provision a managed Postgres, set `DATABASE_URL`, and **verify the
migrations apply cleanly on an empty Postgres before cutting over** — they have
only ever been run against SQLite.

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
> unimplemented. It **is** implemented now — see [3.11](#3-done) and
> [3.20](#3-done). That section of both documents, and of
> `docs/legal/README.md`, is stale.

### 1.6 Backups, admin credentials, and the three dormant subsystems

- Enable the managed database's automated backups and **test a restore once**.
  Untested backups are not backups. Nothing in the repo can do this.
- Choose a strong superuser password and decide how `/admin/` is protected (see
  [2.3](#23-django-admin-is-publicly-exposed-at-a-predictable-path)).
- **Sentry.** The code side is done — `sentry-sdk[django]` is pinned and
  initialised the moment `SENTRY_DSN` is non-empty ([3.25](#3-done)). Create the
  project, paste the DSN. Until then a 500 still notifies nobody.
- **Redis.** Same shape: `CACHES` switches to `RedisCache` on `REDIS_URL` and the
  `redis` client is pinned ([3.22](#3-done)). Add the platform's Redis plugin and
  reference its URL, or accept per-worker throttle counters.
- **An outbound mail route.** Password reset is built and tested
  ([3.23](#3-done)) but ships nothing without `EMAIL_HOST` — with it unset,
  Django's console backend prints the reset link to the deploy log. Pick any
  SMTP-speaking provider (SES, Postmark, Resend, Mailgun) and set the `EMAIL_*`
  vars plus `FRONTEND_BASE_URL`. Note this is only half the fix: no client can
  *use* the flow yet either ([2.4](#24-password-reset-works-server-side-but-no-client-can-use-it)).

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

Real remaining work, ranked by severity.

### 2.1 `GET /api/matches/` is still public and unscoped

**This is the unfinished half of today's list-scoping fix, not a new bug.**
`_list_scope_q` ([`views.py:514–556`](../../backend/game/views.py)) was applied to
`GameViewSet` only ([`views.py:783–790`](../../backend/game/views.py)).
`MatchViewSet.get_queryset` is still a bare
`Match.objects.all()` ([`views.py:624–625`](../../backend/game/views.py)), the
default permission is `AllowAny`
([`settings.py:292–295`](../../backend/backgammon/settings.py)), and
`MatchSerializer` uses `fields = "__all__"`
([`serializers.py:74–88`](../../backend/game/serializers.py)) — so
`GET /api/matches/` still hands an anonymous caller `player1_user` /
`player2_user` ids, both display names, both scores, `target_points`, status and
timestamps for **every match in the table**. `BareListPagination` bounds a single
response to 100 rows, but `?page=N` walks the rest at the anon rate (120/min).
Exactly the exposure that was just closed for `Game`.

**Fix — same shape as the one already proven.** Scope the `list` action, leave
`retrieve` by id open (a match is reached by link/code the same way a game is).
Two details differ from the `Game` rule and should be checked rather than copied:

- **There is no lobby clause to write.** `Match.status` has only `active` and
  `finished` ([`models.py:24–28`](../../backend/game/models.py)) — no `waiting`
  — so the "public lobby" disjunct that keeps open *games* visible has no match
  analogue. Advertising happens on `Game`, not `Match`.
- **The fully-guest clause does carry over.** `Match` has the same
  `player1_deleted` / `player2_deleted` flags
  ([`models.py:19–20`](../../backend/game/models.py)), so "both FKs null and
  neither seat closed" is expressible and draws the same guest-vs-closed
  distinction `_match_permission_error` already draws.

Cheaper still: **no client calls the list endpoint at all.**
[`matchApi.js`](../../frontend/src/api/matchApi.js) exposes only
`fetchMatch(id)` / `createMatch` / `nextGame` / `joinMatch`, and
[`mobile/src/api/matches.js`](../../mobile/src/api/matches.js) the same four.
Dropping `ListModelMixin` from `MatchViewSet` would close the hole outright and
break nothing shipped — worth considering before writing a scoping rule for a
list nobody reads.

### 2.2 Guest seats are unverifiable by design

A seat with a null user FK **and no closure flag** has no server identity to
check, so anonymous requests on it are allowed — see the policy docstring at
[`views.py:420–472`](../../backend/game/views.py). This is what keeps
hotseat/guest play working without an account, and it is a deliberate,
documented trade-off rather than an oversight. It used to be the mechanism a
deleted account's orphaned seat fell through; that path is now closed
([3.20](#3-done)), and what remains is the original, intended hole: a genuine
guest seat is playable by whoever holds the game id.

The same null-FK-means-guest rule now also shows up in list scoping: the
"fully-guest" disjunct of `_list_scope_q` ([3.21](#3-done)) keeps hotseat resume
working precisely because such rows carry no account-linked identity to scope by.
Closing this gap would let that clause be tightened too.

**Fix (larger).** A guest token minted at game creation and stored client-side,
checked alongside the user FK. Not required for launch; required before anyone
plays for anything that matters.

### 2.3 Django admin is publicly exposed at a predictable path

[`backgammon/urls.py:7`](../../backend/backgammon/urls.py) mounts `admin/` with no
IP allowlist and no 2FA. And note **DRF throttles do not cover it** — the admin
login is a plain Django view, so the `login` scope
([`LoginView`, `views.py:102–111`](../../backend/game/views.py)) protects
`/api/auth/login/` only. Admin compromise is total compromise.

**Fix.** Move it to a non-obvious path, restrict by IP or put it behind the
platform's auth proxy, and add `django-axes` (or equivalent) if you want lockout
on the admin form specifically.

### 2.4 Password reset works server-side, but no client can use it

**Severity: high for launch. The server half is finished and tested
([3.23](#3-done)); the client half does not exist at all, so from a user's seat
nothing has changed — "I forgot my password" is still a support ticket, and
self-service account deletion (which re-checks the password,
[`AccountDeleteSerializer`, `serializers.py:202–226`](../../backend/game/serializers.py))
is still unreachable for anyone who has forgotten it. That is exactly the flow
store reviewers test.**

Three separate client gaps, all verified by grep across `frontend/src`,
`mobile/src` and `mobile/app` — the string `email` does not appear in either
client's source:

- **No `reset-password` route exists.** `build_password_reset_url`
  ([`views.py:282–296`](../../backend/game/views.py)) mails a link of the shape
  `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`, with uid and token as path
  segments specifically so a client router can bind them as params. Web's router
  declares `/`, `/login`, `/register`, `/game/:id`, `/profile`
  ([`App.jsx:45–50`](../../frontend/src/App.jsx)) and nothing else; mobile's
  file-based routes are `index` / `login` / `profile` / `game/[id]`
  ([`mobile/app/`](../../mobile/app)). **A user who receives the email lands on a
  404.**
- **No "forgot password?" entry point.** Nothing calls
  `POST /api/auth/password-reset/`, so there is no way to trigger the mail from
  inside either app.
- **No way to supply an email in the first place.** `RegisterSerializer.email` is
  optional ([`serializers.py:240`](../../backend/game/serializers.py)) and
  `PATCH /api/auth/me/` can set one later
  ([`MeView`, `views.py:211–214`](../../backend/game/views.py);
  `UserSerializer.email`, [`serializers.py:103`](../../backend/game/serializers.py)),
  but neither register form nor either profile screen renders an email field.
  **Every account created so far and every account created by the shipped clients
  has an empty `email`, and `PasswordResetRequestView` only matches on a
  non-blank address** ([`views.py:359`](../../backend/game/views.py)) — so the
  flow is not merely unreachable, it currently has nobody to reach.

**Fix.** Client-only, in this order: an optional email field on both register
forms and both profile screens (so accounts *can* be recoverable), a "forgot your
password?" link that POSTs the address, and a `/reset-password/:uid/:token`
route — a web `<Route>` plus a mobile deep-link route — that POSTs
`{uid, token, new_password}` to `.../confirm/` and sends the user to login. The
API is stable and documented in [api.md](../architecture/api.md); no server work
is required. Owner-side, the flow additionally needs `EMAIL_HOST` and a correct
`FRONTEND_BASE_URL` ([1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems)),
or the mail is printed to the deploy log with a `localhost:3000` link in it.

### 2.5 Nothing calls the `abandon` endpoint

**Severity: low. The deadlock is now *explained* by both clients and the exit
*exists* on the server — but no button reaches it.**

`POST /api/games/{id}/abandon/` is implemented, permission-checked and covered by
`test_abandon.py` ([`views.py:1105–1188`](../../backend/game/views.py) —
see [3.24](#3-done)). Grepping `frontend/src`, `mobile/src` and `mobile/app` for
`abandon` returns **no hits outside tests**: neither `gameApi.js` nor
`mobile/src/api/games.js` wraps it, and no screen offers it.

So the survivor of a deleted-account deadlock now correctly reads "your opponent
deleted their account — this game can't continue" and stops polling
([3.24](#3-done)), and then has nowhere to click. The dead game stays `active` in
their list forever and the match stays open, able to spawn further games that are
dead on arrival — the exact condition the endpoint's match-finishing branch was
written to prevent.

**Fix.** An API wrapper on each client and one button in the banner both clients
already render, refreshing the game from the 200 response. No server work.

### 2.6 The higher-die rule is enforced only during bear-off

`higher_die_required_moves` ([`game_logic.py:201`](../../backend/game/game_logic.py))
is server-only — no JS port exists in either client — and it is scoped to
bear-off positions. The official rule is *general*: whenever only one of the two
dice can be played, it must be the higher one. In a blocked non-bear-off position
the lower single die is still accepted. See
[game-logic.md](../architecture/game-logic.md). A rules-literate player will
report it as a bug.

This is the last survivor of what used to be a three-item "Rules and API surface"
list: `move_checker` has since been deleted outright ([3.30](#3-done)) and web
auto-refresh shipped ([3.28](#3-done)).

### 2.7 Polish and hygiene

- **Tracked scratch files.** `git ls-files` still shows
  `mobile/MOBILE_PROGRESS.md` and `mobile/.claude/settings.json`; the former is
  session notes that probably belong outside the repo.
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
  [`frontend/public/index.html`](../../frontend/public/index.html). Same comment
  notes the missing PNG/ICO favicon fallback and the 192/512px manifest icons.
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
   ([`views.py:604–608`](../../backend/game/views.py),
   [`views.py:754–759`](../../backend/game/views.py)), so `PUT`/`PATCH`/`DELETE`
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
    creates ([`views.py:697–698`](../../backend/game/views.py)), or the closure
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
    [3.24](#3-done), whose remaining client residue is
    [2.5](#25-nothing-calls-the-abandon-endpoint).**

21. **`GET /api/games/` no longer enumerates the whole table.** `_list_scope_q`
    ([`views.py:514–556`](../../backend/game/views.py)) unions three disjuncts —
    open lobby games with neither seat closed, games either of whose seat FKs is
    the requester, and fully-guest games (both FKs null, neither flagged) — and
    `GameViewSet.get_queryset` applies it **to the `list` action only**
    ([`views.py:783–790`](../../backend/game/views.py)).

    **Read the scope of the fix precisely: it bounds *enumeration*, not
    *access*.** `retrieve` by id is still open to everyone, deliberately —
    joining an online game is done by sharing its link or code, and gating
    retrieve would break the only pairing mechanism the app has. What changed is
    that a stranger must now *know* an id instead of paging the table for them.
    The deliberate cost is on the `list` side too: in a mixed game (one guest
    seat, one registered seat) past `waiting`, the guest can no longer find the
    row in the list and needs the id — nothing better is possible without a guest
    identity ([2.2](#22-guest-seats-are-unverifiable-by-design)). Tested in
    [`test_game_list_scoping.py`](../../backend/game/tests/test_game_list_scoping.py).
    The bare-array response shape is unchanged, so both clients' `.map()` still
    works. **`GET /api/matches/` did not get the same treatment — see
    [2.1](#21-get-apimatches-is-still-public-and-unscoped).**
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

    > **This is only the server half.** No client renders an email field, offers
    > a "forgot password?" link, or routes `/reset-password/:uid/:token`, so no
    > user can complete a reset from either app today — and with `EMAIL_HOST`
    > unset the mail goes to the console backend. See
    > [2.4](#24-password-reset-works-server-side-but-no-client-can-use-it) and
    > [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems).
24. **A closed seat is now explained by both clients, and the server offers an
    exit.** The deadlock itself is unchanged and still deliberate (it beats
    inventing a forfeit result — see [3.20](#3-done)); what was missing was
    telling the player and letting them out.

    Both clients read `player1_deleted` / `player2_deleted` through parallel
    helpers — [`frontend/src/utils/seats.js`](../../frontend/src/utils/seats.js)
    and [`mobile/src/game/gating.js:30–53`](../../mobile/src/game/gating.js) —
    which name the seat that owes the next action (the *responder* while a double
    is pending, otherwise `current_turn`, exactly as `respond_to_double` and
    `abandon` compute it). When it is closed, the turn banner is replaced with
    "your opponent deleted their account — this game can't continue"
    ([`GamePage.jsx:96–132`](../../frontend/src/pages/GamePage.jsx),
    [`app/game/[id].jsx:186–193`](../../mobile/app/game/[id].jsx)), worded from
    `viewer_seat` so the survivor and a spectator read different sentences, and
    **both pollers stop** rather than hammering a game nobody can advance
    ([`frontend/src/hooks/useGame.js:59–91`](../../frontend/src/hooks/useGame.js),
    [`mobile/src/game/useGame.js:99–146`](../../mobile/src/game/useGame.js)).

    `POST /api/games/{id}/abandon/`
    ([`views.py:1105–1188`](../../backend/game/views.py)) gives the survivor a
    non-scoring way out: it requires the game to be `active`, the blocked seat to
    be closed, and the caller to satisfy `_seat_permission_error` **for the
    surviving seat**; it then finishes the game with `winner=None`,
    `win_type="abandoned"`, `points_value=0`, and finishes the match without
    touching either score — leaving the match open would let the survivor mint an
    endless series of games that `next_game` stamps dead on arrival. If both
    seats are closed nobody can abandon, which is correct. Covered by
    [`test_abandon.py`](../../backend/game/tests/test_abandon.py).
    **No client calls it yet — [2.5](#25-nothing-calls-the-abandon-endpoint).**
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
    ([`frontend/src/hooks/useGame.js:14, 79–91`](../../frontend/src/hooks/useGame.js)),
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
    [2.7](#27-polish-and-hygiene).
30. **`move_checker` is gone.** The endpoint was dead API surface — no client
    ever called it, and both clients drive the staging → `confirm_turn` flow —
    so the DRF action, its web API wrapper and its endpoint-only tests were
    deleted rather than left as attack surface for zero benefit.
    `GameViewSet`'s routed actions are now `roll_dice` / `confirm_turn` / `join`
    / `offer_double` / `respond_to_double` / `abandon`
    ([`views.py:761–768`](../../backend/game/views.py)), and a grep for
    `move_checker` across `backend/`, `frontend/src`, `mobile/src` and
    `mobile/app` returns nothing. Rules coverage was preserved: the tests that
    happened to exercise engine behaviour *through* the endpoint were repointed
    at `confirm_turn` rather than deleted, which is why the backend suite fell
    only from 421 to 412.
