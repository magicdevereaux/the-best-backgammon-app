# Going Live — Production-Readiness Audit

An honest audit of what stands between the current tree and a deployed backend +
a shipped web app + a store-approved mobile app. Every item cites the file and
line it was found in; nothing here is speculative.

> **Ground rule:** this doc describes the code **as it is today**. Items are not
> "planned work" — they are gaps found by reading the tree, running
> `manage.py check --deploy`, and `git ls-files`.

Audited at commit `a00d679` (2026-07-25). Re-verify line numbers after edits.

## Current state

The app **works**, and works well, as a local development project. The game
engine is solid and heavily tested (232 backend + 172 web + 83 mobile tests), the
data model is sane, and seat/turn ownership is already enforced server-side.

The **deployment story does not exist yet**. Concretely:

- [`settings.py`](../../backend/backgammon/settings.py) is a stock `startproject`
  file with a dev secret key, `DEBUG = True`, SQLite, and no environment-variable
  plumbing of any kind. `manage.py check --deploy` reports **6 issues**.
- [`requirements.txt`](../../backend/requirements.txt) is 4 unpinned lines with
  **no WSGI server** and no static-file, database, or config libraries.
- There is **no** Dockerfile, docker-compose, Procfile, `render.yaml`, `fly.toml`,
  or any other deploy manifest anywhere in the repo, and **no `.github/`** — no
  CI runs the three test suites.
- Both clients resolve the API host in a way that **only works in development**:
  the web app relies on the CRA dev proxy, the mobile app on the Metro LAN IP.
- **Nothing legal exists** — no privacy policy, no terms, no store metadata.

The good news, verified rather than assumed: **no secrets are committed.** A
regex sweep of all 125 tracked files for key/token/password literals returns
nothing, and `git ls-files` shows neither `db.sqlite3` nor `venv/` is tracked —
[`.gitignore`](../../.gitignore) covers `db.sqlite3` (line 61), `venv/` (134),
`.env` (131), `.env.production` (225), `secrets.json` (226), `*.pem` / `*.key`
(222–223). That is one whole class of launch disaster already avoided.

---

## 1. Hard blockers

Cannot go live without these. Roughly ordered by "what breaks first."

### 1.1 `DEBUG = True` and a hardcoded, published `SECRET_KEY`

**What's wrong.** [`settings.py:5`](../../backend/backgammon/settings.py) is
`SECRET_KEY = "django-insecure-dev-key-change-in-production"` and
[`settings.py:7`](../../backend/backgammon/settings.py) is `DEBUG = True`. The key
is in git history, so it is public: anyone can forge session cookies and password
reset tokens. `DEBUG = True` serves a full traceback with settings and local
variables on every 500, and disables `ALLOWED_HOSTS` enforcement. There is **no
`os.environ` read anywhere in the file** — the settings module has no mechanism to
be configured differently in production.

`manage.py check --deploy` flags both (`security.W009`, `security.W018`).

**Fix.** Read both from the environment, fail loudly if absent in production:

```python
import os
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]          # no default
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
```

Generate a fresh 50+ char key (`django.core.management.utils.get_random_secret_key`)
— **do not reuse the committed one**. Add `python-dotenv` (or `django-environ`) so
local dev keeps working from a gitignored `.env`.

### 1.2 `ALLOWED_HOSTS` cannot serve any real domain

**What's wrong.** [`settings.py:11`](../../backend/backgammon/settings.py):

```python
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "192.168.1.156"]
```

That LAN IP is a DHCP lease on the dev machine. Once `DEBUG=False`, **every
request to the production hostname returns 400 Bad Request** — the app is 100%
down, and the failure mode reads as a mysterious blank error rather than a config
problem.

**Fix.** `ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")`.
Never `["*"]` in production. Add the load balancer / health-check host too if the
platform probes by IP.

### 1.3 No production dependencies; nothing is pinned

**What's wrong.** [`requirements.txt`](../../backend/requirements.txt) is four
lines, all open-ended ranges:

```
Django>=4.2,<5.0
djangorestframework>=3.14
django-cors-headers>=4.3
djangorestframework-simplejwt>=5.0
```

