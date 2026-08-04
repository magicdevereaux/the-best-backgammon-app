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
`serializers.py` and `models.py` were untouched *at that point*, so their
citations below were exact as written. **Later work in this file's notes has
since moved all three** — see the addenda below; the symbols they name are still
correct, the line numbers may be a few off.

> **Added after that pass:** the inactivity forfeit ([3.35](#3-done)) — a
> `turn_started_at` column, `TURN_TIMEOUT_HOURS`, `POST /claim_timeout/`, and a
> countdown plus claim control on both clients. It closes the last way an online
> game could become permanently unplayable with nobody at fault. `models.py`,
> `serializers.py` and `settings.py` all moved with it, so line citations naming
> those three may sit a few lines off; the symbols they name are unchanged.
>
> **And after *that*:** three follow-ups to the forfeit, all in
> [section 3](#3-done) — the `server_now` field that stops a skewed device clock
> mis-timing a claim ([3.36](#3-done)), the `send_turn_reminders` command and its
> `TURN_REMINDER_LEAD_HOURS` / `turn_reminder_sent_at` supporting cast
> ([3.37](#3-done)), and a specific error message for the claim-vs-move race
> ([3.38](#3-done)). Two of the three residues recorded against the forfeit are
> closed by them; **the reminder is dormant until a cron is scheduled**, and
> **push notifications still do not exist** — both in
> [2.3](#23-polish-and-hygiene). `views.py` line citations moved again with this
> work; the symbols they name did not.
>
> **And after *that*: the reminder was hardened, not extended.** An adversarial
> review of the command produced an opt-out (`UserPreferences`, migration
> `0007_userpreferences`, writable on `PATCH /api/auth/me/`), a refusal to send
> while `FRONTEND_BASE_URL` / `DEFAULT_FROM_EMAIL` sit at their dev defaults, a
> claim-before-send stamp, and a per-row re-read — all itemised in
> [3.37](#3-done). `models.py`, `serializers.py` and the migration set moved with
> it, so citations naming those may again sit a few lines off; the symbols do
> not. **Nothing here changes the two statements above**: the reminder is still
> dormant until a cron is scheduled, and push still does not exist. The privacy
> policy changed with it ([1.5](#15-publish-the-legal-documents)) — an
> unsolicited second mail type needed describing, and an opt-out to describe.
>
> **And after *that*: email verification ([3.39](#3-done)),
> [ADR-003](../decisions/adr-003-email-verification.md).** An address is now
> **required at registration**, an `EmailVerification` row records which address
> was proven (migration `0008_emailverification`), and
> `send_turn_reminders` **mails only confirmed addresses**. Accounts stay fully
> usable unverified — the gate is on that one bulk sender and nothing else,
> because the risk being managed is **sender reputation, not account security**.
> **This adds a hard ordering constraint to the cron work in
> [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems): the
> verification gate had to exist before the cron's first run**, because a first
> blast at an unfiltered table is irreversible — you cannot un-burn a domain.
> That constraint is now satisfied in code; what remains is not scheduling the
> cron ahead of `FRONTEND_BASE_URL` / `DEFAULT_FROM_EMAIL`, as before.
> `models.py`, `serializers.py`, `views.py`, `urls.py` and `settings.py` all
> moved with this; the symbols cited below did not.

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
now the bulk of the remaining work, and it includes **four** things that are
*coded and dormant*: `REDIS_URL`, `SENTRY_DSN` and the `EMAIL_*` vars are all read
by `settings.py` and set nowhere, so throttle counters are still per-worker, a 500
still notifies nobody, and outbound mail still goes to Django's console backend —
and the fourth, `manage.py send_turn_reminders` ([3.37](#3-done)), is a command
with no scheduler calling it, so nobody is warned that their clock is running.
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
**backend 596**, **web 411**, **mobile 292** (1299 total), and
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs each on every
push. Those numbers moved on all three clients in this pass — from 450 / 312 /
190 (952) — and the inactivity forfeit ([3.35](#3-done)) is what moved them:
`test_timeout.py` on the server plus the turn-clock and claim-control suites on
web and mobile. A follow-up pass then hardened that feature — server-time
countdowns, the claim-vs-move race message, and `send_turn_reminders` — taking
the three suites from 531 / 364 / 247 to their current figures. The backend had
itself already grown from 441 with the
`ADMIN_URL` tests in [2.2](#22-django-admin-has-no-2fa-ip-allowlist-or-lockout)
and the transaction tests. **The backend's 596 are also green against real
Postgres**, not only SQLite — see
[postgres-readiness.md](postgres-readiness.md) and
[1.1](#11-pick-a-host-and-provision-postgresql).

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
of 2026-08-02**, and fully so: all **37** migrations in the tree apply clean to
an empty Postgres 16 and the full **596**-test backend suite passes there. That
now includes `0005_game_turn_started_at` ([3.35](#3-done)), whose `RunPython`
backfill was exercised against **real rows** rather than the zero rows an empty
database offers it — `active` games took `updated_at` exactly, `waiting` and
`finished` stayed null, and `updated_at` was not itself rewritten — and which
also reverses cleanly. Evidence, the compatibility audit, and the two settings
still to change at cutover (notably `DB_SSL_REQUIRE=True`) are in
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
| `TURN_TIMEOUT_HOURS` | Optional; **defaults to 48**. How long a seat may leave a game waiting on it before the opponent can claim an inactivity forfeit ([3.35](#3-done)). Env-driven so it can be retuned on a live deployment without a deploy — worth revisiting once real players show you how they actually pace a game. |
| `TURN_REMINDER_LEAD_HOURS` | Optional; **defaults to 12**. How long before that deadline `manage.py send_turn_reminders` mails the seat on the clock ([3.37](#3-done)). Read by the command only, so it has no effect until the command is scheduled — see [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems) and [railway-deploy.md step 8](railway-deploy.md#8-schedule-the-turn-reminder-cron). Keep it well below `TURN_TIMEOUT_HOURS`. |
| `REDIS_URL` | **Optional, strongly recommended.** Unset → `LocMemCache`, so DRF's throttle counters are per gunicorn worker and reset on deploy. Set → `RedisCache` and the limits become global ([`settings.py:63–90, 196–204`](../../backend/backgammon/settings.py)). Provisioning is owner work; see [3.22](#3-done). |
| `SENTRY_DSN` | **Optional, strongly recommended.** Unset → `sentry_sdk.init()` is never called and a 500 reports nowhere. Set → errors ship, tagged by `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` ([`settings.py:445–473`](../../backend/backgammon/settings.py)). See [3.25](#3-done). |
| `ADMINS` | Optional. `Name <addr>` pairs, comma-separated; attaches Django's `mail_admins` handler to `django.request` ([`settings.py:429–443`](../../backend/backgammon/settings.py)). Needs `EMAIL_HOST` to actually send. |
| `EMAIL_VERIFICATION_TIMEOUT_HOURS` | Optional; **defaults to 72**. How long a verification link stays valid ([3.39](#3-done)). Longer than a reset window on purpose — the token proves a mailbox and grants nothing else, and a resend path exists. Read at confirm time only. |
| `EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS` | Optional; **defaults to 60**. Smallest gap between two verification mails to one account, stored on the row rather than in `CACHES` — which is why it still holds when `REDIS_URL` is unset and the `email_verify_resend` throttle is per-worker ([3.39](#3-done)). |
| `EMAIL_HOST` + `EMAIL_PORT` / `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` / `EMAIL_USE_TLS` / `DEFAULT_FROM_EMAIL` | **Required for password reset *and email verification* to leave the box.** With `EMAIL_HOST` unset the backend is Django's **console** backend — the mail is printed to the log and never delivered ([`settings.py:317–345`](../../backend/backgammon/settings.py)). Since [3.39](#3-done) this matters at **registration**, not only on a forgotten password: a new account is mailed a confirmation link, and an unconfirmed address is never sent a turn reminder. |
| `FRONTEND_BASE_URL` | The origin **every emailed link** points at — the reset link `/reset-password/{uid}/{token}`, the turn reminder's `/game/{id}` (`build_game_url`, [3.37](#3-done)), and the verification link `/verify-email/{token}` (`build_email_verification_url`, [3.39](#3-done)). Defaults to `http://localhost:3000`, which is wrong in production and silently so — the mail still sends, carrying a link nobody can open ([`settings.py:348–352`](../../backend/backgammon/settings.py)). |

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

> **And a fourth correction, applied with the reminder opt-out.** The policy said
> an address is used *"only to send password-reset links"* and, under "How we use
> what we collect", *"We send no other mail."* Both were **false** the moment
> `send_turn_reminders` ([3.37](#3-done)) existed. The policy now describes
> **two** outbound mail types, says the reminder is **on by default** for any
> account that has supplied an address, names the exact control that switches it
> off (`turn_reminder_emails` on the profile, `PATCH /api/auth/me/`), and repeats
> that no address is required to play at all. That opt-out is the thing that makes
> sending unsolicited mail to an address collected *for password reset*
> defensible, so the policy and the code have to keep agreeing about it — see
> [3.37](#3-done).

> **A fifth correction is now OUTSTANDING, and it is owner/lawyer work on
> `docs/legal/`, not a code gap.** Email verification ([3.39](#3-done),
> [ADR-003](../decisions/adr-003-email-verification.md)) invalidated three of the
> statements the drafts currently make, and the drafts have **not** been updated:
>
> - **"Optional" is now wrong for a registered account.** The policy calls the
>   address optional in at least four places
>   ([`privacy-policy.md:18, 49, 157, 266`](../legal/privacy-policy.md)) —
>   *"only if you choose to supply one"*. `RegisterSerializer.email` is now
>   `required=True, allow_blank=False`. What is still true, and what the wording
>   should be rebuilt around, is **"you can play without an account at all"**
>   (guest seats), not "you can register without an address".
> - **"Exactly two things" / "the only two" mail types**
>   ([`privacy-policy.md:52, 160, 173–179`](../legal/privacy-policy.md), including
>   the flat *"We send no other mail"*) is now **three**: reset, turn reminder,
>   and the verification link sent at registration and on every address change.
> - **"Can be added or removed later from your profile"**
>   ([`privacy-policy.md:266–268`](../legal/privacy-policy.md)) is now **false**:
>   `PATCH /api/auth/me/` rejects a blank address. The real routes are the
>   reminder opt-out and `DELETE /api/auth/me/` — which the policy already
>   describes correctly at
>   [`privacy-policy.md:238–240`](../legal/privacy-policy.md) and which remains
>   the actual erasure path.
>
> Nothing here is a new *category* of data — it is the same `User.email` field
> the policy already describes — so this is a wording reconciliation, not a
> re-consent. It is listed here because the same rule applies as to the fourth
> correction: the policy and the code have to keep agreeing.

### 1.6 Backups, admin credentials, and the three dormant subsystems

> **There are four now.** The heading is left exactly as it was because
> [railway-deploy.md](railway-deploy.md) anchors to it in two places; the fourth
> is the turn-reminder cron, last bullet below.

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
  mail nobody can act on. **The same `EMAIL_*` values now carry three kinds of
  mail**: the reset link, the turn reminder below, and the **email-verification
  link** ([3.39](#3-done)) that every registration and address change sends. So
  switching them on buys three features, and leaving them off now has a visible
  effect on day one — a new player is told to check an inbox that receives
  nothing, and can never confirm, and so is never sent a turn reminder.
- **A cron schedule for `send_turn_reminders`.** The fourth dormant subsystem,
  and the newest. The command is written and tested ([3.37](#3-done)) but
  **nothing invokes it** — there is no Celery and no in-process scheduler by
  design, so the trigger has to be a platform cron. Create a second Railway
  service from the same repo with the start command
  `python manage.py send_turn_reminders` and a `*/10 * * * *` schedule;
  the full step, including the shared-`railway.json` health-check trap, is
  [railway-deploy.md step 8](railway-deploy.md#8-schedule-the-turn-reminder-cron).
  Tune the lead time with `TURN_REMINDER_LEAD_HOURS` (default **12**).

  > **Set `FRONTEND_BASE_URL` and `DEFAULT_FROM_EMAIL` on that service *before*
  > you schedule it.** The command **hard-refuses to send** while either is still
  > at its dev default — a `CommandError` naming them, before a single row is
  > touched — because a cron scheduled ahead of those values would mail every
  > waiting player at once, from `no-reply@localhost`, with a dead
  > `http://localhost:3000` link. Unrecallable, and to everybody. `--dry-run`
  > still rehearses on defaults; `--allow-dev-defaults` is the escape hatch and
  > belongs in no cron start command.

  > **The second ordering constraint, and the one you cannot walk back.**
  > Reminders are sent **only to confirmed addresses** ([3.39](#3-done),
  > [ADR-003](../decisions/adr-003-email-verification.md)). That gate exists in
  > code *today*, which is the point — it had to land **before the cron's first
  > run**, not after, because the first run is the one that would mail every
  > typo'd and abandoned address in the table at once. Bounces and spam
  > complaints from a blast like that sink the sending domain's reputation, and
  > **a burned domain cannot be un-burned** — the cost is paid by the players who
  > *did* confirm, whose reminders then land in spam. Nothing more is required of
  > the owner here beyond not reverting the gate; it is recorded so nobody
  > "helpfully" relaxes it to reach more players.
  >
  > Practical consequence for the rollout: **verified users are a small set on
  > day one**, and they only grow once `EMAIL_*` is real, because an address
  > cannot be confirmed while the confirmation mail is going to the console
  > backend. Configure mail first, then schedule the cron.

  Until this
  is done, players are still forfeited without warning
  ([2.3](#23-polish-and-hygiene)) — and note this closes only the *email* half:
  **push notifications remain absent and are blocked on the owner too**, needing
  EAS credentials and a device-token system that no coding session can supply.

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

  > **The verification link ([3.39](#3-done)) has the identical shape and the
  > identical gap.** `build_email_verification_url` builds
  > `{FRONTEND_BASE_URL}/verify-email/{token}`, the web client serves
  > `/verify-email/:token`
  > ([`VerifyEmailPage.jsx`](../../frontend/src/pages/VerifyEmailPage.jsx)), and
  > `mobile/app/` has no route for it — so a mobile player confirms in a browser
  > and comes back verified. Mobile implements the *resend* half only
  > ([`EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx)). Same
  > fix, same blocker: one deep-link/universal-link setup would close both, and
  > `FRONTEND_BASE_URL` being a single value is the reason neither is closed now.
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
- **Nothing tells a player their clock is running *yet* — the email half is
  built but unscheduled, and the push half does not exist.** The inactivity
  forfeit ([3.35](#3-done)) is fully built and both clients render a countdown,
  but only *while the game screen is open*. Two things changed and neither is
  finished:
  - **Email: coded, hardened, still dormant.** `manage.py send_turn_reminders`
    ([3.37](#3-done))
    mails the seat on the clock `TURN_REMINDER_LEAD_HOURS` (default 12) before
    the deadline, at most once per turn. **Nothing schedules it**, so today it
    sends nothing at all; it becomes real the moment the owner adds the cron
    service in
    [railway-deploy.md step 8](railway-deploy.md#8-schedule-the-turn-reminder-cron)
    — and then only for players who have **confirmed** their address
    ([3.39](#3-done): an address is required at registration now, but a *proven*
    one is what the command checks) **and who have not opted out**
    (`turn_reminder_emails`, default on, on `PATCH /api/auth/me/`). Those two
    filters are the audience, and it is deliberately narrower than "everyone with
    an address". A subsequent hardening pass added that opt-out,
    a refusal to send while `FRONTEND_BASE_URL` / `DEFAULT_FROM_EMAIL` are at
    their dev defaults, a claim-before-send stamp that makes overlapping cron runs
    duplicate-proof, and a per-row re-read so a slow run cannot mail a stale
    countdown about a finished game — all in [3.37](#3-done). None of that changes
    the status here: unscheduled is unscheduled. Tracked as owner work in
    [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems).
  - **Push: does not exist, and is owner-blocked rather than code-blocked.**
    Re-checked and still true. There is no `expo-notifications` dependency, no
    device-token column, no
    registration endpoint and no APNs/FCM credential anywhere in the tree. It is
    not a small coding task hidden behind an env var like the reminder is: it
    needs **EAS push credentials** (an Apple push key, an FCM server key) that
    only the owner can create, *and then* a device-token system to store and
    target. Nobody should read the reminder command as having closed this.
  So a player who never opens the app and never confirmed their address can
  still be forfeited without ever having seen the clock — mitigated by the
  48-hour default rather than solved. Requiring an address at registration
  ([3.39](#3-done)) shrinks that population but does not empty it: an address
  that is never confirmed, or is confirmed and then changed, is not mailed. The badge/in-app-presence side remains the same missing
  "presence" layer that defers live clocks
  ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)).
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
    email.** *(Superseded in one detail by [3.39](#3-done): `email` is
    **required** at registration now, and `PATCH /api/auth/me/` no longer accepts
    a blank value. Everything else in this entry still holds.)*
    `RegisterSerializer.email` is optional and blank-tolerant
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
    *(Superseded in one detail by [3.39](#3-done): the register forms' email
    field is no longer optional, and the profile screens can no longer clear an
    address.)*

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
35. **A player who walks away no longer strands the game forever.** This was the
    last remaining way for an online game to become unplayable with nobody at
    fault: there was no timeout, no forfeit and no clock, so the opponent's only
    exit was to stop playing. Designed in
    [ADR-002](../decisions/adr-002-inactivity-forfeit.md) and built to it.

    `Game.turn_started_at` (nullable, migration
    [`0005_game_turn_started_at.py`](../../backend/game/migrations/0005_game_turn_started_at.py),
    which also backfills `active` rows from `updated_at` — an approximation that
    deliberately errs *generous*, and touches only local dev games since no
    deployment exists) records when the **waiting seat** came on the clock,
    written by a single
    `_begin_turn()` helper at every point that seat changes — creation of an
    already-`active` game, `join`, `confirm_turn`, `offer_double`,
    `respond_to_double` on a take, and
    `next_game`. **`roll_dice` deliberately does not reset it**, or a player could
    roll and then stall indefinitely on a fresh deadline. `updated_at` could not
    stand in: `auto_now` bumps on every write for any reason.
    `TURN_TIMEOUT_HOURS` (**default 48**,
    [`settings.py`](../../backend/backgammon/settings.py)) is the only tunable,
    and dev still needs no `.env` — see
    [1.2](#12-domain-tls-and-the-production-environment).

    `POST /api/games/{id}/claim_timeout/` ([`views.py`](../../backend/game/views.py))
    is **pull-based** — there is no scheduler in this stack, so nothing sweeps
    expired games; the opponent claims, and for a live game the other client's
    ~3.5 s poll effectively *is* the sweeper. It requires an `active` game, two
    **registered** seats, neither closed, a recorded clock, an elapsed deadline,
    and a caller who holds the claimant seat, then finishes the game
    `win_type="timeout"` with a real `winner` and `1 × cube_value` through
    `_apply_game_result` like any other win. A **single** point because you cannot
    prove a gammon the opponent never let you play.

    **It is deliberately not `abandon`, and refuses a closed seat.** A deadlock is
    closed out unscored ([3.24](#3-done)); an inactivity forfeit is a genuine win.
    Nothing in the stats code changed — `"timeout"` has a real winner, so
    `losses = total − wins` scores it on both sides, and only `"abandoned"`
    remains in the exclusion.

    Both clients render a countdown **in both directions** (the seat on the clock
    sees its own time draining; the opponent sees when a claim opens),
    extrapolated locally on a 1 s interval from the serializer's `turn_deadline` —
    polling only reconciles it. (Against a *device* clock when this landed;
    against a server-corrected one since [3.36](#3-done).)
    [`TurnClock.jsx`](../../frontend/src/components/TurnClock.jsx) +
    [`ClaimTimeoutPanel.jsx`](../../frontend/src/components/ClaimTimeoutPanel.jsx)
    on web, [`TurnClockSection.jsx`](../../mobile/src/components/TurnClockSection.jsx)
    + [`useTurnClock.js`](../../mobile/src/game/useTurnClock.js) on mobile. The
    eligibility rule is **never re-derived client-side**: `turn_deadline` is null
    whenever a claim is impossible in principle, and `canClaimTimeout` — now the
    **third** member of the `seats.js` / `gating.js` stay-in-sync obligation —
    adds only the device clock and which seat is looking. Covered by
    [`test_timeout.py`](../../backend/game/tests/test_timeout.py) and the clock
    suites in both clients.

    **Three residues were recorded against this item, and two are now closed:**
    the device-clock assumption in the countdown ([3.36](#3-done)) and the
    misleading error when a claim beat a move to the row ([3.38](#3-done)). The
    third — nothing notifies a player that their clock is running unless the game
    screen is open — is only *half* closed: the email path exists
    ([3.37](#3-done)) but is dormant until a cron is scheduled, and push
    notifications do not exist at all. Both halves are tracked in
    [2.3](#23-polish-and-hygiene).
36. **A skewed device clock no longer mis-times a claim.** The countdown and the
    claim button were computed against `Date.now()` on the device, so a machine
    whose clock ran fast offered the claim button **before** the server's
    deadline — and the resulting request 400ed
    (`"Your opponent still has time to move — …"`) *every* time, because the two
    conditions differed by a fixed offset the client had no way to detect. A slow
    clock produced the mirror bug: the seat on the clock was shown time it no
    longer had.

    `GameSerializer` now emits **`server_now`** — the serialization instant, same
    ISO format as `turn_deadline`, **always present and never null**, including on
    finished games and on games with no clock running (it answers "what time is it
    on the server", which is not conditional on anything). Each client computes
    `server_now − device_now` once per fetch and applies that offset as a constant
    correction wherever a time is needed: the local 1 s countdown tick and the
    `now` passed to `canClaimTimeout`. **`canClaimTimeout`'s signature is
    unchanged** — it always took `now` as a parameter precisely so the caller
    decides what "now" means; only the callers changed.

    Three details that make it safe rather than merely correct: the derivation
    lives in `serverClockOffset`, a **fourth** member of the `seats.js` /
    `gating.js` stay-in-sync set; a new offset is adopted only when it moves by
    `OFFSET_EPSILON_MS` (1 s), so latency jitter cannot re-render the tree every
    poll; and any unusable `server_now` yields offset `0`, i.e. exactly the old
    device-clock behaviour rather than a broken clock. Past five minutes of
    disagreement both clients also *tell* the player their device is out of step
    and that the displayed time follows the server. Documented in
    [api.md](../architecture/api.md#server_now--the-clients-clock-is-not-trusted)
    and [clients.md](../architecture/clients.md#the-countdown-is-extrapolated-not-polled).

    The server stays authoritative regardless — this removes a class of
    *guaranteed-to-fail affordance*, it does not move any decision to the client.
37. **A turn reminder exists, and is dormant until a cron is scheduled.**
    `manage.py send_turn_reminders` emails the player on the clock
    `TURN_REMINDER_LEAD_HOURS` (**default 12**) before their deadline expires.

    **The architecture is the interesting part.** There is no Celery and no
    in-process scheduler in this stack, and mailing from inside a `GET` would be a
    write-on-read that fires only when the **opponent** polls — i.e. never for the
    player who most needs the mail. So this is a command a **platform cron**
    invokes; Railway supports cron jobs, and the runbook step is
    [railway-deploy.md step 8](railway-deploy.md#8-schedule-the-turn-reminder-cron).
    It is therefore *coded and dormant*, exactly like `REDIS_URL` and
    `SENTRY_DSN` — [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems).

    It **cannot spam**: `Game.turn_reminder_sent_at` (nullable, migration
    `0006_game_turn_reminder_sent_at`) records the send and `_begin_turn()` clears
    it whenever the waiting seat changes, so it is at most one reminder per turn
    no matter how often the cron runs — a ten-minute schedule is safe. It fires
    only for a **registered** waiting seat **with an
    email address**, on a game that is genuinely timeout-eligible, and it
    establishes that eligibility by calling `Game.timeout_deadline()` rather than
    reimplementing it (the SQL filter is only an optimisation), so it can never
    mail about a game nobody could claim. `--dry-run` lists recipients and writes
    nothing; `--limit N` caps mail *sent*, not rows examined; a row that raises is
    logged and stepped over rather than ending the run. The mail links to
    `{FRONTEND_BASE_URL}/game/{id}`, making that
    setting load-bearing for a second reason ([1.2](#12-domain-tls-and-the-production-environment)).

    **An adversarial review then found four things, all since fixed**, and a
    fifth surfaced by a test. They are the difference between a command that
    works and one that is safe to point at real inboxes:

    - **There is an opt-out.** `UserPreferences` (a `OneToOneField` on Django's
      stock `User`, migration `0007_userpreferences`) carries
      `turn_reminder_emails`, **default true**, exposed as a **writable** field on
      `GET`/`PATCH /api/auth/me/` alongside `email` — the only two writable fields
      there. The row is **optional and lazily created**, so absence means "all
      defaults" and `UserPreferences.reminders_enabled(user)` is the single source
      of truth both the command and the serializer read. Every reminder carries a
      footer naming the setting and where to switch it off. An address is
      collected for password reset, not for game mail, so this is what makes
      sending the mail at all legitimate — and why the privacy policy had to
      change with it ([1.5](#15-publish-the-legal-documents)).
    - **The fifth, and it was a real bug caught by a test.** The serializer
      resolves that field in `to_representation` via `reminders_enabled`, **not**
      via a DRF `default=`. DRF applies defaults on the way *in*, so a dotted
      source with no row serialises as `None` — and the clients' checkbox would
      have read "off" for every account that had never opened its settings, while
      the command mailed them anyway. A consent control misreporting consent.
      Do not refactor it back.
    - **It refuses to send on dev defaults.** If `FRONTEND_BASE_URL` or
      `DEFAULT_FROM_EMAIL` are still at their dev values the run exits with a
      `CommandError` naming them, **before touching a single row** — a precondition
      on the whole run, not a per-row skip, because a cron scheduled ahead of
      those values would mail every waiting player a dead `localhost` link from a
      bogus sender, in bulk and unrecallably. `--dry-run` still rehearses on
      defaults; `--allow-dev-defaults` is the escape hatch.
    - **Claim, then send.** The stamp is written *before* the mail, by a
      conditional UPDATE whose WHERE clause re-asserts that nobody else claimed
      this turn, that the turn is unchanged, and that the game is still active;
      `.update()`'s affected-row count decides the winner, so overlapping crons
      cannot double-mail. **Documented trade-off: at most one lost reminder, never
      a duplicate.** Un-claiming on a send failure looks like an improvement and
      is not — `send_mail` can raise after the message was accepted.
    - **Every decision is re-read per row.** `_candidates()` yields **ids only, on
      purpose**, so `_process` has nothing to work from but a fresh read and a
      fresh `now`. A long run would otherwise mail "move now or lose" about a game
      already lost, quoting a countdown minutes stale.

    Consequence for the runbook: with **no `EMAIL_*` configured a real run now
    declines to send rather than printing to the console backend** — the
    console-backend path is reached under `--dry-run` or `--allow-dev-defaults`,
    or once the two mail settings are real. Running it unconfigured is still
    harmless; it is just louder.

    **It forfeits nothing.** Timeout claims stay pull-based
    ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)); this command never
    writes a game result. And it is email only — **push notifications remain
    absent** ([2.3](#23-polish-and-hygiene)).
38. **The claim-vs-move race says what actually happened.** `claim_timeout` locks
    the row inside `transaction.atomic()`, so it wins any tie with a gameplay
    action arriving in the same instant. The loser re-read a `finished` game and
    was told **`"Game is not active."`** — true, and indistinguishable from a bug
    to the player who *did* move in time.

    `roll_dice`, `confirm_turn`, `offer_double` and `respond_to_double` now test
    for `status="finished"` **with `win_type="timeout"`** specifically, ahead of
    the generic branch, and return a message that names the forfeit. **It is still
    a 400**: the request genuinely cannot be performed, nothing was written, and a
    409 or a 200 would mean a new client code path for a state the next poll
    reveals anyway. Only the message changed (`_inactive_game_error`), and every
    other route to `"Game is not active."` — including `abandon`'s and
    `claim_timeout`'s own — is untouched.

    Both clients recognise it through a **new mirrored pair**,
    `frontend/src/api/errors.js` and `mobile/src/api/errors.js`, which share
    `isTimeoutClaimedError` and `TIMEOUT_CLAIMED_MESSAGE` verbatim and must stay
    that way (the file used to be mobile-only). Each renders a
    `TimeoutClaimedNotice` beside the turn clock in ordinary text rather than red
    error styling, suppresses `actionError` from then on, and re-fetches
    immediately so a live board is never left under a message saying the game is
    over. `claimTimeout` deliberately does **not** route through that handler —
    its own refusals mention claims and clocks and mean something else. See
    [api.md](../architecture/api.md#the-claim-vs-move-race) and
    [clients.md](../architecture/clients.md#when-a-claim-beats-your-move).
39. **An email address is required, and confirmed addresses are the only ones the
    cron will mail.** [ADR-003](../decisions/adr-003-email-verification.md).
    Three changes, and the third is the one that matters for going live.

    - **Required at registration.** `RegisterSerializer.email` is
      `required=True, allow_blank=False` (both clients previously sent `""` for
      an empty field, so blank had to be refused explicitly), and
      `UserSerializer.email` is no longer blankable on `PATCH /api/auth/me/` —
      an account must not reach a state the front door forbids. **Existing
      accounts are not rewritten and not locked out**; the serializer validates
      input, it does not audit the table.
    - **Verification exists.** `EmailVerification` (a `OneToOneField` on stock
      `User`, migration `0008_emailverification`, **no backfill**),
      `POST /api/auth/verify-email/confirm/` (unauthenticated — the link is
      followed from a mailbox) and `POST /api/auth/verify-email/resend/`
      (authenticated — it can only mail the caller), a read-only `email_verified`
      on `/api/auth/me/`, and the settings
      `EMAIL_VERIFICATION_TIMEOUT_HOURS` (72),
      `EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS` (60) and a fixed
      `EMAIL_VERIFICATION_SALT`. Tokens are `django.core.signing` — **no token
      table**, nothing to expire or sweep — and deliberately **not**
      `default_token_generator`, whose password-hash-derived single-use property
      is right for a credential change and wrong for a link a password change
      should not kill. The row stores **which address was proven**, not a
      boolean, so changing the address self-invalidates verification with no
      signal and no hook.
    - **`send_turn_reminders` checks it**, and that is the whole point. It is the
      app's only bulk, scheduled, unprompted sender; mailing "move now or lose"
      to typo'd and abandoned addresses earns bounces and complaints, those sink
      the sending domain, and a sunk domain lands the *legitimate* reminders in
      spam. **The gate is deliverability, not security** — which is also why it
      gates nothing else: login, play, password reset and deletion are untouched,
      and a verification wall on a game with a 48-hour forfeit clock would lock
      players out of live matches
      ([2.3](#23-polish-and-hygiene), [ADR-002](../decisions/adr-002-inactivity-forfeit.md)).
      An unverified seat is skipped **without stamping
      `Game.turn_reminder_sent_at`**, so confirming an address a minute later
      still gets that turn's reminder.

    **The ordering constraint is the operational takeaway**, and it is recorded
    in [1.6](#16-backups-admin-credentials-and-the-three-dormant-subsystems):
    this had to ship **before** the first cron run, because the first run against
    an unfiltered table is irreversible. It did. Nothing else about the cron's
    status changed — still unscheduled, still dormant.

    Send safety mirrors the reminder command: `issue_email_verification` stamps
    `last_sent_at` **before** mailing and leaves it stamped on failure
    (a provider can accept and then error, so "retry on failure" is an
    inbox-flooding tool), and the row-level cool-down is what actually holds
    while `CACHES` is per-worker `LocMemCache` and the `email_verify_resend`
    throttle is therefore not global. `send_email_verification` never raises, so
    a bad mail afternoon cannot 500 a registration.

    Client half shipped with it: the web client serves `/verify-email/:token`
    ([`VerifyEmailPage.jsx`](../../frontend/src/pages/VerifyEmailPage.jsx)) and
    both clients expose Resend from their email settings. **Mobile has no route
    for the link** — same browser hand-off as password reset, same cause, tracked
    together in [2.3](#23-polish-and-hygiene). Backend coverage is
    [`test_email_verification.py`](../../backend/game/tests/test_email_verification.py).
    Endpoint reference:
    [api.md](../architecture/api.md#post-apiauthverify-emailconfirm); flow:
    [auth.md](../architecture/auth.md#email-verification).
