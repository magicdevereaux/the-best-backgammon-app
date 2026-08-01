---
name: railway-deploy
description: Deploying this backend to Railway — the committed railway.json builder/healthcheck config, the env vars a service needs, and the two traps (ALLOWED_HOSTS must include healthcheck.railway.app; the filesystem is ephemeral so Postgres is mandatory).
---

# Railway deploy

**Deploy target is Railway** (decided 2026-07-31; the owner's `howl` project runs
there). Nothing is deployed yet — the app is *deployable*, but no service,
domain, TLS, or production env values exist.

The step-by-step runbook — service creation, Postgres plugin and `DATABASE_URL`,
every env var, migrations, superuser, domain, smoke test — is
[docs/operations/railway-deploy.md](../../../docs/operations/railway-deploy.md).
Read it before touching anything in the Railway dashboard.

## What `railway.json` already pins

[`railway.json`](../../../railway.json) at the repo root:

- Pins the **Dockerfile** builder — *not* Railpack, which is what `howl` uses.
  Don't "fix" this to match the other project.
- Sets `healthcheckPath: /healthz/` — served by
  [`backend/backgammon/health.py`](../../../backend/backgammon/health.py),
  unauthenticated, does a `SELECT 1`, returns 503 if the DB is unreachable.
- Scopes `watchPatterns` to `backend/**` so client- and docs-only commits don't
  redeploy the API.

The root `Dockerfile` and `Procfile` run gunicorn and stay host-agnostic; the
Dockerfile `CMD` binds Railway's injected `$PORT` and runs `migrate` before
`exec`-ing gunicorn as PID 1.

## The two traps

1. **`ALLOWED_HOSTS` needs `healthcheck.railway.app`.** Railway probes the health
   check from an internal host, so the var must list it alongside
   `${{RAILWAY_PUBLIC_DOMAIN}}`. Miss it and the probe 400s while the app logs
   look perfectly healthy.
2. **The filesystem is ephemeral.** SQLite would be wiped every deploy, so
   **Postgres is mandatory** on Railway, not optional. `psycopg2-binary` and
   `dj-database-url` are already installed and `DATABASE_URL` is honoured — but
   the migrations have only ever been applied against SQLite, so verify them on
   an empty Postgres before cutting over.

## Env var reminders

Vars are documented in [`backend/.env.example`](../../../backend/.env.example).
Two behaviours that bite in production specifically:

- `SECRET_KEY` falls back to the dev key **only** under `DEBUG`. With
  `DEBUG=False` a missing key raises `ImproperlyConfigured` at startup.
- Security settings (SSL redirect, HSTS, secure cookies, nosniff,
  `X_FRAME_OPTIONS`) are gated on `DEBUG` and apply only when `DEBUG=False`.
