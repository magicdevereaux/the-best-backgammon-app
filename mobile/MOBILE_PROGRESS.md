# Mobile App Progress

React Native + Expo client for the-best-backgammon-app, talking to the existing
Django REST backend. This file tracks what's built and what's next across the
multi-session build.

---

## Stack

| Thing | Choice |
|---|---|
| Framework | Expo SDK **56** (React Native 0.85, React 19) |
| Navigation | Expo Router (file-based, `app/` dir) |
| Graphics | `react-native-svg` (board + dice) |
| Secure storage | `expo-secure-store` (JWT access/refresh tokens) |
| Backend | Existing Django REST API — **unchanged** |

> ⚠️ Node engine warning: SDK 56 prefers Node `>=22.13`. This machine has
> `v22.9.0`, which emits `EBADENGINE` warnings during install but bundled fine.
> Bump Node if you hit runtime issues.

---

## Session 1 — DONE ✅

Scaffolding, API/auth plumbing, and board rendering with basic move interaction.

### Project setup
- Scaffolded Expo blank app in `/mobile`, converted to **Expo Router**
  (`main: "expo-router/entry"`, `scheme: "backgammon"`, `app/` routes).
- Dark theme app-wide (`userInterfaceStyle: dark`, dark Stack header/content).
- Verified the whole app graph bundles (`expo export --platform ios` → 1204
  modules, no errors).

### API layer (`src/api/`)
- `config.js` — derives the backend URL. In dev it auto-detects the dev-machine
  LAN IP from Metro (`Constants.expoConfig.hostUri`) so physical devices work
  without hardcoding; falls back to `10.0.2.2` (Android emulator) / `localhost`
  (iOS sim). `MANUAL_OVERRIDE` constant to point elsewhere.
- `tokenStore.js` — JWT access/refresh persistence via **SecureStore**.
- `client.js` — `request()` wrapper mirroring web `apiClient.js`: injects bearer
  token, on 401 does a silent refresh-and-retry once.
- `auth.js` — `register` / `login` / `fetchMe` / `logout`.
- `games.js` — `fetchGames` / `fetchLobby` / `fetchGame` / `createGame` /
  `joinGame` / `rollDice` / `confirmTurn`.

### Game logic (`src/game/`)
- `logic.js` — direct port of `frontend/src/utils/gameLogic.js`
  (`getLegalMoves`, `applyMove`, `canBearOff`, `checkWinner`, `isBlotHit`).
  Same coordinate conventions as the backend (bar = 0, bear-off = 25).
- `useGame.js` — port of the web `useGame` hook: move **staging** (tentative
  board/dice + `pendingMoves`), `legalMoves` memo, roll/reset/confirm.

### UI (`src/components/`, `app/`)
- `Board.jsx` — **native SVG board** reusing the web visual language:
  alternating burgundy/amber triangular points, felt + darkened home half,
  mahogany bar, off tray, checker stacking (count badge past 5), gold selection
  ring, green/amber legal-destination highlighting. Touch handled via a
  transparent `Pressable` overlay grid (big tap targets that scale with width →
  responsive to phone/tablet).
- `Dice.jsx` — SVG pip faces (1–6), used dice greyed out.
- `GameControls.jsx` — Roll / Reset / Confirm buttons (dark theme).
- `context/AuthContext.jsx` — `user` = undefined(loading)/null(guest)/object.
- Screens:
  - `app/_layout.jsx` — SafeArea + AuthProvider + dark Stack.
  - `app/index.jsx` — lobby: auth row, "New hotseat game", list of your games
    (reloads on focus).
  - `app/login.jsx` — login/register toggle + "continue as guest".
  - `app/game/[id].jsx` — the game screen: board + dice + controls, staging and
    confirming turns against the backend.

### What works end-to-end now
Create a hotseat game → open it → roll → tap a checker (legal destinations glow)
→ tap a destination to stage → Confirm Turn commits to the backend and flips to
the other player. Bar entry and bear-off are wired through the same tap flow.

---

## Session 2 — DONE ✅

Turn-loop polish & correctness. The staging system, Confirm/Reset, and
bar/bear-off handling already shipped in Session 1, so Session 2 verified those
and delivered the genuine increment around dice and the turn loop. **Nothing
from Session 1 was rebuilt.**

### Dice: exact used vs remaining (bug fix)
- The previous screen passed the *remaining* dice array but a `usedCount` that
  greyed the first N of them — so a `[3,5]` roll with the 3 played rendered just
  `[5]` and greyed the 5 (backwards). Now `Dice` takes `rolled` + `remaining`
  and greys the correct faces via a **multiset difference** (handles mixed dice
  played out of order, and doubles greying one face per move).

### Tap-to-roll
- `Dice` has a new `canRoll` state: a tappable **"Tap to roll"** prompt (two `?`
  dice) shown when it's the player's turn and no dice are rolled yet. Rolling
  moved off the button and onto the dice, per the Session 2 goal.