Two problems. First, **missing everything needed to run in production**: no
`gunicorn` (or `uvicorn`) — `runserver` is a dev server and must never face the
internet; no `whitenoise` — nothing serves static assets when `DEBUG=False`; no
`psycopg[binary]` / `dj-database-url` — no path off SQLite; no `python-dotenv` —
nothing loads config. Second, **`>=` ranges make builds unreproducible**: a deploy
six months from now silently pulls different versions than the one you tested.

**Fix.** Pin exact versions (`pip freeze` from a clean install, or move to
`pip-tools` / `uv` with a lockfile) and add:

```
gunicorn==<pinned>
whitenoise==<pinned>
psycopg[binary]==<pinned>
dj-database-url==<pinned>
python-dotenv==<pinned>
```

### 1.4 SQLite as the production database

**What's wrong.** [`settings.py:56–61`](../../backend/backgammon/settings.py)
points at `BASE_DIR / "db.sqlite3"`. Three independent failures: (a) on most PaaS
hosts the container filesystem is **ephemeral**, so every deploy or restart wipes
all accounts and games; (b) SQLite takes a **database-wide write lock**, and the
mobile client polls every ~3.5s per active game
([`useGame.js`](../../mobile/src/game/useGame.js)) — concurrent writers will hit
`database is locked`; (c) there is no backup story.

**Fix.** Provision managed Postgres and switch via `dj-database-url`:

```python
import dj_database_url
DATABASES = {"default": dj_database_url.config(
    default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=600)}
```

Keep SQLite as the local-dev default so nothing about the dev loop changes.
Verify the three migrations in
[`game/migrations/`](../../backend/game/migrations/) apply cleanly on a fresh
Postgres before cutting over. Note this is listed under **Planned / Not Yet
Implemented** in [CLAUDE.md](../../CLAUDE.md) — it is now on the critical path.

### 1.5 Static files are not deployable

**What's wrong.** [`settings.py:75`](../../backend/backgammon/settings.py) sets
`STATIC_URL = "static/"` and **no `STATIC_ROOT`**. `manage.py collectstatic` will
error out, and with `DEBUG=False` Django serves no static files at all — the
Django admin at `/admin/` (wired in
[`urls.py:5`](../../backend/backgammon/urls.py)) renders as unstyled HTML.

**Fix.** Set `STATIC_ROOT = BASE_DIR / "staticfiles"` (already gitignored,
[`.gitignore`](../../.gitignore) `staticfiles/`), add
`whitenoise.middleware.WhiteNoiseMiddleware` immediately after `SecurityMiddleware`
in [`settings.py:25–34`](../../backend/backgammon/settings.py), set
`STORAGES["staticfiles"]` to WhiteNoise's compressed manifest backend, and run
`collectstatic` in the release step.

### 1.6 No TLS enforcement, HSTS, or secure cookies

**What's wrong.** [`settings.py`](../../backend/backgammon/settings.py) contains
**no `SECURE_*` or `*_COOKIE_SECURE` settings at all**. Verbatim from
`manage.py check --deploy`:

- `security.W004` — `SECURE_HSTS_SECONDS` not set
- `security.W008` — `SECURE_SSL_REDIRECT` not `True`
- `security.W012` — `SESSION_COOKIE_SECURE` not `True`
- `security.W016` — `CSRF_COOKIE_SECURE` not `True`

Admin credentials and JWTs would travel over plaintext HTTP on any non-TLS path.

**Fix.** Add, gated on the production flag:

```python
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # behind a proxy
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
```

Start HSTS at a low `max-age` and ramp up — it is hard to undo. Re-run
`check --deploy` until it is clean.

### 1.7 CORS is dev-only and `CSRF_TRUSTED_ORIGINS` is missing

**What's wrong.** [`settings.py:79–81`](../../backend/backgammon/settings.py):

```python
CORS_ALLOWED_ORIGINS = ["http://localhost:3000"]
```

If the web client is served from any origin other than the API's own, **every
browser request fails CORS** in production. Separately, Django 4.x requires
`CSRF_TRUSTED_ORIGINS` to include the scheme+host for cross-origin POSTs over
HTTPS — without it, **admin login fails with a CSRF 403** even on a correctly
configured host. Neither is set.

**Fix.** Drive both from the environment:

```python
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "").split(",")
CSRF_TRUSTED_ORIGINS = os.environ.get("CSRF_ORIGINS", "").split(",")
```

If you instead serve the built web app from the same origin as the API (see 1.8),
CORS becomes a non-issue for the web client — but mobile still needs it off, since
native `fetch` is not origin-bound. Never enable `CORS_ALLOW_ALL_ORIGINS`.

### 1.8 The web build has no way to reach a production API

**What's wrong.** Every web API module uses **root-relative paths**:
[`authApi.js:1`](../../frontend/src/api/authApi.js) `const BASE_URL = "/api/auth/"`,
[`gameApi.js:3`](../../frontend/src/api/gameApi.js) `const BASE = "/api/games/"`,
[`matchApi.js:3`](../../frontend/src/api/matchApi.js) `const BASE = "/api/matches/"`,
and [`apiClient.js:8`](../../frontend/src/api/apiClient.js) calls
`fetch(path, …)` with that bare path. These work **only** because of
[`package.json:16`](../../frontend/package.json), `"proxy": "http://localhost:8000"`
— and **the CRA proxy is a dev-server feature that does not exist in
`npm run build` output**. There is no `REACT_APP_*` variable anywhere in
`frontend/src/` and no `.env*` file in `frontend/`.

So a production bundle sends `/api/...` to **whatever host serves the static
files**. Deploy the build to Netlify/S3/Vercel with the API elsewhere and every
request 404s.

**Fix.** Pick one:

- **Same-origin (simplest).** Serve the built `frontend/build/` from the Django
  host via WhiteNoise + a catch-all template route, so `/api/*` and `/` share an
  origin. Relative paths then work unchanged and CORS/CSRF get much simpler.
- **Split origin.** Introduce a base URL constant read at build time —
  `const API_ROOT = process.env.REACT_APP_API_URL || ""` — prefix it in
  [`apiClient.js`](../../frontend/src/api/apiClient.js) and in the raw `fetch`
  in [`authApi.js`](../../frontend/src/api/authApi.js) (the refresh call bypasses
  `apiClient`), and set `REACT_APP_API_URL` in the host's build env.

Whichever you choose, **test the actual `npm run build` artifact** against a
remote API before launch. This is not caught by any existing test — the web suite
mocks `fetch`.

### 1.9 The mobile app cannot find the API in a store build

**What's wrong.** [`config.js:15–27`](../../mobile/src/api/config.js):

```js
const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost
  || Constants.manifest2?.extra?.expoGo?.debuggerHost || null;
if (hostUri) return hostUri.split(":")[0];
return Platform.OS === "android" ? "10.0.2.2" : "localhost";
export const API_BASE_URL = MANUAL_OVERRIDE || `http://${devHost()}:${DJANGO_PORT}`;
```

`hostUri` is injected by **Metro**. In a released standalone build there is no
Metro, so it is `null` and the app falls through to `10.0.2.2` / `localhost` —
**pointing at the phone itself**. Every request fails; the app is inert. And
`MANUAL_OVERRIDE` is `null` at [line 10](../../mobile/src/api/config.js).

Compounding it, the URL is built with **`http://`**, hardcoded at line 27. iOS App
Transport Security blocks cleartext HTTP by default, and Android blocks it for
`targetSdk >= 28`. Even with the right host, an `http://` URL is dead on arrival
in a store build — and would be an App Review rejection regardless.

**Fix.** Branch on `__DEV__` and require HTTPS in production:

```js
export const API_BASE_URL = __DEV__
  ? (MANUAL_OVERRIDE || `http://${devHost()}:${DJANGO_PORT}`)
  : "https://api.your-domain.example";
```

Better: source the production URL from `expo.extra` in
[`app.json`](../../mobile/app.json) via `Constants.expoConfig.extra`, so it is
config rather than code. Verify with `eas build --profile preview` on a real
device off the dev LAN — the emulator will mask this bug.

### 1.10 Auth endpoints have no rate limiting whatsoever

**What's wrong.** `REST_FRAMEWORK` at
[`settings.py:83–90`](../../backend/backgammon/settings.py) sets only permission
and authentication classes — **no `DEFAULT_THROTTLE_CLASSES`, no
`DEFAULT_THROTTLE_RATES`**. A grep for `throttl|ratelimit|axes` across
`backend/**/*.py` returns nothing. `POST /api/auth/login/` and
`/api/auth/register/` ([`urls.py:13–14`](../../backend/game/urls.py)) are stock
SimpleJWT/DRF views with unlimited attempts. On a public host that is open
credential stuffing and unlimited account creation, with no lockout and no alert.

**Fix.** At minimum add DRF throttles:

```python
"DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle",
                             "rest_framework.throttling.UserRateThrottle"],
"DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "240/min"},
```

plus a tighter scoped throttle (e.g. `5/min`) on register/login specifically.
Consider `django-axes` for lockout after N failures. Note DRF's default throttle
backend uses the cache — configure a real `CACHES` entry (Redis or at least
`LocMemCache`), otherwise throttling is per-process and useless behind multiple
gunicorn workers.

### 1.11 No privacy policy, terms, or store metadata

**What's wrong.** `git ls-files | grep -i "privacy|terms|legal|policy|metadata"`
returns **nothing**. Both stores make this mandatory:

- **Apple** requires a reachable privacy policy URL and an App Privacy
  ("nutrition label") questionnaire before review; an account-creating app also
  needs an in-app **account deletion** path — which does not exist (no delete
  endpoint in [`views.py`](../../backend/game/views.py)).
- **Google Play** requires a privacy policy URL plus a Data Safety declaration,
  and enforces the same account-deletion requirement.
- Neither store listing exists: no screenshots, description, keywords, age rating
  (IARC), or support URL anywhere in the repo. The submit block at
  [`eas.json:26–28`](../../mobile/eas.json) is empty `{}` — no `ascAppId`, no
  `serviceAccountKeyPath`.

The app collects a username, a password, and gameplay history — that is personal
data, and it must be disclosed.

**Fix.** Write the policy and terms (the app is simple: username, hashed password,
game records; no analytics, no ads, no third-party sharing — say exactly that),
host them at stable URLs, and link them from both clients and the store listings.
Build an account-deletion endpoint + UI. Then produce screenshots per required
device size and fill in the submit config.

---

## 2. Should-fix before launch

Not strictly blocking, but each is a real problem you will hit within days.

### 2.1 Registration silently bypasses the password validators

[`settings.py:63–68`](../../backend/backgammon/settings.py) configures four
`AUTH_PASSWORD_VALIDATORS` — and **nothing calls them**. `RegisterSerializer`
([`serializers.py:163–173`](../../backend/game/serializers.py)) is a plain
`serializers.Serializer` whose only password rule is `min_length=8`, then calls
`User.objects.create_user`, which does not validate either. So `password123` and
`12345678` are both accepted; the validators are effectively dead configuration
for every account created through the API.

**Fix.** In `RegisterSerializer`, add
`from django.contrib.auth.password_validation import validate_password` and a
`validate_password(self, value)` method that calls it (translating
`django.core.exceptions.ValidationError` to DRF's). Add a test.

### 2.2 Refresh tokens are never rotated or revocable

[`settings.py:93–96`](../../backend/backgammon/settings.py) sets only the two
lifetimes — access 1 hour, refresh **7 days** — with no `ROTATE_REFRESH_TOKENS`
and no `BLACKLIST_AFTER_ROTATION`, and
`rest_framework_simplejwt.token_blacklist` is absent from `INSTALLED_APPS`
([`settings.py:13–23`](../../backend/backgammon/settings.py)). Consequence: logout
is client-side only (both clients just clear storage), and a **leaked refresh
token is valid for a full week with no way to revoke it**. On web the tokens live
in `localStorage`, so any XSS is a 7-day account takeover.

**Fix.** Add the blacklist app, run its migration, set
`ROTATE_REFRESH_TOKENS = True` and `BLACKLIST_AFTER_ROTATION = True`, expose a
logout endpoint that blacklists the presented refresh token, and call it from both
clients. Consider shortening the refresh lifetime to 1–2 days.

### 2.3 No logging configuration and no error monitoring

There is **no `LOGGING` dict** in
[`settings.py`](../../backend/backgammon/settings.py) and no Sentry/Rollbar
integration anywhere (grep for `sentry|LOGGING` across `backend/` returns
nothing). With `DEBUG=False` a 500 produces a bare "Server Error" for the user
and, absent `ADMINS` + email config, **no notification to anyone**. You would
learn about outages from players.

**Fix.** Add a `LOGGING` config writing structured logs to stdout (what every
container platform expects), and wire an error tracker — `sentry-sdk[django]` is
a ~10-line addition and pays for itself on day one. Set a release/environment tag
so mobile and web errors are distinguishable.

### 2.4 No health-check endpoint

[`urls.py`](../../backend/backgammon/urls.py) exposes exactly two routes,
`admin/` and `api/`. Every PaaS and load balancer wants a cheap liveness URL;
without one they will probe `/` (404) or the DB-touching list endpoint.

**Fix.** Add `path("healthz/", …)` returning 200 with a trivial DB query, exempt
from auth and throttling.

### 2.5 `GET /api/games/` returns every game ever, unpaginated and unauthenticated

`GameViewSet.get_queryset` ([`views.py:303–308`](../../backend/game/views.py))
starts from `Game.objects.all()` with only an optional `?status=` filter, DRF
default permission is `AllowAny`
([`settings.py:84–86`](../../backend/backgammon/settings.py)), and **no
pagination is configured** (no `DEFAULT_PAGINATION_CLASS` / `PAGE_SIZE`
anywhere). Any anonymous caller can dump every game row — full board state,
player names, user associations — in one request, and the response grows without
bound as the app is used.

**Fix.** Set `DEFAULT_PAGINATION_CLASS` + `PAGE_SIZE` in `REST_FRAMEWORK`. Scope
the default `list` to open/lobby games or the requester's own games; keep
retrieve-by-id open if link sharing depends on it.

### 2.6 Accounts have no email, so there is no recovery path

The register serializer accepts **username + password only**
([`serializers.py:163–165`](../../backend/game/serializers.py)) on the stock
`django.contrib.auth.models.User`. No email verification, no password reset, no
password change endpoint. A user who forgets their password has **no recourse
whatsoever** and their match history is gone — and you will be handling those
support emails by hand.

**Fix.** Add an optional-but-encouraged email field at registration and Django's
password-reset flow (needs an email backend: SES, Postmark, Resend). Verification
can wait; recovery cannot.

### 2.7 EAS declares update channels without `expo-updates`

[`eas.json:16 and 22`](../../mobile/eas.json) set `"channel": "preview"` and
`"channel": "production"`, but
[`mobile/package.json`](../../mobile/package.json) has **no `expo-updates`
dependency** and [`app.json`](../../mobile/app.json) has no `runtimeVersion` or
`updates` block. The channels are inert, and you get **no OTA update path** — every
JS fix requires a full store resubmission and review.

**Fix.** `npx expo install expo-updates`, set a `runtimeVersion` policy in
`app.json`, and verify `eas update` publishes to the right channel. For a
client-heavy game with duplicated rules logic, OTA is worth a lot: a rules bug
otherwise takes days to reach users.

### 2.8 No CI, so nothing enforces the 487 tests

There is **no `.github/` directory** (verified absent). The three suites in
[CLAUDE.md](../../CLAUDE.md#tests) run only when someone remembers. Given the
project's defining risk — the game engine is implemented **three times**
([`game_logic.py`](../../backend/game/game_logic.py),
[`gameLogic.js`](../../frontend/src/utils/gameLogic.js),
[`logic.js`](../../mobile/src/game/logic.js)) and they must stay in sync — an
unenforced test suite is the single highest-leverage gap in the list.

**Fix.** A GitHub Actions workflow running all three suites plus
`npm run build` (which nothing currently exercises) and `manage.py check
--deploy` on every push. Block merges on it.

### 2.9 No deployment manifest of any kind

No Dockerfile, docker-compose, Procfile, `render.yaml`, `fly.toml`,
`railway.json`, `vercel.json`, or `netlify.toml` exists in the tree. The deploy
is currently "whatever someone types into a server," which is unrepeatable and
undocumented.

**Fix.** Commit one Dockerfile (or platform manifest) with an explicit release
command — `migrate && collectstatic` then `gunicorn backgammon.wsgi`. Document
the required env vars alongside it: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`,
`DJANGO_ALLOWED_HOSTS`, `DATABASE_URL`, `CORS_ORIGINS`, `CSRF_ORIGINS`,
`SENTRY_DSN`.

