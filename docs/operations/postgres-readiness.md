# Postgres readiness

**Status: verified green on 2026-08-02.** The long-standing caveat in the
go-live ledger — *"the migrations have only ever been applied against SQLite"* —
is closed. This page records what was actually run, what the audit found, and the
two settings that still need attention at cutover.

Nothing is *running* on Postgres yet. Every environment still resolves to the dev
SQLite file; see [going-live.md](going-live.md) for the deploy state.

## What was run

A throwaway `postgres:16` container, `DATABASE_URL` pointed at it, using
`psycopg2 2.9.12` / `Django 4.2.30`.

| Check | Result |
|-------|--------|
| All 34 migrations against an **empty** database | applied clean — zero warnings, zero errors |
| `makemigrations --check --dry-run` | "No changes detected" — no model/migration drift |
| `python manage.py test game` | **474 passing**, zero failures, `check` reports 0 issues |

Both signals matter: the test runner builds its own `test_` database, so a clean
plain `migrate` against the real database was confirmed separately.

## The real risk was concurrency, not compatibility

The static audit found the schema and query layer clean. Recorded here so nobody
re-audits it:

- **No raw SQL.** No `.raw(`, no `RunSQL`, no `RunPython`, no `.extra(`. The only
  cursor in the codebase is the `SELECT 1` in
  [`health.py`](../../backend/backgammon/health.py).
- **No JSON querying.** `board_state` and `dice_values` are read and written
  whole, never filtered *into*, so the JSONField operator differences never arise.
- **The classic `LIKE` trap does not exist here.** SQLite's `LIKE` is
  case-insensitive and Postgres's is not, but there is not a single
  `__contains` / `__startswith` / `__endswith` in the backend.
  [`views.py`](../../backend/game/views.py) already uses `email__iexact`, which
  becomes `ILIKE` and is correct.
- **Ordering is deterministic.** Both models set
  `Meta.ordering = ["-created_at", "-id"]`, which covers every `.first()` call
  and both paginators. SQLite tends to return insertion order and Postgres does
  not, so this would otherwise have been the subtle one.
- **Stats types are stable.** `Sum` is integer on both engines and the
  percentages use Python true division — no Decimal/float divergence.
- **Migrations are `AddField`-only** with explicit defaults. No data migrations,
  no NOT NULL adds without a default.

What the audit *did* find was that **no mutating action was transactional** —
every one was a read-modify-write, and SQLite's global write lock had been
serializing them for free. Postgres with three gunicorn workers would not. That
is fixed: see the row-locking convention in [CLAUDE.md](../../CLAUDE.md) and
`RowLockingMixin` in [`views.py`](../../backend/game/views.py).

## Still to do at cutover

- **Set `DB_SSL_REQUIRE=True` on Railway.** It defaults to `False`. Railway's
  injected `DATABASE_URL` normally carries `sslmode=require` already, so this is
  belt-and-braces, but the default is the wrong one for production.
- **`conn_max_age=600` and `conn_health_checks=True` are already correct.**
  Revisit only if a pgbouncer is introduced, where a long-lived connection age
  interacts badly with transaction pooling.

## One thing worth knowing, unrelated to the cutover

Registration in [`serializers.py`](../../backend/game/serializers.py) matches
`username=` exactly, which is case-**sensitive** on both engines — so `Alice` and
`alice` can both register today, and will continue to after the move. This is not
a Postgres regression. Change it to `username__iexact` on its own merits if you
want, but do it deliberately: it is a behaviour change for existing accounts.
