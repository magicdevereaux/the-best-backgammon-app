# Postgres readiness

**Status: verified green on 2026-08-02.** The long-standing caveat in the
go-live ledger — *"the migrations have only ever been applied against SQLite"* —
is closed. This page records what was actually run, what the audit found, and the
two settings that still need attention at cutover.

Nothing is *running* on Postgres yet. Every environment still resolves to the dev
SQLite file; see [going-live.md](going-live.md) for the deploy state.

## What was run

A throwaway `postgres:16` container (server `PostgreSQL 16.14`), `DATABASE_URL`
pointed at it, using `psycopg2 2.9.12` / `Django 4.2.30`. Re-run in full on
**2026-08-02** after `0005_game_turn_started_at` landed.

| Check | Result |
|-------|--------|
| All 37 migrations against an **empty** database | applied clean — zero warnings, zero errors |
| `makemigrations --check --dry-run` | "No changes detected" — no model/migration drift |
| `0005` backfill against **real rows** (see below) | correct on all three assertions |
| `0005` reverse (`migrate game 0004`) | clean; column dropped, rows untouched; re-applies forward again |
| `python manage.py test game` | **596 passing**, zero failures, `check` reports 0 issues |

Re-run on **2026-08-03** after `0006_game_turn_reminder_sent_at` and
`0007_userpreferences` landed: 37 migrations clean on an empty database, 596
tests green. Both are plain additive schema changes — a nullable column and a new
table — with no data migration between them.

Both signals matter: the test runner builds its own `test_` database, so a clean
plain `migrate` against the real database was confirmed separately.

### The 0005 backfill was exercised with data, not just applied

`0005_game_turn_started_at` adds the inactivity clock
([ADR-002](../decisions/adr-002-inactivity-forfeit.md)): an
`AddField(DateTimeField(null=True))` plus a `RunPython` that copies `updated_at`
into `turn_started_at` for `status="active"` rows. **Migrating an empty database
runs that loop over zero rows and proves nothing**, so it was tested separately:
a second database migrated to `0004`, five `Game` rows inserted by hand (three
`active`, one `waiting`, one `finished`, each with a distinct `updated_at`,
sub-second precision included), then `migrate game 0005`. Insertion is raw SQL on
purpose — at `0004` the column does not exist yet, so the live ORM model cannot
write these rows.

All three assertions held on Postgres:

- **Every `active` row got `turn_started_at == updated_at`**, exact to the
  microsecond — no truncation or rounding crossing Django's `timestamptz`
  boundary.
- **`waiting` and `finished` rows were left `NULL`**, which is the valid "no
  clock running" value that `claim_timeout` and `Game.timeout_deadline` both
  refuse to act on.
- **`updated_at` was not itself rewritten.** This is the one that could plausibly
  have differed, and it is why the migration body uses `filter().update()` rather
  than `.save()` — `updated_at` is `auto_now`, so a `.save()` would have stamped
  every in-flight game with the migration's own run time and pushed every
  deadline forward. Post-migration `updated_at` matched the inserted values
  byte-for-byte on all five rows.

Reversing (`migrate game 0004`) is a declared `noop` on the `RunPython` side and
behaved that way: the column is dropped, all five rows survive with `updated_at`
intact, and `migrate game 0005` re-applies cleanly afterwards.

## The real risk was concurrency, not compatibility

The static audit found the schema and query layer clean. Recorded here so nobody
re-audits it:

- **No raw SQL.** No `.raw(`, no `RunSQL`, no `.extra(`. The only cursor in the
  codebase is the `SELECT 1` in
  [`health.py`](../../backend/backgammon/health.py). There is now exactly one
  `RunPython` — the `0005_game_turn_started_at` backfill — and it is pure ORM
  (`filter().update()`), so it carries no engine-specific SQL either.
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
- **Migrations are `AddField`s with explicit defaults**, no NOT NULL adds without
  one. The single data migration is the `0005` backfill above, which is pure ORM
  and was run against real rows.

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