### 2.10 Django admin is publicly exposed

[`urls.py:5`](../../backend/backgammon/urls.py) mounts `admin/` at a predictable
path with no IP allowlist, no 2FA, and — per 1.10 — no login throttling. Admin
compromise means total control of every account and game.

**Fix.** Move it to a non-obvious path, restrict by IP or put it behind the
platform's auth proxy, enforce a strong superuser password, and (once 1.10 lands)
confirm throttling covers the admin login form as well as the API.

### 2.11 No database backups

Follows from 1.4 but deserves its own line: nothing in the repo or docs describes
a backup or restore procedure. Losing the accounts table loses every player's
history permanently.

**Fix.** Enable the managed database's automated backups, and — critically —
**test a restore once** before launch. Untested backups are not backups.

---

## 3. Nice-to-have / post-launch

- **Web client has no auto-refresh.** Mobile polls ~3.5s
  ([`useGame.js`](../../mobile/src/game/useGame.js)); the web client requires a
  manual reload to see an opponent's move. Fine for hotseat, poor for online play.
  Polling is the cheap fix; WebSockets/Channels is the real one (currently listed
  under **Planned** in [CLAUDE.md](../../CLAUDE.md)).
- **Polling cost.** Every active mobile game is ~17 requests/minute against an
  unpaginated, uncached endpoint. Add caching or conditional requests (ETag /
  `If-Modified-Since`) before this becomes a bill.
