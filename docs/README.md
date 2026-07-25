# Docs index

Deeper reference for **The Best Backgammon App**. Start at
[`CLAUDE.md`](../CLAUDE.md) (working context for a coding session) or
[`README.md`](../README.md) (setup and feature overview); come here when you need
detail.

> **Ground rule for every file under `docs/`:** describe what *exists* in the
> code. Anything intended-but-unbuilt belongs in a clearly-labelled **Planned /
> Not Yet Implemented** section, so a reader can always tell "work with this"
> from "don't assume it's there."

## Architecture

| Doc | What it answers |
|-----|-----------------|
| [overview.md](architecture/overview.md) | How backend, web, and mobile relate; auth; online multiplayer; sync. Read this first. |
| [api.md](architecture/api.md) | Full HTTP reference — every endpoint, request/response shape, and error code. |
| [clients.md](architecture/clients.md) | Map of both client apps: file layout, staged-turn flow, routing, state, gating, rendering. |
| [game-logic.md](architecture/game-logic.md) | The rules engine, combined-move DFS, maximal-dice enforcement, cube scoring. |
| [data-model.md](architecture/data-model.md) | Django models and schema. |
| [auth.md](architecture/auth.md) | Accounts, JWT endpoints, client token lifecycle + refresh-retry, test map, limitations. |

## Operations

| Doc | What it answers |
|-----|-----------------|
| [going-live.md](operations/going-live.md) | Production-readiness audit: hard blockers, should-fix, and post-launch items on the way to shipping. |

## Decisions

Architecture decision records — the *why* behind a choice, kept even after the
code moves on.

| ADR | Decision |
|-----|----------|
| [adr-001](decisions/adr-001-combined-moves.md) | Combined (multi-die) moves are expanded client-side; the backend only knows single hops. |

## Adding to these docs

- New ADR: `decisions/adr-NNN-short-slug.md`, next number in sequence, and add a
  row above.
- New architecture doc: put it in `architecture/`, add a row above, and link it
  from [`CLAUDE.md`](../CLAUDE.md) if a session would need it routinely.
- Changing behaviour? Update the doc in the same commit as the code. Stale docs
  are worse than missing ones, because a session will trust them.