### Per-move undo
- `useGame` gained `undoMove()` — reverts only the **last** staged move by
  replaying the rest from the authoritative board (shared `replay()` helper, same
  die-consumption rule as `stageMove`). Sits alongside `resetTurn()` (full
  revert). New **Undo** button in `GameControls`.

### Pass-turn affordance
- When a roll yields **no legal moves** and nothing is staged, the screen shows
  a "No legal moves for this roll — tap Pass Turn" hint and the primary button
  relabels from **Confirm Turn → Pass Turn**. Confirming zero moves is how the
  backend records an explicit pass (its silent-pass bug was fixed earlier).

### Touched files
- `src/components/Dice.jsx` — `rolled`/`remaining`/`canRoll`/`onRoll` API,
  multiset used-detection, tap-to-roll prompt, `?` die face.
- `src/components/GameControls.jsx` — Undo / Reset / Confirm-or-Pass; rolling
  removed (now on the dice). Takes `turnActive`/`hasPendingMoves`/`hasLegalMoves`.
- `src/game/useGame.js` — `replay()` helper + `undoMove()`.
- `app/game/[id].jsx` — derived `turnActive`/`canRoll`/`hasLegalMoves`/`mustPass`,
  new Dice/GameControls wiring, pass hint.
- Verified: `expo export --platform ios` bundles clean (no errors).

---

## Session 3 — DONE ✅

Game lifecycle (game-over + matches) and online play. Ported the web's
match/game-over/lobby flows to native against the same backend endpoints.
**Nothing from Sessions 1–2 was rebuilt.**

### Game-over screen
- New `src/components/GameOverScreen.jsx` — a native `Modal` overlay (port of the
  web component): winner + win-type line (normal / **gammon** / **backgammon**),
  points awarded with the explanatory detail, and action buttons. Reads
  `winner` / `win_type` / `points_value` straight off the finished game.

### Matches (score + completion)
- New `src/api/matches.js` — `fetchMatch` / `createMatch` / `nextGame` /
  `joinMatch` (mirrors web `matchApi.js`).
- New `src/components/MatchScore.jsx` — compact "first to N" score banner shown
  above the board during a match.
- Game screen fetches the match when `game.match` is set and re-pulls on status
  change, so scores update when a game finishes.
- Match completion: when the match reaches its target, `GameOverScreen` shows
  "… wins the match!" and offers **New Match**; otherwise it offers **Next Game**
  (via `matches/{id}/next_game/`). Match creation added to the lobby with a
  3 / 5 / 7 / 9 length picker.

### Opponent move sync
- `useGame` now **polls** the backend every 3.5s while the game is `active`,
  swapping in state only when it actually changed (by `updated_at`) and **never**
  while the local player has staged moves (guarded via refs) so it can't clobber
  an in-progress turn.
- Added **pull-to-refresh** (`RefreshControl`) on the game screen via a new
  silent `refresh()` / `refreshing` on the hook (doesn't trigger the full-screen
  loader like `reload()` does).

### Online play
- Lobby: **Create online game** (logged-in users → a waiting game), **Open
  games** list with Join, and **Join by code** (numeric game id; works for guests
  with a name). Hotseat + match creation share the guest-name field.
- Game screen `waiting` state: shows the **game code**, a **Share invite link**
  button (`react-native` `Share` + an `expo-linking` `backgammon://game/<id>`
  deep link), and an on-device Join. Pull-to-refresh while waiting.
- Deep links resolve through the `backgammon` scheme + expo-router file route, so
  an opened `backgammon://game/<id>` link lands on that game.

### Touched files
- New: `src/api/matches.js`, `src/components/MatchScore.jsx`,
  `src/components/GameOverScreen.jsx`.
- `src/game/useGame.js` — `refresh()` / `refreshing` + 3.5s active-game poller.
- `app/game/[id].jsx` — match fetch, waiting/share/join panel, game-over modal,
  match score banner, pull-to-refresh.
- `app/index.jsx` — online create, match creation (length chips), open-games
  list, join-by-code.
- Verified: `expo export --platform ios` bundles clean (no errors).

> ⚠️ Online play across **separate devices** needs the backend reachable from
> both and the joining device able to hit it — see the networking note under
> "How to run" (`ALLOWED_HOSTS`, `runserver 0.0.0.0:8000`). Same-device hotseat
> and matches work without any of that.

---

## Session 4 — DONE ✅

Online turn-ownership, profile/stats, and polling polish. **Nothing from
Sessions 1–3 was rebuilt.**

### Turn-ownership gating (online read-only view)
- The game screen now derives ownership from the seat user FKs already in the
  game payload (`player1_user` / `player2_user`) vs the logged-in `user.id`.
- A game between **two distinct accounts** is treated as online and **gated**:
  a device may only act on the seat its user owns, and only on that seat's turn.
  When it's the opponent's turn the board is **read-only** with a steady
  "Waiting for {name}…" indicator (no dice-roll, no controls). A logged-in user
  who owns **neither** seat sees a **"Spectating · {name}'s turn"** read-only view.