- **No matchmaking.** Online play is link/code only. Expect low engagement from
  solo installs — a store user with no friend to send a link to has nothing to do
  online. See [overview.md](../architecture/overview.md).
- **Web PWA polish.** [`frontend/public/`](../../frontend/public/) contains only
  `index.html` — no favicon, `manifest.json`, `robots.txt`, Open Graph tags, or
  `<meta name="description">`. Shared game links will preview as a bare URL, and
  the tab title is just "Backgammon"
  ([`index.html:6`](../../frontend/public/index.html)).
- **The higher-die rule is still only enforced during bear-off** (see
  [game-logic.md](../architecture/game-logic.md)). A knowledgeable player will
  notice and report it as a bug. Worth closing before a rules-literate audience
  finds it.
- **`move_checker` is dead API surface.** No client uses it
  ([CLAUDE.md](../../CLAUDE.md)); it is extra attack surface for zero benefit.
  Consider removing it rather than maintaining it.
- **Repo hygiene.** `mobile/MOBILE_PROGRESS.md` and `mobile/.claude/settings.json`
  are tracked (`git ls-files mobile/`); the former is scratch session notes that
  probably belong outside the repo.
- **Mobile version numbers.** [`app.json`](../../mobile/app.json) declares
  `version 1.0.0`, `buildNumber "1"`, `versionCode 1`, but
  [`eas.json:4`](../../mobile/eas.json) sets `"appVersionSource": "remote"` with
  `autoIncrement` on the production profile — so EAS, not the file, owns build
  numbers. Harmless, but know which one is authoritative before you debug a
  rejected upload.
- **No load testing.** You have no idea what concurrency the stack survives. One
  `locust`/`k6` run against the deployed API before launch would be cheap
  insurance.

---

## Minimum path to launch

If you want the shortest honest sequence:

1. **Backend config** — 1.1, 1.2, 1.3, 1.5, 1.6, 1.7 in one settings refactor
   driven by env vars; re-run `manage.py check --deploy` until clean.
2. **Postgres + deploy manifest** — 1.4 and 2.9; deploy, verify migrations,
   turn on backups (2.11).
3. **Lock the doors** — 1.10 throttling, 2.1 password validators, 2.2 token
   blacklist, 2.10 admin, 2.3 Sentry, 2.4 healthz.
4. **Web** — resolve 1.8, then deploy and smoke-test the real build artifact.
5. **Mobile** — resolve 1.9, `eas build --profile preview`, test on a device off
   the dev network.
6. **Legal + store** — 1.11: policy, terms, account deletion, screenshots,
   Data Safety / App Privacy, then submit.

Add CI (2.8) at step 1 so everything after it is verified continuously.
