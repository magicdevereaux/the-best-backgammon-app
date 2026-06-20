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

### Session 3 (suggested) — game lifecycle & online play
Carried over from Session 2's lifecycle goals plus online play:
- [ ] **Game-over screen** — win type (normal / gammon / backgammon) + points;
      port `frontend/src/components/GameOverScreen.jsx`. The backend already
      returns `winner` / `win_type` / points on the finished game.
- [ ] **Refresh for opponent moves** — no realtime yet; add pull-to-refresh and/or
      an interval re-fetch on the game screen so a confirmed opponent turn shows
      up (the `reload()` already exists on `useGame`, just needs wiring/polling).
- [ ] Online game creation + shareable join (deep links via the `backgammon://`
      scheme) and a join-by-id / waiting-room UI.
- [ ] Match mode (first to N points) + match score display — port `matchApi` and
      `MatchScore` / match flow.

### Session 4 (suggested) — profile & stats
- [ ] Profile screen with lifetime stats (wins, losses, gammons, points, etc.).
- [ ] Wire the auth `me` stats already returned by the backend.

### Cross-cutting / tech debt
- [ ] No tests yet on mobile — add Jest + RNTL for `logic.js`, `useGame`, Board
      interaction (the web suite is a good template; logic port is identical).
- [ ] Error/empty/offline states are minimal.
- [ ] Consider extracting the duplicated game logic into a shared package so web
      and mobile import one copy instead of two ports.
- [ ] App icons/splash still the Expo defaults.
- [ ] Bump Node to ≥22.13 to clear the SDK 56 engine warning.
