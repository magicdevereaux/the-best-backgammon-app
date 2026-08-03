# Deploying the Backend to Railway

The host decision is made: the Django API runs on **Railway**. This is the
step-by-step runbook for getting it there the first time, plus the smoke test
that tells you it actually worked.

> **Ground rule:** this doc describes the repo **as it is today**. The only file
> added for Railway is [`railway.json`](../../railway.json); nothing else in the
> tree is host-specific. Everything that has not been done yet lives under
> [Not yet done](#not-yet-done) so nobody mistakes a plan for a fact.
>
> Steps marked **[OWNER]** need a credential, a purchase, or a decision that no
> coding session can supply. Everything else is mechanical.

Read [going-live.md](going-live.md) first if you haven't — it is the audit of
what is and isn't production-ready. As of its 2026-08-02 pass the code-side list
is down to three items, only one of which touches a deploy:
[2.2](going-live.md#22-django-admin-has-no-2fa-ip-allowlist-or-lockout), the
admin login — which has no 2FA, no IP allowlist and no lockout, and which sits at
`/admin/` unless you set `ADMIN_URL`. Decide what you're doing about that before
you create the superuser in [step 5](#5-create-the-superuser). Both list endpoints are scoped now; neither
enumerates its table. This doc covers *deployment mechanics only*.

---

## What Railway is being asked to run

**Only the Django backend.** The web client goes to Vercel and the mobile client
ships through EAS — see [The two clients](#the-two-clients). Railway serves
`https://<your-domain>/api/...`, `/healthz/`, and the Django admin at whatever
`ADMIN_URL` says (default `/admin/`).

### Why the Dockerfile builder, and what `railway.json` does

Railway picks a builder by inspection. Because a root
[`Dockerfile`](../../Dockerfile) exists, it selects the **Dockerfile builder** —
not Railpack, which is what you'd get on a repo with no Dockerfile. That is the
behaviour we want, and [`railway.json`](../../railway.json) makes it explicit
rather than inferred:

| Key | Value | Why |
|---|---|---|
| `build.builder` | `DOCKERFILE` | Pin the choice so adding/removing files can't silently switch builders. |
| `build.dockerfilePath` | `Dockerfile` | Repo root; the build context is the root and sources are copied from `backend/`. |
| `build.watchPatterns` | `backend/**`, `Dockerfile`, `.dockerignore`, `railway.json` | This is a monorepo. Without this, a commit touching only `frontend/`, `mobile/`, or `docs/` redeploys the API for nothing. **Corollary: a docs-only or client-only commit will not trigger a deploy. That is intentional** — use *Deploy → Redeploy* in the dashboard if you need one anyway. |
| `deploy.healthcheckPath` | `/healthz/` | Railway holds the new deploy out of rotation until this returns 200, so a container that boots but can't reach Postgres never takes traffic. |
| `deploy.healthcheckTimeout` | `120` (seconds) | The container runs `migrate` before gunicorn binds. A first deploy against an empty Postgres runs the whole migration history; 120s is headroom. |
| `deploy.restartPolicyType` / `MaxRetries` | `ON_FAILURE` / `10` | Restart a crashed container, but stop after 10 attempts so a genuinely broken release fails visibly instead of crash-looping forever. |
| `deploy.numReplicas` | `1` | One instance. See the [throttling caveat](#known-caveats-on-railway) before raising it. |
| `deploy.sleepApplication` | `false` | Serverless sleep would add a cold-start delay to the first request and is a poor fit for a polling mobile client. |

No `startCommand` is set: the Dockerfile's `CMD` is already correct for Railway
(verified below).

### The Dockerfile is already Railway-compatible

Two things a Railway deploy needs from a container, both confirmed by reading
[`Dockerfile`](../../Dockerfile):

**It binds the injected `$PORT`.** Railway sets `PORT` in the environment and
routes to it; a container that hardcodes 8000 gets no traffic. The final line is:

```
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn backgammon.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --timeout ${GUNICORN_TIMEOUT:-60} --access-logfile - --error-logfile -"]
```

`--bind 0.0.0.0:${PORT:-8000}` uses Railway's value when present and falls back
to 8000 for plain `docker run`. The `ENV ... PORT=8000` earlier in the file is
only that fallback — Railway's injected value overrides it.

**It migrates before serving.** `python manage.py migrate --noinput &&` runs
ahead of gunicorn in the same `CMD`, so **no separate release step is needed**.
Do not add a Railway "pre-deploy command" that migrates as well; you'd run
migrations twice per deploy for no benefit.

`exec` is used for gunicorn, so it becomes PID 1 and receives Railway's
`SIGTERM` directly at shutdown. Static files are collected at build time and
served by WhiteNoise, so nothing needs a volume or a CDN to serve `/static/`.

[`Procfile`](../../Procfile) is **not used by Railway** in this configuration —
it exists for Heroku-style hosts and is inert here. Leave it; it costs nothing.

**No changes are required to `Dockerfile` or `Procfile` for this deploy.**

---

## 1. Create the service

1. **[OWNER]** In the Railway dashboard: *New Project → Deploy from GitHub repo*,
   and pick this repository. Authorise the GitHub app for it if prompted.
2. Leave the root directory as the repo root. The Dockerfile builds from the
   root with sources under `backend/`; setting a root directory of `backend/`
   **breaks the build**, because the Dockerfile would no longer be in context.
3. Railway reads [`railway.json`](../../railway.json) automatically. Confirm the
   build logs say it is using the Dockerfile builder.
4. Expect the **first deploy to fail**, and that's fine — `SECRET_KEY` and
   `DATABASE_URL` aren't set yet. Add the database and variables, then redeploy.

## 2. Attach Postgres

**Postgres is mandatory, not a preference.** Railway containers have an
**ephemeral filesystem**: every deploy, restart, and crash-recovery starts from
the built image. SQLite at `backend/db.sqlite3` would be silently recreated
empty on each deploy and every account, game, and match would vanish. There is
no warning when this happens — the app just comes back looking brand new.

1. **[OWNER]** In the project: *New → Database → Add PostgreSQL*. It provisions
   in the same project and private network.
2. On the **API service** (not the database), add a variable:

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   That `${{Service.VARIABLE}}` form is Railway's dashboard **reference**
   syntax — it resolves at deploy time to whatever the Postgres plugin currently
   exposes, so a credential rotation doesn't require editing anything here.
   Don't paste the literal connection string.

   Prefer the private-network variant (`${{Postgres.DATABASE_URL}}` already
   resolves to the internal host on current Railway projects). If your project
   exposes both, the private one avoids egress charges and doesn't traverse the
   public internet.

3. `DATABASE_URL` is parsed by `dj-database-url` in
   [`settings.py`](../../backend/backgammon/settings.py); `psycopg2-binary` is
   already pinned in [`requirements.txt`](../../backend/requirements.txt). This
   is a config change, not a code change.

4. Railway's managed Postgres URLs generally include `sslmode` already, so leave
   `DB_SSL_REQUIRE` at its default `False`. Set it to `True` only if a
   connection fails complaining about SSL.

> **These migrations have only ever run against SQLite.** The first deploy is
> the first Postgres run. Watch the deploy log for the `migrate` output before
> declaring victory — see the [smoke test](#first-deploy-smoke-test).

## 3. Set the environment variables

Full annotated source of truth:
[`backend/.env.example`](../../backend/.env.example). Set these in the Railway
service's *Variables* tab. **Never commit them** — `.env` is gitignored and no
secrets are in the tree today.

### Required

| Variable | Value | Notes |
|---|---|---|
| `SECRET_KEY` | 50-char random string | **[OWNER]** Generate fresh (below). Startup **fails loudly** without it when `DEBUG=False`. Never reuse the dev fallback. |
| `DEBUG` | `False` | The single flag that turns on the whole hardening block: SSL redirect, HSTS, secure cookies, nosniff, proxy SSL header. |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference, per step 2. |
| `ALLOWED_HOSTS` | see below | Comma-separated hostnames, no scheme. |
| `CORS_ALLOWED_ORIGINS` | web app origin | Comma-separated, **scheme included**. |
| `CSRF_TRUSTED_ORIGINS` | web app origin | Same value as CORS in practice. |

Generate the secret key locally:

```bash
cd backend
venv/Scripts/python.exe -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
```

**`ALLOWED_HOSTS` has a Railway-specific gotcha.** Railway's health check does
not hit your public domain — it requests `/healthz/` over the internal network,
and Django will reject it with a `400 DisallowedHost` if that hostname isn't
allowed. The result is a deploy that looks healthy in the logs but never passes
its health check. Include both the public domain and the health-check host:

```
ALLOWED_HOSTS=${{RAILWAY_PUBLIC_DOMAIN}},healthcheck.railway.app
```

`RAILWAY_PUBLIC_DOMAIN` is injected by the platform, so this keeps working
across the generated `*.up.railway.app` name. Once a custom domain is attached
(step 5), append it: `...,api.example.com`. If the health check still 400s, read
the request log line for the exact `Host` value it sent and add that.

### Recommended for the first deploys

| Variable | First-deploy value | Notes |
|---|---|---|
| `SECURE_HSTS_SECONDS` | `60` | **Set this.** The default is **1 year with `includeSubDomains` and `preload`**, and HSTS is very hard to undo — a browser that caches it will refuse plain HTTP to your whole domain tree for a year. Start at 60, ramp once the domain is settled. |
| `ADMIN_URL` | an unguessable word, e.g. `ops-7f3a2c` | **Set this before [step 5](#5-create-the-superuser).** Path the Django admin is served from; slashes are stripped, blank falls back to the default. Unset → `/admin/`, which every scanner on the internet probes continuously. This is obscurity, not security — nothing else about the admin login is hardened (no 2FA, no IP allowlist, no lockout, and DRF's throttles do not cover it). See [going-live.md 2.2](going-live.md#22-django-admin-has-no-2fa-ip-allowlist-or-lockout). |
| `LOG_LEVEL` | `INFO` | Default. Railway captures stdout; logging is console-only by design. |
| `WEB_CONCURRENCY` | `3` | Gunicorn workers. Lower it to `2` on a small instance. See the [throttling caveat](#known-caveats-on-railway). |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | **Turns the throttle limits global.** Unset → `LocMemCache`, per worker, wiped every deploy. Add *New → Database → Add Redis* to the project and use the reference form, exactly as with Postgres. See the [throttling caveat](#known-caveats-on-railway). |
| `SENTRY_DSN` | your project's DSN | **[OWNER]** The only thing standing between a 500 and someone hearing about it. Nothing is sent when it's empty — `sentry_sdk.init()` isn't even called. Pair with `SENTRY_ENVIRONMENT=production` and, optionally, `SENTRY_RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}`. |
| `EMAIL_HOST` (+ `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`) | your SMTP provider | **[OWNER]** **No mail leaves the box without this** — and there are now **two** kinds: the password-reset link, and the turn reminder from [step 8](#8-schedule-the-turn-reminder-cron). With `EMAIL_HOST` empty the app uses Django's *console* backend and prints both into the Railway log. Plain SMTP, so SES / Postmark / Resend / Mailgun all work; nothing in the code names a provider. |
| `TURN_TIMEOUT_HOURS` | `48` (the default) | How long a player may leave a game waiting on them before the opponent can claim an inactivity forfeit (`POST /api/games/{id}/claim_timeout/`). **Nothing breaks if you never set it** — it is listed here because it is the one gameplay rule you can retune on a running service without a deploy, and 48 hours is a guess until real players pace real games. Lower it for a fast-play launch, raise it if people complain about losing to the clock. See [going-live.md 3.35](going-live.md#3-done). |
| `TURN_REMINDER_LEAD_HOURS` | `12` (the default) | How long *before* `turn_deadline` the `send_turn_reminders` command mails the player on the clock. Read only by that command, so it does nothing at all until you schedule it — [step 8](#8-schedule-the-turn-reminder-cron). Keep it comfortably below `TURN_TIMEOUT_HOURS`, or the reminder window opens the moment the turn starts and the mail stops being a warning. |
| `DEFAULT_FROM_EMAIL` | `Backgammon <no-reply@your-domain>` | The `From:` on both outgoing mails. Defaults to `Backgammon <no-reply@localhost>`, which most providers will reject or bin. **`send_turn_reminders` hard-refuses to send while this is at the default** — [step 8](#8-schedule-the-turn-reminder-cron). |
| `FRONTEND_BASE_URL` | `https://backgammon.example.com` | **Set this the moment mail is on**, and **required before the reminder cron will send anything at all** ([step 8](#8-schedule-the-turn-reminder-cron)). It is the origin of the link in **both** outgoing mails — `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}` and the turn reminder's `{FRONTEND_BASE_URL}/game/{id}` — and it defaults to `http://localhost:3000` — wrong *silently*, since the mail still sends. It is the **web client's** origin, not the API's: the web router serves that exact path and nothing else does, so a mobile user who requests a reset also finishes it in a browser. Verify it with [smoke test step 5](#first-deploy-smoke-test). |

### Optional (defaults are sane — omit unless you need to change them)

`DB_CONN_MAX_AGE` (600) · `DB_SSL_REQUIRE` (False) · `SECURE_SSL_REDIRECT`
(True) · `THROTTLE_RATE_ANON` (120/min) · `THROTTLE_RATE_USER` (240/min) ·
`THROTTLE_RATE_LOGIN` (10/hour) · `THROTTLE_RATE_REGISTER` (5/hour) ·
`THROTTLE_RATE_REFRESH` (60/hour) · `THROTTLE_RATE_PASSWORD_RESET` (5/hour) ·
`THROTTLE_RATE_PASSWORD_RESET_CONFIRM` (20/hour) · `SENTRY_ENVIRONMENT` ·
`SENTRY_RELEASE` · `SENTRY_TRACES_SAMPLE_RATE` (0) · `ADMINS` (empty; comma-separated
`Name <addr>` pairs, and it needs `EMAIL_HOST` to send anything) · `SERVER_EMAIL`
(root@localhost) · `GUNICORN_TIMEOUT` (60, read by the Dockerfile's `CMD`).

**Do not set `PORT`.** Railway injects it; overriding it means the container
binds a port nothing routes to.

Leave `SECURE_SSL_REDIRECT` at its default `True` — Railway terminates TLS and
forwards `X-Forwarded-Proto`, which the app trusts when `DEBUG=False`, so there
is no redirect loop. `/healthz/` is exempt from the redirect
(`SECURE_REDIRECT_EXEMPT`) precisely so in-network HTTP probes work.

## 4. Deploy and migrate

1. Trigger a deploy (redeploy after setting variables, or push to the tracked
   branch).
2. Migrations run **automatically** as part of the container's `CMD` — see
   [above](#the-dockerfile-is-already-railway-compatible). Watch the build/deploy
   log for the `Applying game.0001_initial… OK` sequence on the first run.
3. If you ever need to run one by hand — a data fix, a squashed migration, a
   `showmigrations` check — use the Railway CLI:

   ```bash
   railway link                 # once, from the repo root
   railway run python backend/manage.py showmigrations
   ```

   `railway run` executes locally with the service's environment (so it talks to
   the real Postgres). `railway ssh` gets you a shell inside the running
   container, where the working directory is `/app` and the command is just
   `python manage.py …`.

## 5. Create the superuser

**[OWNER]** `createsuperuser` is interactive, so run it against the deployed
database:

```bash
railway ssh
python manage.py createsuperuser
```

Choose a strong password, and **set `ADMIN_URL`** (see the variable table above)
before you do — with it unset the admin sits at `/admin/`, the path every scanner
probes. Moving it is obscurity, not security: there is still no IP allowlist, no
2FA and no lockout, and **DRF's throttles do not cover the admin login** — it is a
plain Django view, so nothing rate-limits password guessing against it. See
[going-live.md 2.2](going-live.md#22-django-admin-has-no-2fa-ip-allowlist-or-lockout)
before treating this as safe; it is the largest remaining attack surface in the
tree.

## 6. Custom domain and TLS

**[OWNER]**

1. Railway assigns a `*.up.railway.app` domain immediately. Everything works on
   it; a custom domain is cosmetic until you ship clients.
2. *Settings → Networking → Custom Domain* on the API service, e.g.
   `api.example.com`. Railway shows a CNAME target; add it at your DNS provider.
3. TLS certificates are issued and renewed by Railway. The app needs no cert
   config — it trusts `X-Forwarded-Proto` and redirects HTTP → HTTPS itself when
   `DEBUG=False`.
4. **After the domain resolves**, update the variables that name it:
   - `ALLOWED_HOSTS` → append `api.example.com`
   - `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` → the **web app's** origin
     (e.g. `https://backgammon.example.com`), not the API's
   - then redeploy, and only then ramp `SECURE_HSTS_SECONDS`.

## 7. Backups

**[OWNER]** Enable the Postgres service's automated backups in its settings, and
**restore one once to prove it works**. An untested backup is not a backup.
Nothing in this repo can do this for you.

## 8. Schedule the turn-reminder cron

`manage.py send_turn_reminders` emails the player on the clock before their
inactivity deadline expires. **The command exists; nothing calls it.** Until you
schedule it here it is dormant, exactly like `REDIS_URL` and `SENTRY_DSN` —
players still get forfeited with no warning ([going-live.md
2.3](going-live.md#23-polish-and-hygiene)).

**Why it is a platform cron and not application code.** There is no Celery and
no in-process scheduler in this stack, and the obvious shortcut — mailing from
inside a `GET` — is a write-on-read that only fires when the **opponent** polls,
i.e. exactly the player who does *not* need reminding. A player whose opponent
stopped opening the app would never be mailed at all. So the trigger has to come
from outside the request cycle, and Railway supports cron jobs natively.

> **Do this first: set `FRONTEND_BASE_URL` and `DEFAULT_FROM_EMAIL`.**
>
> **The command refuses to send while either is at its dev default**, and it
> refuses *before it touches a single row* — this is a precondition on the whole
> run, not a per-row skip. A cron scheduled ahead of those two values would mail
> every waiting player at once, from `Backgammon <no-reply@localhost>`, with a
> link to `http://localhost:3000`. That mail is unrecallable and it goes to
> everybody, so an unset variable is a hard exit rather than a warning.
>
> Both defaults live in [`settings.py`](../../backend/backgammon/settings.py) as
> the named constants `DEV_DEFAULT_FRONTEND_BASE_URL` / `DEV_DEFAULT_FROM_EMAIL`,
> and the command compares against *those*, not against literals of its own — so
> the two modules cannot drift about what "unset" looks like.
>
> **What the failure looks like.** The run exits non-zero (a `CommandError`) with
> the offending names in the message, and sends nothing:
>
> ```
> CommandError: Refusing to send: FRONTEND_BASE_URL and DEFAULT_FROM_EMAIL are
> still at the dev default, so every reminder would carry a dead link or a bogus
> sender. Set FRONTEND_BASE_URL and DEFAULT_FROM_EMAIL in the environment, or
> pass --dry-run to rehearse or --allow-dev-defaults to send anyway.
> ```
>
> On Railway a cron run that exits non-zero shows as a **failed** run in the
> service's deploy list with that line in its log — which is the intended
> outcome, not a problem to work around. Set the variables (step 3) on the **cron
> service**, not just the API service; they are separate services with separate
> variable sets, and this is the mistake to expect.
>
> Two escape hatches, both deliberate:
> - **`--dry-run` still runs on dev defaults.** It sends nothing, so rehearsing
>   the command locally or against the deployed database is always allowed — and
>   is the rehearsal step, substep 5 below.
> - **`--allow-dev-defaults` sends anyway.** For testing real delivery against a
>   local mail catcher. **Never put it in a cron start command**; if you find
>   yourself reaching for it there, the variables are what need fixing.

1. **[OWNER]** **Add a second service from the same repo**, e.g. `reminders`.
   Railway's cron runs *a service's own start command* on a schedule, and the
   API service's start command is gunicorn — schedule that and you get a second
   web server every ten minutes, not a reminder. The cron therefore needs its
   own service. Same repo, same root directory, same Dockerfile; only the start
   command and the schedule differ.

2. On that service, set **Settings → Deploy → Custom Start Command**:

   ```
   python manage.py send_turn_reminders
   ```

   A cron service must **exit** when it is finished, which this command does.

3. Set **Settings → Cron Schedule** on the same service:

   ```
   */10 * * * *
   ```

   Ten minutes is the recommended interval, and the reasoning has not changed:
   the mail is **at most one per turn** (see below), so the frequency only
   controls how close to `turn_deadline − TURN_REMINDER_LEAD_HOURS` the mail
   actually goes out. Running it often costs a handful of indexed reads and buys
   punctuality. **Duplicates are impossible even if a run overruns its own
   interval and two invocations overlap** — the row is claimed by a conditional
   UPDATE before the mail is composed into an SMTP session, and the database
   picks the winner. So there is no need to pad the schedule against a slow run.

4. **Give it the same variables as the API service** — at minimum
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SECRET_KEY`, `DEBUG=False`, the
   `EMAIL_*` set, **`FRONTEND_BASE_URL` and `DEFAULT_FROM_EMAIL`** (without which
   the run refuses to send at all, per the box above), and
   `TURN_REMINDER_LEAD_HOURS` if you are not taking the
   default. It talks to the same database and sends through the same provider;
   it needs no `ALLOWED_HOSTS` and no domain, because it serves nothing.

   > **Trap: [`railway.json`](../../railway.json) is repo-level, so the second
   > service reads it too.** It pins `deploy.healthcheckPath: "/healthz/"`, and a
   > container that exits without ever answering HTTP fails that check — every
   > run would be marked unhealthy and `restartPolicyType: ON_FAILURE` would keep
   > retrying it. **Clear the health check on the cron service in the dashboard**
   > (dashboard settings override the file per service). The custom start command
   > from step 2 likewise replaces the Dockerfile's `CMD`, so the cron does *not*
   > re-run `migrate` — which is correct; the API service already does that on
   > every deploy.

5. **Rehearse, then verify.** The command has flags for exactly this, and the
   order matters — dry-run first, because it is the only one that works before
   the variables above are set:

   ```bash
   railway run python backend/manage.py send_turn_reminders --dry-run
   railway run python backend/manage.py send_turn_reminders --limit 1
   ```

   `--dry-run` lists every recipient and game id it *would* mail, sends nothing,
   and **leaves `turn_reminder_sent_at` untouched** — so a real run afterwards
   still mails everything it listed. `--limit N` caps the number of reminders
   **sent**, not rows examined, so a first run against a backlog can be spread
   over several invocations instead of arriving as one blast. Both print a
   one-line summary: candidates considered, sent, skipped, errors.

   A row that fails for any reason is logged with its game id and **stepped
   over**, never allowed to end the run — a cron job that dies on one bad row
   stops mailing everybody. Note the contrast with the dev-defaults check above:
   *that* one takes the whole run down on purpose, because a partial blast of
   useless mail is not better than none.

**It is safe to run when nothing is configured — because it declines to.** The
refusal above is the first thing that happens, so an unconfigured real run mails
nobody and says why. Under `--dry-run` (or `--allow-dev-defaults`) it proceeds,
and with no `EMAIL_*` variables set the mail goes to Django's console backend and
lands in the cron container's log — informative, not harmful. With no eligible
games it processes nothing and exits.

**Who it will and will not mail.** Only a **registered** waiting seat, with an
**email address on file**, who has **not opted out**
(`UserPreferences.turn_reminder_emails`, default on, toggled at
`PATCH /api/auth/me/` — see
[api.md](../architecture/api.md#patch-apiauthme)), on a game that is genuinely
timeout-eligible: the SQL filter is an optimisation, and the verdict comes from
`Game.timeout_deadline()` — the same method the serializer's `turn_deadline` and
`claim_timeout` use — rather than being reimplemented, so the reminder can never
fire for a game nobody could claim. Every mail closes with a footer naming the
setting and where to switch it off; there is no tokenised unsubscribe link,
deliberately, because that would be a new unauthenticated write surface to save
one tap behind a login the recipient already has.

**Every decision is re-read per row, and that is why a slow run stays honest.**
The candidate query yields **primary keys only, on purpose** — a run over a large
backlog can outlive the truth of its own snapshot, so `_process` is given nothing
to work from but a fresh read of the row and a fresh `now`. A game won, claimed,
abandoned or simply played on since the run started is dropped rather than mailed
"move now or lose", and the countdown quoted in the body cannot be stale by the
run's own duration.

**The mail links back to the web client**, `{FRONTEND_BASE_URL}/game/{id}`
(`build_game_url`, built exactly as the reset link is and from the same
setting). That is the **second** consumer of `FRONTEND_BASE_URL`: a wrong value
now produces two kinds of useless mail, not one. There is still no mobile deep
link, so a mobile player follows it in a browser. It also mails a game whose
deadline has *already* passed — with different wording, because the claim is
pull-based and an expired game just sits there until the opponent asks.

**It cannot spam.** `Game.turn_reminder_sent_at` records the send, and
`_begin_turn()` clears it whenever the waiting seat changes, so it is at most
one reminder per turn no matter how often the cron runs. The stamp is written
**before** the mail, by a conditional UPDATE that re-asserts in its WHERE clause
that nobody else claimed this turn, that the turn is unchanged, and that the game
is still active; `.update()`'s affected-row count decides which of two racing
processes sends. **The trade-off, so nobody "fixes" it later: at most one lost
reminder, never a duplicate.** Un-claiming after a failed send looks like an
improvement and is not — `send_mail` can raise after the message was already
accepted, so the retry would double-mail. That column arrived in
migration `0006_game_turn_reminder_sent_at` — see
[data-model.md](../architecture/data-model.md#the-turn-reminder-stamp-turn_reminder_sent_at).

**What it does not do:** it does not forfeit anything. Timeout claims stay
pull-based ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)) and this
command never writes a game result. It also does not reach a player who set no
email address, and there is **no push notification** — see
[going-live.md 2.3](going-live.md#23-polish-and-hygiene).

---

## First-deploy smoke test

Run these in order against the deployed URL. Substitute your domain.

**1. Health check.** This is the one Railway itself gates on.

```bash
curl -i https://api.example.com/healthz/
# HTTP/2 200
# {"status": "ok", "database": "ok"}
```

`"database": "ok"` means the `SELECT 1` in
[`health.py`](../../backend/backgammon/health.py) reached Postgres. A **503**
with `"database": "error"` means the app is up but `DATABASE_URL` is wrong. A
**400** means `ALLOWED_HOSTS` doesn't include the host you requested.

**2. Register a user.** Exercises the DB write path, the password validators,
and the throttle wiring. **Include an `email`** — it is optional to the
serializer but step 5 needs an account that has one.

```bash
curl -i -X POST https://api.example.com/api/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"username":"smoketest","password":"a-long-unguessable-passphrase","email":"you@example.com"}'
# 201 with access + refresh tokens
```

A `400` naming the password is the validators working correctly (`"password"`
and `"12345678"` are rejected). Remember the register throttle is **5/hour** —
don't burn it retrying.

**3. Create a game.** Exercises the game tables and the serializer.

```bash
curl -i -X POST https://api.example.com/api/games/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <access token from step 2>" \
  -d '{}'
# 201 with a full board state
```

**4. Read it back.**

```bash
curl -s https://api.example.com/api/games/ | head -c 400
```

Expect a **bare JSON array**, not a `{count, next, previous, results}` envelope
— `BareListPagination` returns bare arrays deliberately, because both clients
`.map()` over the response.

The step-3 game shows up here even unauthenticated because a game created with
no `player2_name` starts in `waiting` status, and open games are the public
lobby. **`list` is scoped now** (`_list_scope_q`), so this is not a general
"dump every row" check any more: pass `Authorization` to see your own games too,
and don't be alarmed if a two-name hotseat game you create later is *absent*
from the anonymous response — that is the scoping working. `GET /api/matches/`
is scoped the same way (`_match_list_scope_q`) and has **no lobby clause at
all**, so an anonymous read of it returns only fully-guest matches — very often
an empty array, which is correct rather than broken.

**5. Password reset round trip.** Worth doing on the first deploy specifically,
because both ways this can be misconfigured fail *silently* — the request always
returns 200 (see below) whether or not mail went anywhere.

```bash
curl -i -X POST https://api.example.com/api/auth/password-reset/ \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
# 200 {"detail":"If an account with that email address exists, a password reset
#      link has been sent to it."}
```

**That body is fixed.** It is byte-identical for a registered address, an
unregistered one, and a dead SMTP host — deliberately, so the endpoint can't be
used to enumerate accounts (send failures are caught and logged, never surfaced).
**A 200 therefore proves nothing on its own.** Go and look:

- **`EMAIL_HOST` unset** → Django's console backend printed the whole message
  into the Railway deploy log. Find it there and read the link out of it. This is
  the fastest way to confirm the flow works before you have an SMTP provider.
- **Check the link's origin.** It is `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`.
  If it says `http://localhost:3000`, `FRONTEND_BASE_URL` is unset — the mail will
  keep sending and keep being useless. It must be the **web client's** origin, not
  the API's; the web router is the only thing that serves that path.
- Then finish the cycle with the uid and token from the link:

  ```bash
  curl -i -X POST https://api.example.com/api/auth/password-reset/confirm/ \
    -H "Content-Type: application/json" \
    -d '{"uid":"<uid>","token":"<token>","new_password":"another-long-passphrase"}'
  # 200 {"detail":"Your password has been reset. You can now log in."}
  ```

  Log in with the new password to confirm. Note the confirm step **blacklists
  every outstanding refresh token** for that account, so the tokens from step 2
  are dead afterwards — if you want to keep using them for steps 6–8, do this
  step last. Throttles here are `password_reset` **5/hour** and
  `password_reset_confirm` **20/hour**.

**6. Admin login.** Visit `https://api.example.com/admin/` and log in as the
superuser. Confirms sessions, secure cookies, and static files (WhiteNoise
serves the admin CSS — an unstyled admin page means `collectstatic` didn't take).

**7. Confirm the HTTPS redirect.** `curl -I http://api.example.com/api/games/`
should return a `301` to `https://`. `/healthz/` should **not** redirect.

**8. Redeploy and re-check.** Trigger a second deploy and confirm the user from
step 2 can still log in. This is the test that proves you're on Postgres and not
on an ephemeral SQLite file.

---

## The two clients

Railway hosts the API only. Neither client is deployed by anything in this repo.

**Web → Vercel.** Create React App inlines env vars **at build time**, so
`REACT_APP_API_BASE_URL` must be set in Vercel's build environment, not at
runtime:

```
REACT_APP_API_BASE_URL=https://api.example.com
```

Root directory `frontend/`, build `npm run build`, output `build/`. No `/api`
path segment — the client appends it. A trailing slash is tolerated and
stripped. See [`frontend/.env.example`](../../frontend/.env.example) and
[going-live.md 1.4](going-live.md#14-set-the-web-builds-api-origin). Whatever
origin Vercel serves must appear in the API's `CORS_ALLOWED_ORIGINS` **and**
`CSRF_TRUSTED_ORIGINS`.

**Mobile → EAS.** `EXPO_PUBLIC_API_URL` is supplied per build profile in
[`mobile/eas.json`](../../mobile/eas.json) (`preview.env` and
`production.env`, both currently blank and marked `OWNER TODO`), with
`expo.extra.apiUrl` in [`mobile/app.json`](../../mobile/app.json) as the
fallback. The client **refuses to guess in a release build** and rejects a
non-`https://` URL as a configuration error rather than failing as an opaque
network timeout — so set it to the full `https://api.example.com`. Details in
[going-live.md 1.3](going-live.md#13-store-the-mobile-api-url-and-submission-credentials).

---

## Known caveats on Railway

- **The filesystem is ephemeral.** Anything written to disk at runtime is gone
  on the next deploy. Today the app writes nothing — no uploads, no file
  logging, no local media — so Postgres is the only state that matters. If a
  feature ever adds uploads, it needs object storage (S3/R2), not a container
  path.
- **Throttle counters are per-process and reset on every deploy — *unless you
  set `REDIS_URL`.*** `CACHES` now switches to `RedisCache` the moment
  `REDIS_URL` is non-empty and falls back to `LocMemCache` when it isn't. Leave
  it unset and, with `WEB_CONCURRENCY=3`, the effective limits are ~3× the
  configured ones (`login` 10/hour behaves like ~30/hour), raising
  `numReplicas` multiplies it again, and every counter resets on deploy. Add
  Railway's Redis plugin and reference its URL (step 3) and the limits become
  global and survive deploys. See
  [going-live.md 3.22](going-live.md#3-done).
- **Docker's `HEALTHCHECK` instruction is not what Railway uses.** Railway
  probes `deploy.healthcheckPath` from `railway.json`. The `HEALTHCHECK` line in
  the Dockerfile is for plain `docker run` and other hosts; both point at
  `/healthz/`, so they agree, but only one of them is load-bearing here.
- **`watchPatterns` suppresses deploys for client- and docs-only commits.** By
  design (see the table above) — redeploy manually if you need one.
- **A 500 notifies nobody — *unless you set `SENTRY_DSN`.*** `sentry-sdk[django]`
  is installed and `sentry_sdk.init()` fires only when a DSN is present, so with
  the var unset the app reports nowhere and logs go to Railway's log viewer and
  that's it — you'd learn about an outage from players. Create a Sentry project,
  paste the DSN into the service's variables (step 3), and errors ship tagged by
  environment and release. `ADMINS` is the no-account alternative, but it needs
  `EMAIL_HOST` configured too. See
  [going-live.md 3.25](going-live.md#3-done).

---

## Not yet done

Nothing in this section exists in the repo or in a Railway project. Listed so a
future session can tell "already handled" from "still open".

- **No Railway project has been created**, and no deploy has run. This runbook
  has not been executed end to end; the Railway-specific half is written from the
  repo's contents and Railway's documented behaviour, not from a deploy log.
  Treat the first run as the validation pass and correct anything here that turns
  out wrong. What *has* been checked, by running the app locally on 2026-08-02
  and driving it over HTTP: `/healthz/`, the `confirm_turn` higher-die rejection,
  the closed-seat 403 and the `abandon` exit from it, and the full password-reset
  cycle including the console-backend mail — so the request/response shapes in
  the [smoke test](#first-deploy-smoke-test) are observed, not inferred. The
  platform behaviour around them (health-check host, `$PORT` injection, Postgres,
  ephemeral disk) is still unverified.
- **No staging environment.** A single production service is assumed. Railway
  environments would give a staging API for the `preview` EAS profile
  (`mobile/eas.json`), which currently has nowhere to point.
- **No Redis service.** `settings.py` *does* read `REDIS_URL` now and switches
  the cache backend on it, so adding the plugin and referencing its URL is all
  that is needed — but no plugin exists yet, so throttle counters are still
  per-worker. This is the one item in this list that is a five-minute fix.
- **No CI-driven deploy.** [`ci.yml`](../../.github/workflows/ci.yml) runs the
  three test suites, `manage.py check --deploy --fail-level WARNING`, and the
  production web build — but it does not deploy. Railway deploys straight from
  the tracked branch on push, independently of whether CI passed.
- **No Sentry project, no mail provider, no load test.** The code for the first
  two is in place and gated on `SENTRY_DSN` / `EMAIL_HOST` respectively; both
  are dormant until the owner creates the accounts. See
  [going-live.md 1.6](going-live.md#16-backups-admin-credentials-and-the-three-dormant-subsystems)
  and [2.3](going-live.md#23-polish-and-hygiene).
- **No cron service, so no turn reminders are sent.** `send_turn_reminders`
  exists and is tested, but no Railway service, start command or schedule has
  been created for it — [step 8](#8-schedule-the-turn-reminder-cron) has never
  been executed. Until it is, a player is only warned about their clock while
  the game screen is open. **Mobile push notifications are a separate, larger
  gap that no amount of Railway configuration closes** — they need EAS
  credentials and a device-token system, and neither exists
  ([going-live.md 2.3](going-live.md#23-polish-and-hygiene)).