- **Hotseat / guest games stay fully interactive for both seats** (they aren't a
  two-distinct-account game), so nothing about local play changed.
- Known limitation (Session 5): a *guest*-joined online game (opponent has no
  account, so `player2_user` is null) isn't detected as two-account and stays
  locally interactive. The main logged-in-vs-logged-in online flow is gated.

### Profile & stats screen
- New `app/profile.jsx` (+ `profile` route in `_layout`, reachable by tapping the
  username in the lobby auth row, which now also shows `W/L`). Pulls
  `/api/auth/me/` via `fetchMe` and shows a headline Wins / Losses / Win-rate
  trio plus games played, gammons, backgammons, gammon rate, and points won/lost
  — the full stat set the backend already computes.
- Refreshes on focus (so finishing a game updates the numbers) and on
  pull-to-refresh; syncs the fresh `me` back into `AuthContext` so the lobby W/L
  stays current. Guests get a "log in to track stats" prompt.

### Polling polish (seamless sync)
- The active-game poller now **pauses when the screen is unfocused or the app is
  backgrounded** (`useFocusEffect` + `AppState` refs), so it doesn't churn the
  network or yank state in after navigating away.
- Combined with the existing `updated_at` de-dupe (no re-render on unchanged
  responses) and the staged-moves guard, opponent moves now arrive without
  flashing or resetting an in-progress turn.

### Touched files
- New: `app/profile.jsx`.
- `src/game/useGame.js` — focus/AppState gating on the poller.
- `app/game/[id].jsx` — seat/ownership derivation, read-only + waiting/spectating
  states, gated dice/controls.
- `app/_layout.jsx` — `profile` route.
- `app/index.jsx` — username → profile nav, W/L in the auth row.
- Verified: `expo export --platform ios` bundles clean (no errors).

---

## How to run

```bash
cd mobile
npm start            # then press i / a, or scan QR in Expo Go
```

**Backend must be reachable from the device.** The Django dev server and its
`ALLOWED_HOSTS` only allow `localhost`/`127.0.0.1` right now:

- **iOS simulator** — works as-is (`localhost`).
- **Android emulator** — uses `10.0.2.2`; add `"10.0.2.2"` to `ALLOWED_HOSTS`.
- **Physical device (Expo Go)** — uses your LAN IP; add that IP to
  `ALLOWED_HOSTS` (or set `ALLOWED_HOSTS = ["*"]` for dev). Run Django with
  `python manage.py runserver 0.0.0.0:8000` so it binds the LAN interface.

(These are local dev-env tweaks; no backend **code** changes are required for the
feature itself. Left untouched this session per scope.)

---

## Not done yet / Next sessions

### Session 2 — completed items
- [x] Exact per-die used/remaining display (was inferred + buggy).
- [x] Tap-to-roll dice interaction.
- [x] Pass-turn affordance when a roll has no legal moves.
- [x] Per-move undo (in addition to full Reset).

### Session 3 — completed items
- [x] Game-over screen (winner, normal / gammon / backgammon, points).
- [x] Match score display + completion (Next Game / New Match).
- [x] Opponent move sync — 3.5s active-game polling + pull-to-refresh.
- [x] Online play — create online game, share/deep-link, join by code, open games.

### Session 4 — completed items
- [x] Profile & stats screen (headline record + full lifetime stats).
- [x] Turn-ownership gating in online play (read-only + waiting/spectating).
- [x] Polling polish — pause when unfocused/backgrounded; no flashing on sync.

### Session 5 (suggested) — hardening & coverage
- [ ] **Gate guest-joined online games** — a two-device game where the opponent
      joined as a guest (`player2_user` null) isn't currently detected as online,
      so it stays locally interactive. Decide a signal (e.g. treat a game as
      online when the local user owns exactly one seat and a second player is
      present by name) and gate accordingly, without breaking true hotseat.
- [ ] **Tests** — still none on mobile. Add Jest + RNTL for `logic.js`,
      `useGame` (staging/undo/replay), the dice multiset display, and the
      ownership-gating derivation. The web suite is a good template.
- [ ] Friendlier invalid-code / join-error handling in the lobby (currently the
      game screen just shows "Game not found").
- [ ] Optional polish: only poll on the opponent's turn; a subtle "synced" tick;
      animate the game-over modal in.
- [ ] App icons / splash still the Expo defaults; bump Node ≥22.13.

### Cross-cutting / tech debt
- [ ] No tests yet on mobile — add Jest + RNTL for `logic.js`, `useGame`, Board
      interaction (the web suite is a good template; logic port is identical).
- [ ] Error/empty/offline states are minimal.
- [ ] Consider extracting the duplicated game logic into a shared package so web
      and mobile import one copy instead of two ports.
- [ ] App icons/splash still the Expo defaults.
- [ ] Bump Node to ≥22.13 to clear the SDK 56 engine warning.
