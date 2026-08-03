# The Two Clients — Web & Mobile

A map of the **React web app** ([`frontend/`](../../frontend/)) and the **Expo
mobile app** ([`mobile/`](../../mobile/)): what lives where, which files are
counterparts, and where the two deliberately diverge. Describes what exists in the
code today; intended-but-unbuilt pieces are under
[Planned / Not Yet Implemented](#planned--not-yet-implemented).

For how the clients relate to the backend see [overview.md](overview.md); for the
rules engine itself see [game-logic.md](game-logic.md); for tokens and login see
[auth.md](auth.md).

## At a glance

| | Web | Mobile |
|---|---|---|
| Framework | React 18, Create React App (`react-scripts` 5) | Expo SDK 56, React Native 0.85, React 19 |
| Entry | [`src/index.jsx`](../../frontend/src/index.jsx) → `App.jsx` | `expo-router/entry` → [`app/_layout.jsx`](../../mobile/app/_layout.jsx) |
| Routing | `react-router-dom` 6 (`BrowserRouter`) | Expo Router file-based `Stack` |
| Board | Inline SVG in the DOM, colors via CSS custom properties | `react-native-svg` + a transparent `Pressable` touch overlay |
| Theme | [`src/theme.css`](../../frontend/src/theme.css) (CSS vars) | [`src/theme.js`](../../mobile/src/theme.js) (`colors` object) |
| API base | `apiUrl()` in [`src/api/config.js`](../../frontend/src/api/config.js) — `REACT_APP_API_BASE_URL` at build time, else root-relative (CRA `proxy` → `:8000` in dev) | absolute `API_BASE_URL` from Metro's LAN host |
| Token store | `localStorage` (`access` / `refresh`) | `expo-secure-store` (`bg_access` / `bg_refresh`) |
| Opponent sync | polling every 3.5 s in `useGame`, **online games only** (`isOnlineGame`) | polling every 3.5 s in `useGame`, focus/foreground-gated |
| Turn gating | **none** client-side; server 403 surfaces as an error | `gating.js` + `seatRegistry.js` hide controls |
| Closed-seat handling | `seats.js` — deadlock banner + abandon panel | `gating.js` — same, in `AbandonGameSection` |
| Inactivity clock | `TurnClock.jsx` (own 1 s interval) + `ClaimTimeoutPanel.jsx` | `TurnClockSection.jsx` + the `useTurnClock` hook |
| Clock source | both: a **1 s local tick** on a device clock corrected by the payload's `server_now` offset ([below](#server_now--the-offset-not-the-device-clock)) | same |
| Tests | 312, `__tests__/` beside sources | 190, `src/**/__tests__/` |

Orientation and packaging are mobile-only concerns: `app.json` locks the app to
**landscape**, dark UI style, scheme `backgammon://`, bundle id
`com.magicdevereaux.backgammon`, with `expo-router`, `expo-secure-store` and
`expo-splash-screen` plugins and typed routes enabled.

## File map & counterparts

Rows are counterparts — same job, one file per client.

| Job | Web | Mobile |
|-----|-----|--------|
| App shell / nav | [`src/App.jsx`](../../frontend/src/App.jsx) (routes + `Nav`) | [`app/_layout.jsx`](../../mobile/app/_layout.jsx) (`Stack`, `hydrateSeats()`) |
| Game-engine port | [`src/utils/gameLogic.js`](../../frontend/src/utils/gameLogic.js) | [`src/game/logic.js`](../../mobile/src/game/logic.js) |
| Staged-turn hook | [`src/hooks/useGame.js`](../../frontend/src/hooks/useGame.js) | [`src/game/useGame.js`](../../mobile/src/game/useGame.js) |
| HTTP wrapper (+401 retry) | [`src/api/apiClient.js`](../../frontend/src/api/apiClient.js) | [`src/api/client.js`](../../mobile/src/api/client.js) |
| Auth calls | [`src/api/authApi.js`](../../frontend/src/api/authApi.js) (also holds token storage) | [`src/api/auth.js`](../../mobile/src/api/auth.js) + [`src/api/tokenStore.js`](../../mobile/src/api/tokenStore.js) |
| Game endpoints | [`src/api/gameApi.js`](../../frontend/src/api/gameApi.js) | [`src/api/games.js`](../../mobile/src/api/games.js) |
| Match endpoints | [`src/api/matchApi.js`](../../frontend/src/api/matchApi.js) | [`src/api/matches.js`](../../mobile/src/api/matches.js) |
| Session context | [`src/context/AuthContext.jsx`](../../frontend/src/context/AuthContext.jsx) | [`src/context/AuthContext.jsx`](../../mobile/src/context/AuthContext.jsx) |
| Lobby | [`src/pages/LobbyPage.jsx`](../../frontend/src/pages/LobbyPage.jsx) | [`app/index.jsx`](../../mobile/app/index.jsx) |
| Game screen | [`src/pages/GamePage.jsx`](../../frontend/src/pages/GamePage.jsx) | [`app/game/[id].jsx`](../../mobile/app/game/[id].jsx) |
| Login | `LoginPage.jsx` + `RegisterPage.jsx` (two routes) | [`app/login.jsx`](../../mobile/app/login.jsx) (one screen, three modes: login / register / reset) |
| Ask for a reset link | [`src/pages/ForgotPasswordPage.jsx`](../../frontend/src/pages/ForgotPasswordPage.jsx) (`/forgot-password`) | the `"reset"` mode of `app/login.jsx` |
| Profile | [`src/pages/ProfilePage.jsx`](../../frontend/src/pages/ProfilePage.jsx) | [`app/profile.jsx`](../../mobile/app/profile.jsx) |
| Email settings (profile) | [`src/components/EmailSettings.jsx`](../../frontend/src/components/EmailSettings.jsx) | [`src/components/EmailSection.jsx`](../../mobile/src/components/EmailSection.jsx) |
| Account deletion (profile) | [`src/components/DeleteAccountPanel.jsx`](../../frontend/src/components/DeleteAccountPanel.jsx) | [`src/components/DeleteAccountSection.jsx`](../../mobile/src/components/DeleteAccountSection.jsx) |
| Abandon a deadlocked game | [`src/components/AbandonGamePanel.jsx`](../../frontend/src/components/AbandonGamePanel.jsx) | [`src/components/AbandonGameSection.jsx`](../../mobile/src/components/AbandonGameSection.jsx) |
| Inactivity countdown + claim | [`src/components/TurnClock.jsx`](../../frontend/src/components/TurnClock.jsx) + [`ClaimTimeoutPanel.jsx`](../../frontend/src/components/ClaimTimeoutPanel.jsx) | [`src/components/TurnClockSection.jsx`](../../mobile/src/components/TurnClockSection.jsx) (countdown + claim in one) |
| Closed-seat + clock predicates | [`src/utils/seats.js`](../../frontend/src/utils/seats.js) | the top half of [`src/game/gating.js`](../../mobile/src/game/gating.js) |
| Friendly error readings | [`src/api/errors.js`](../../frontend/src/api/errors.js) (`isTimeoutClaimedError`, `TIMEOUT_CLAIMED_MESSAGE`) | [`src/api/errors.js`](../../mobile/src/api/errors.js) (those two, **kept identical**, plus mobile-only `friendlyJoinError`) |
| Claim-beat-your-move notice | [`src/components/TimeoutClaimedNotice.jsx`](../../frontend/src/components/TimeoutClaimedNotice.jsx) | [`src/components/TimeoutClaimedNotice.jsx`](../../mobile/src/components/TimeoutClaimedNotice.jsx) |
| Board | [`src/components/Board.jsx`](../../frontend/src/components/Board.jsx) | [`src/components/Board.jsx`](../../mobile/src/components/Board.jsx) |
| Dice / Cube / Controls / Game over / Match score | `src/components/{Dice,DoublingCube,GameControls,GameOverScreen,MatchScore}.jsx` | same five filenames under `mobile/src/components/` |

**Mobile-only files** (no web counterpart):

| File | Purpose |
|------|---------|
| [`src/game/seatRegistry.js`](../../mobile/src/game/seatRegistry.js) | Device-local record of which seat(s) this device owns per game |
| [`src/game/useTurnClock.js`](../../mobile/src/game/useTurnClock.js) | `useTurnClock(deadline, offsetMs)` — 1 s countdown hook + `formatDuration`; torn down when the app backgrounds. Web keeps the equivalent interval inside `TurnClock.jsx` |
| [`src/api/config.js`](../../mobile/src/api/config.js) | Resolves the backend host from Metro (`MANUAL_OVERRIDE` to pin it) |
| `friendlyJoinError()` in [`src/api/errors.js`](../../mobile/src/api/errors.js) | Maps raw join failures to user-facing text. The **file** is no longer mobile-only — its timeout-race half is mirrored on web — but this function is |

`gating.js`'s `computeGating()` is also mobile-only; only its **closed-seat half** is
ported to web (see [Turn gating](#turn-gating)).

**Web-only:** `Nav` (inside `App.jsx`), a separate `RegisterPage`, the
`/reset-password/:uid/:token` confirm screen
([`ResetPasswordPage.jsx`](../../frontend/src/pages/ResetPasswordPage.jsx) — the
emailed link's target, which mobile has no counterpart for), and
[`src/api/config.js`](../../frontend/src/api/config.js) (`apiUrl` /
`normalizeBaseUrl`, mobile resolves its host from Metro instead).
`GamePage.handleRematch()` is defined but never wired to any element — dead code.

## The staged-turn flow

Identical shape in both clients. A turn is assembled locally against a **copy** of
the authoritative board, then committed in a single `confirm_turn` call which the
server re-validates from scratch.

State inside `useGame(gameId)` (both clients):

| Name | Meaning |
|------|---------|
| `game` | last authoritative payload from the server |
| `stagedBoard` | local board copy, starts as `cloneBoard(game.board_state)` |
| `stagedDice` | dice still unconsumed this turn |
| `pendingMoves` | flat `[{ from_point, to_point }]`, one entry per die used |
| `legalMoves` | `getLegalMoves(...)` ++ `getCombinedMoves(...)` on `stagedBoard` |
| `maxDiceUsable` | `maxMovesUsable(game.board_state, …)` — from the **pre-turn** board |
| `mustUseMoreDice` | `pendingMoves.length < maxDiceUsable` |
| `higherDieMoves` | `higherDieRequiredMoves(game.board_state, …)` — also pre-turn; `null` when the rule doesn't apply |
| `mustPlayHigherDie` | the first staged move isn't in `higherDieMoves` (only one die is usable when the rule is live, so the server likewise judges `moves[0]`) |
| `moveGroups` | **mobile only** — sub-move count per user action, so Undo can drop a combined move whole |

End to end:

1. **Roll.** Web: the `Roll Dice` button in `GameControls`. Mobile: tapping the dice
   themselves (`Dice` renders a "Tap to roll" state when `canRoll`). Both call
   `rollDice()` → `POST /roll_dice/` → `setGame(updated)`.
2. **`setGame` resets the stage.** A `useEffect` on `game` re-clones the board,
   copies `dice_values` into `stagedDice`, and clears `pendingMoves`
   (and `moveGroups` on mobile).
3. **Select.** `Board` keeps its own `selected` point in local state.
   `legalFromPoints` (set of `m[0]`) decides which points can be picked up;
   `destinations` (`m[1]` for the selected origin) highlights targets. Bar is
   point `0`, off is `25`.
4. **Commit the gesture.** Board calls `onMove(from, to)` = `stageMove(from, to)`.
   `stageMove` looks the pair up in `legalMoves`:
   - third element is a **number** → single move: splice that die out of
     `stagedDice`, `setStagedBoard(applyMove(...))`, push one pending move.
   - third element is an **array** (a combined move's `path`) → walk each
     `{ to, die }` step, applying `applyMove` and splicing each die, pushing one
     pending move **per hop**. The backend never sees a combined move; it re-checks
     each hop. See [ADR-001](../decisions/adr-001-combined-moves.md).
5. **Correct.** `resetTurn()` re-clones from `game` (both clients). Mobile also has
   `undoMove()`, which drops the last `moveGroups` entry and rebuilds the position
   with the local `replay()` helper.
6. **Confirm.** `confirmTurn()` → `POST /confirm_turn/ { moves: pendingMoves }` →
   `setGame(updated)`, which restarts the cycle at step 2. Failures land in
   `actionError` (rendered under the board) rather than replacing the page —
   `error` is reserved for the initial load.

`mustUseMoreDice` **or** `mustPlayHigherDie` disables Confirm in both clients
(`blockConfirm` in each `GameControls`), with an explanatory line rendered alongside:
"You must use as many dice as possible." and "Only one die can be played this turn —
it must be the higher one." Both are UX affordances only; `confirm_turn` enforces
maximal dice usage and the higher-die rule server-side and is authoritative.
Confirming with an empty `pendingMoves` is how a turn is passed — mobile relabels the
button **Pass Turn** when `turnActive && !hasPendingMoves && !hasLegalMoves`; web
leaves it as "Confirm Turn".

`abandonGame()` rides alongside too, in both hooks: `POST /abandon/` for a game
deadlocked by a closed seat, offered only where `canAbandon` says the viewer holds
the surviving seat (see [Turn gating](#turn-gating)). So does `claimTimeout()` —
`POST /claim_timeout/`, the inactivity forfeit, offered where `canClaimTimeout`
says the viewer is the *waiting* seat's opponent and the deadline has passed. The
two are not variants of each other: `abandon` scores nothing, `claim_timeout`
awards a real win (see
[the shared predicates](#canclaimtimeout--the-third-member-of-the-sync-obligation)).

Doubling rides alongside: `offerDouble()` / `respondToDouble(accept)` post to
`/offer_double/` and `/respond_to_double/`, and `canOfferDouble` is computed
identically in both hooks (active game, no dice rolled, no pending offer, not the
Crawford game, `cube_value < 64`, cube centred or owned by the mover).

## Routing

**Web** — `BrowserRouter` in [`App.jsx`](../../frontend/src/App.jsx), with a `Nav`
bar rendered above the `Routes`:

| Path | Element |
|------|---------|
| `/` | `LobbyPage` |
| `/login` | `LoginPage` |
| `/register` | `RegisterPage` |
| `/forgot-password` | `ForgotPasswordPage` |
| `/reset-password/:uid/:token` | `ResetPasswordPage` — **the exact shape of the emailed link** (`FRONTEND_BASE_URL` + this path, see [api.md](api.md#post-apiauthpassword-reset)) |
| `/game/:id` | `GamePage` (`useParams()`) |
| `/profile` | `ProfilePage` |

**Mobile** — file-based, one `Stack` declared in
[`app/_layout.jsx`](../../mobile/app/_layout.jsx):

| File | Route | Header title |
|------|-------|--------------|
| `app/index.jsx` | `/` | "Backgammon" |
| `app/login.jsx` | `/login` | "Sign in" |
| `app/profile.jsx` | `/profile` | "Profile" |
| `app/game/[id].jsx` | `/game/:id` (`useLocalSearchParams()`) | "Game" → overridden per screen to `Game #<id>` |

The game screen builds share links with `Linking.createURL('/game/<id>')` (scheme
`backgammon://`) and offers a numeric **game code** as a fallback; the web
equivalent is just `window.location.href`.

## State, context & the API layer

Both apps have exactly one context — `AuthContext` — wrapping the whole tree
(inside `AuthProvider` in `App.jsx` / `_layout.jsx`). Everything else is local
component state or `useGame`.

`user` is three-state in both: `undefined` = still loading, `null` = guest, object
= signed in. Both providers call `fetchMe()` once on mount. Web `logout()` is
synchronous (`clearTokens()` on `localStorage`); mobile `logout()` is `async`
(SecureStore deletes) and is awaited before `setUser(null)`.

Both `request()` wrappers inject `Authorization: Bearer <access>` and, on a **401**,
attempt exactly one silent refresh (`POST /api/auth/refresh/`) and retry the
original request; if refreshing fails, both tokens are cleared and the error
propagates. Differences: the web wrapper resolves its URL through `apiUrl()` in
[`api/config.js`](../../frontend/src/api/config.js) (root-relative unless
`REACT_APP_API_BASE_URL` was set at build time) and imports its refresh helper from
`authApi.js`; the mobile wrapper prefixes `API_BASE_URL` from Metro, holds its own
`refreshAccessToken()`, and additionally reads `data.detail` (DRF's field) when
building the error message. Full detail in
[auth.md](auth.md#client-token-lifecycle).

Mobile token reads are all `async` (SecureStore), which is why its `request()` is
`await`-heavy where the web version reads `localStorage` synchronously.

## Sync

**Both clients poll** `GET /api/games/{id}/` on a `setInterval` at `POLL_MS = 3500`,
and both swap in fresh state only if `updated_at` changed, so a steady stream of
identical responses causes no re-render. Both skip a tick when
`pendingMoves.length > 0` (a refresh must never clobber a staged turn), when the game
is not live, and when it is **deadlocked** on a closed seat (nobody is coming — see
[Turn gating](#turn-gating)). Where they differ:

- **Mobile** ([`useGame.js`](../../mobile/src/game/useGame.js)) additionally skips
  while the screen is unfocused (`useFocusEffect`) or the app is backgrounded
  (`AppState`). It also has a manual `refresh()` (`refreshing` flag) wired to
  `RefreshControl` pull-to-refresh on both the waiting and active game screens, and
  to the lobby via `useFocusEffect`.
- **Web** ([`useGame.js`](../../frontend/src/hooks/useGame.js)) polls only when
  `isOnlineGame(game, viewerUserId)` ([`seats.js`](../../frontend/src/utils/seats.js))
  says the other seat lives on another device — two distinct account FKs, a
  `waiting` game, or a seat owned by an account that isn't the viewer's. A hotseat
  board can only change here, so polling it would be pure churn. The predicate's
  blind spot is a logged-in player whose opponent joined as a *guest*: that payload
  is byte-identical to a hotseat game, and it falls to the conservative side (no
  polling). Web has no focus/visibility gate and no pull-to-refresh; it keeps an
  explicit `reload()` (bumps `reloadToken`, used after joining).

The poll interval is subscribed once for the life of the game — web keeps the mutable
inputs in refs (`pendingRef` / `statusRef` / `pollableRef`) so the effect never has to
re-subscribe.

**The poll is not the clock.** It refreshes `turn_deadline` when the opponent
finally acts; the countdown itself runs on its own 1 s interval and would keep
counting correctly even if every poll were dropped. See
[the countdown](#the-countdown-is-extrapolated-not-polled).

## Turn gating

**Mobile gates the UI; web does not.**

Mobile's [`computeGating({ game, userId, seatInfo })`](../../mobile/src/game/gating.js)
is a pure function resolved in priority order:

1. **Two distinct account FKs** on the seats → gated, seats derived from `userId`.
2. **`seatInfo`** from [`seatRegistry`](../../mobile/src/game/seatRegistry.js) — the
   device recorded its seat when it created or joined this game; authoritative for
   this device, and the only signal that distinguishes an online-vs-guest game from
   a hotseat one.
3. **`game.viewer_seat`** from the server — covers a fresh device deep-linking into
   a game where the account owns one seat.
4. Otherwise **ungated**: single-device hotseat, both seats interactive.

It returns `{ gated, mySeats, iOwnASeat, isMyTurn, canInteract, spectating,
waitingForOpponent }`. The game screen uses `canInteract` to make the board
interactive, to show `GameControls` at all, and to gate the Double button; the
Accept/Drop prompt is gated separately to the *responder* seat (the offerer's
opponent, which is not the current turn). Headers change accordingly: "Your turn",
"Waiting for X…", "Spectating · X's turn".

`seatRegistry` persists a compact map in SecureStore under `bg_seats`
(`"p1" | "p2" | "p1p2" | "local"`, capped at `MAX_ENTRIES = 40`), hydrated once at
app start by `_layout.jsx`. `recordOnlineSeat` is called on create-online (`p1`)
and on every join (`p2`); `recordLocalGame` on hotseat and match creation.
`useSeatInfo(gameId)` subscribes components to changes.

The web client renders every control for whoever is sitting at the browser. An
unauthorized click is simply sent, and the server's **403** from
`_seat_permission_error` surfaces as `actionError` text. That is the whole
protection — client gating on mobile is UX, not security.

### Closed seats and the inactivity clock: the predicates both clients share

A seat closed by account deletion is the exception, because a deadlock has to be
*explained* rather than left as a silent 403. Four functions —
`isSeatClosed`, `otherSeat`, `blockedSeat`, `isDeadlocked` — exist in **both**
[`mobile/src/game/gating.js`](../../mobile/src/game/gating.js) and
[`frontend/src/utils/seats.js`](../../frontend/src/utils/seats.js) and **must stay in
sync**; today they are character-for-character identical. The server's `abandon`
action derives the blocked seat the same way, so all three agree:

> `blockedSeat` is `current_turn`, **except** when `double_offered_by` is set, where
> the game is waiting on the offerer's *opponent*. `isDeadlocked` is
> `status === "active"` **and** that seat is closed.

Each client also has a `canAbandon` that mirrors the server's precondition — game
deadlocked, viewer holds the **surviving** seat, and both-seats-closed returns false.
They reach it differently, because the two clients know different things:

- **Mobile** returns it from `computeGating`: `mySeats.includes(survivingSeat)`,
  using the device-local registry it already maintains.
- **Web** has no registry, so `canAbandon(game)` in `seats.js` leans on
  `viewer_seat`: a *registered* survivor seat must match it, while a *guest*
  survivor seat is unverifiable server-side anyway and so is offered — matching the
  web client's ungated idiom, where an unauthorised click surfaces the 403.

Consumers: a banner ("your opponent deleted their account — this game can't
continue"), the abandon panel/section, and the poll gate on both sides.

#### `canClaimTimeout` — the third member of the sync obligation

The inactivity forfeit ([ADR-002](../decisions/adr-002-inactivity-forfeit.md),
[`claim_timeout`](api.md#post-apigamesidclaim_timeout)) adds
**`canClaimTimeout(game, viewerSeat, now)`** to the same must-stay-in-sync set,
with the same name, signature and semantics in `seats.js` and `gating.js`. Both
copies carry a header comment saying so. Change one, change the other — and check
the server, which is the third copy of the underlying rule.

> **The set has since grown to four.** `serverClockOffset(game, deviceNow)`
> joined it with the `server_now` work and shares `canClaimTimeout`'s private
> `toMillis` helper, so the two are ported together —
> [below](#server_now--the-offset-not-the-device-clock). The heading above is
> left as written because other docs anchor to it.

**It does not re-derive eligibility, and must not start.** The server publishes
the whole question in two fields: `turn_waiting_seat` (the seat on the clock) and
`turn_deadline`, which is **null whenever a claim is impossible in principle** —
game not active, a closed seat, either seat a guest, or no clock recorded. A null
deadline is a complete answer: render nothing. A client that instead inspected
`status` / user FKs / the closure flags would be a fourth copy of the rule, in two
languages, that drifts the moment the rule is tuned.

What the predicate adds is only what the server cannot know: **what time it is
now** — the device clock corrected by the `server_now` offset, see
[below](#server_now--the-offset-not-the-device-clock) — and **which seat is
looking**. It is true only when the deadline
has passed *and* the viewer holds the **opposite** seat — you claim against the
idle player, never yourself, so a player who is themselves out of time gets
`false`, not a button that forfeits their own game.

The viewer's seat is the one legitimate divergence, so it is a **parameter**
rather than something the predicate derives:

- **Mobile** passes `viewerSeat` from `computeGating`, which returns it as
  `mySeats.length === 1 ? mySeats[0] : null` — null for a spectator *and* for
  hotseat, where the device holds both seats and there is no opponent to claim
  against.
- **Web** passes the server's `game.viewer_seat`.

Mobile also has `msUntilTurnDeadline(game, now)` in `gating.js` (floored at 0);
the web countdown computes the same quantity inline in `TurnClock.jsx`. That one
is a helper, not part of the sync obligation.

#### The countdown is extrapolated, not polled

Both clients tick a **1 s local interval** against `turn_deadline` and render the
remaining time, using a clock corrected by the payload's `server_now`
([below](#server_now--the-offset-not-the-device-clock)). **Polling only
reconciles**: the ~3.5 s `useGame` poll refreshes the *deadline* and the
*offset*, it is not the tick source — driving a countdown off it would stutter
and lag by up to 3.5 s. When the idle player finally moves, the fresh payload
carries a new deadline (or none) and the clock re-derives from that, which is
also how the claim control retracts within a tick.

Both clocks show the countdown **in both directions**: the seat on the clock sees
its own time draining, with the consequence spelled out; the opponent sees how
long until a claim becomes possible. Nobody should lose to a clock they were never
shown.

- **Web** — [`TurnClock.jsx`](../../frontend/src/components/TurnClock.jsx) owns
  the interval and the `formatRemaining` helper, and swaps in
  [`ClaimTimeoutPanel.jsx`](../../frontend/src/components/ClaimTimeoutPanel.jsx)
  once `canClaimTimeout` is true. It escalates its styling under five minutes.
- **Mobile** — [`useTurnClock(deadline)`](../../mobile/src/game/useTurnClock.js)
  returns `{ now, msRemaining, expired }` and is consumed by
  [`TurnClockSection.jsx`](../../mobile/src/components/TurnClockSection.jsx). It
  stops on unmount **and** whenever the app backgrounds (`AppState`), matching
  the poller, and resyncs from the wall clock on resume rather than assuming the
  missed ticks accrued. It also stops once the deadline passes, since the value
  is pinned at 0 from then on.

The same `now` the countdown rendered is the `now` handed to `canClaimTimeout`,
so the button and the clock can never disagree about the time. Which raises the
question of *whose* time it is.

##### `server_now` — the offset, not the device clock

Both clients used to tick against `Date.now()` straight from the device. That
made every countdown and every claim check only as accurate as the user's system
clock, and produced two distinct bugs:

- **A clock running fast** offered the claim button before the server's deadline
  had passed. The claim then 400ed — *permanently*, not transiently, because the
  button's condition and the server's differed by a constant the client had no
  way to observe. The user saw a button that never worked.
- **A clock running slow** told the seat on the clock it still had time after the
  opponent's claim had already opened.

The fix is a single extra field. Every game payload carries
[`server_now`](api.md#server_now--the-clients-clock-is-not-trusted) — the instant
the response was serialized, always present and never null, in the same ISO
format as `turn_deadline`. **`serverClockOffset(game, deviceNow = Date.now())`**
turns it into a correction, and is the **fourth** member of the `seats.js` /
`gating.js` stay-in-sync set (with `isSeatClosed`/`blockedSeat`/`isDeadlocked`,
`canAbandon`, and `canClaimTimeout`); both copies share the `toMillis` helper:

```
offset = server_now − deviceNow      // add it to Date.now() to get server time
```

`useGame` holds the result as **`clockOffset`** and every countdown and claim
check runs against `Date.now() + clockOffset`, never the raw device clock. Five
properties are worth stating plainly:

- **The offset is a correction, not a clock.** Ticking still happens locally at
  1 s; `server_now` is not a time *source* and polling it at 3.5 s could never
  drive a countdown. It is a constant added to a locally-ticking value.
- **It is re-anchored on every payload — including action responses.** `useGame`
  routes the initial load, each poll tick, and every action's 200 through one
  `adoptGame`/`syncClock` pair, so a device whose clock is adjusted mid-game
  self-corrects. It is **not** adopted on every jitter: `OFFSET_EPSILON_MS`
  (**1000 ms**, defined identically in both hooks) requires the new offset to
  differ by at least a second, or latency noise would re-render the tree every
  3.5 s and destroy the "identical payload changes nothing" guarantee.
- **Latency is folded in and biases the offset the safe way.** The payload was
  serialized slightly *before* it arrived, so the derived offset sits a few
  hundred ms behind the server. That makes a claim open a moment late rather
  than a moment early — the side the server would refuse anyway. No handshake,
  no round-trip estimate, no drift model: the error is milliseconds against a
  deadline measured in hours.
- **Every fallback lands on the old behaviour, never on a broken clock.** A
  missing, null or unparseable `server_now` yields offset `0`; so does a
  non-finite `clockOffset` reaching a component. The clock then ticks on the
  device clock exactly as it used to — degraded, never blank and never throwing.
- **A gross disagreement is shown to the player.** Both clocks render a skew
  notice past `SKEW_NOTICE_MS` (**5 minutes**, the same constant in
  `TurnClock.jsx` and `TurnClockSection.jsx`) saying how far this device is
  ahead of or behind the server and that the displayed time follows the server.
  Nothing is *wrong* at that point — the countdown is already corrected — but
  numbers that disagree with the user's own clock read as a bug unless named.

Plumbing, one prop deep in both clients: `useGame` exposes `clockOffset`, the
game screen passes it to `TurnClock` (web) / `TurnClockSection` (mobile), and
mobile's hook signature widened to `useTurnClock(deadline, offsetMs = 0)` —
which resyncs on an offset change exactly as it does on a deadline change, and
keeps the live value in a ref so the 1 s interval never has to re-subscribe.

`canClaimTimeout`'s **signature did not change**: it always took `now` as a
parameter, specifically so the caller decides what "now" means. Only what the
callers pass changed. The predicate remains an affordance either way — the
server re-checks the deadline against its own clock, and a claim that slips
through still 400s.

##### When a claim beats your move

`claim_timeout` locks the row, so a gameplay action sent in the same instant
loses the race and comes back **400** on a game that is already `finished` with
`win_type="timeout"`. The server names that case specifically instead of
returning the generic `"Game is not active."`
([api.md](api.md#the-claim-vs-move-race)), and both clients turn it into a calm
explanation rather than a red error. The machinery is a mirrored pair of files
plus one component each:

| Piece | Web | Mobile |
|---|---|---|
| Predicate + copy | [`src/api/errors.js`](../../frontend/src/api/errors.js) | [`src/api/errors.js`](../../mobile/src/api/errors.js) |
| The notice | [`TimeoutClaimedNotice.jsx`](../../frontend/src/components/TimeoutClaimedNotice.jsx) | [`TimeoutClaimedNotice.jsx`](../../mobile/src/components/TimeoutClaimedNotice.jsx) |

`isTimeoutClaimedError(err)` and `TIMEOUT_CLAIMED_MESSAGE` are **character-for-
character identical in the two `errors.js` files** and must stay that way — the
two clients have to tell a player the same story about the same 400. Four
decisions in there are worth knowing:

- **It matches on message text**, because that is all the API offers: every
  refusal arrives as `{"error": "..."}` and `request()` throws it as an `Error`.
  The predicate is deliberately *loose* about the exact server wording (it looks
  for a claim/forfeit word alongside a time/clock/deadline word) so a reworded
  message does not silently fall back to the raw 400.
- **It is applied to the gameplay actions only.** `useGame` routes roll, confirm
  and the two cube actions through a shared `handleActionError`; `claimTimeout`
  deliberately **does not** go through it, because its own refusals also talk
  about claims and clocks and mean something entirely different.
- **The copy lives in `errors.js`, not in the component**, so the two clients
  cannot drift on wording. It is not the server's sentence — it is a friendlier
  one: *"Your opponent claimed the win on time just before your move reached the
  server — the two crossed in transit, so this game is already over."*
- **The flag is sticky and suppresses `actionError`.** `useGame` exposes
  `timeoutClaimed`, set once and held for the life of the game view, and both
  screens render `TimeoutClaimedNotice` beside the turn clock (not down with the
  errors) while hiding `actionError` entirely — every subsequent action on a
  finished game would otherwise stack `"Game is not active."` under the
  explanation. `useGame` also re-fetches immediately rather than waiting for the
  poll, so the screen never shows a live board under a message saying the game
  is over.

Both hooks expose `claimTimeout()` → `POST /claim_timeout/` (`claimTimeout` in
[`gameApi.js`](../../frontend/src/api/gameApi.js) /
[`games.js`](../../mobile/src/api/games.js)), routed through the game hook so the
200 replaces local state without a refetch. Both `GameOverScreen`s render the
`"timeout"` win type with wording that reads correctly from either chair.

## Rendering

Both boards use the **same geometry constants and layout tables**, so they look
identical: `PW 58`, `BH 500`, `TH 198`, `BAR_W 40`, checker radius `CR 17`,
`MAX_VIS 5` stacked checkers with a count badge above that, and the same
`POINT_DEFS` mapping (top-left 13–18, top-right 19–24, bottom-left 12–7,
bottom-right 6–1). Selection/destination logic (`selected`, `legalFromPoints`,
`destinations`, `handlePointClick` / `handlePointPress`) is a line-for-line match.

Where they differ:

| | Web | Mobile |
|---|---|---|
| SVG | DOM `<svg>`, `viewBox` + `width:100%`; page wraps it in `overflow-x:auto` | `react-native-svg` `<Svg>` sized from `onLayout` width, `scale = width / VIEW_W` |
| Colors | CSS custom properties applied via `style` (SVG presentation attributes don't resolve `var()`) | plain hex from `colors` in `theme.js` |
| Input | `onClick` on each `<g>` | absolutely-positioned transparent `Pressable` zones computed in scaled px |
| Test hooks | `data-testid` (`point-N`, `bar`, `off-p1`, `p1-checker`) + `data-legal-destination` | none on the board |
| Interactivity | implicit (`onMove && currentPlayer`) | plus an explicit `interactive` prop from gating |
| Dice | `<Dice diceValues={stagedDice} />` — shows only the **remaining** dice (`usedCount` exists but `GamePage` never passes it) | `<Dice rolled={game.dice_values} remaining={stagedDice} canRoll onRoll />` — shows every rolled die, consumed ones greyed via multiset difference; doubles as the roll button |
| Game over | fixed full-screen overlay `<div>` | native component above the `ScrollView` |

## Game-logic duplication (three copies)

The canonical engine is
[`backend/game/game_logic.py`](../../backend/game/game_logic.py); it is ported to JS
twice. **All three must stay in sync** — change one, mirror the others.

Shared surface, present and behaviourally identical in all three:
`opponent`, `can_bear_off`/`canBearOff`, `get_legal_moves`/`getLegalMoves`,
`apply_move`/`applyMove`, `max_moves_usable`/`maxMovesUsable`,
`higher_die_required_moves`/`higherDieRequiredMoves`,
`check_winner`/`checkWinner`, plus the private helpers (`_checker_sign`,
`_entry_point`, `_bear_off_distance`, `_is_point_open`) and the `DIRECTION` /
`HOME_INDICES` tables.

Structural (not behavioural) differences by language:

- Python `get_legal_moves` returns a **set** of tuples; the JS ports return an
  **array** of arrays, built in point order. Ordering is not relied on.
- Python `apply_move` **mutates** and returns `board_state` (callers deep-copy);
  both JS `applyMove`s are **non-mutating** and return a fresh object.

### Known drift

The two JS files are **byte-identical apart from a comment reflow** — same exports,
same order, same behaviour. Real gaps are all Python-vs-JS:

| Symbol | Python | Web JS | Mobile JS | Notes |
|--------|:---:|:---:|:---:|:---:|
| `getCombinedMoves` | ✗ | ✓ | ✓ | **Deliberate.** Combined moves are client-only; the server re-validates hop by hop ([ADR-001](../decisions/adr-001-combined-moves.md)). |
| `isBlotHit` | ✗ | ✓ | ✓ | A pure UI affordance (amber "this hits" highlight), so it has no server counterpart. It used to be a private copy inlined in the web `Board.jsx`; it now lives in `gameLogic.js` with the same signature as mobile's, and `Board.jsx` imports it. Tested in both suites. |
| `roll_dice`, `get_initial_board_state` | ✓ | ✗ | ✗ | Server-authoritative; clients never generate dice or a starting board. |
| `detect_win_type`, `win_points`, `WIN_POINTS` | ✓ | ✗ | ✗ | Scoring is server-side; clients render `game.win_type` / `points_value` from the payload. |

No rule is implemented *differently* between the three — the drift is entirely
"present in one, absent in another", and every absence is now intentional
(server-authoritative logic that clients don't need, or client-only UI affordances).

## Tests

**Web — 312 tests across 16 files** (16 suites, green 2026-08-02):

| Suite | Location | Covers |
|-------|----------|--------|
| Logic | `src/utils/__tests__/gameLogic.test.js` (57) | `opponent`, `getLegalMoves`, `getCombinedMoves`, `applyMove`, `canBearOff`, `maxMovesUsable`, `higherDieRequiredMoves`, `checkWinner`, `isBlotHit` |
| Seats | `src/utils/__tests__/seats.test.js` | `isSeatClosed`, `blockedSeat`, `isDeadlocked`, `survivingSeat`, `canAbandon`, `canClaimTimeout`, `isOnlineGame` |
| Hook | `src/hooks/__tests__/useGame.test.js` (26) | staging, combined-move expansion, reset, confirm payload, `mustUseMoreDice`, and the polling effect |
| API | `src/api/__tests__/gameApi.test.js` (24) | every endpoint wrapper — URL, method, body and error path |
| API | `src/api/__tests__/{apiClient,authApi,config}.test.js` (7 + 36 + 19) | bearer injection, 401→refresh→retry, token storage, `updateEmail`, both password-reset calls, `deleteAccount`, and `normalizeBaseUrl`/`apiUrl` |
| UI | `src/components/__tests__/Board.test.jsx` (31) | 24 points, checker placement, bar/off, click-to-move, destination highlighting |
| UI | `src/components/__tests__/{Dice,DoublingCube,GameControls}.test.jsx` (5 + 7 + 26) | die faces, cube/Crawford states, roll/reset/confirm enablement, the maximal-dice **and** higher-die affordances |
| Pages | `src/pages/__tests__/{LoginPage,ProfilePage,GamePage}.test.jsx` (7 + 11 + 18) | login/register submit and errors; profile stats + email settings; the turn banner and the abandon control |
| Pages | `src/pages/__tests__/{ForgotPasswordPage,ResetPasswordPage}.test.jsx` (5 + 6) | the reset request and confirm screens |
| UI | `src/components/__tests__/{TurnClock,GameOverScreen}.test.jsx` | countdown formatting, both clock directions, claim-panel visibility, the `timeout` win-type wording |

**Mobile — 190 tests across 15 files** (15 suites, green 2026-08-02):

| Suite | Location | Covers |
|-------|----------|--------|
| Logic | `src/game/__tests__/logic.test.js` (43) | the same nine groups as web |
| Hook | `src/game/__tests__/useGame.test.js` (18) | staging, undo/reset, confirm, abandon |
| Gating | `src/game/__tests__/gating.test.js` | the four `computeGating` branches, closed seats, `canAbandon`, `canClaimTimeout`, `msUntilTurnDeadline` |
| Seats | `src/game/__tests__/seatRegistry.test.js` (5) | record/read/hydrate, local-vs-online |
| API | `src/api/__tests__/{client,auth,tokenStore,config}.test.js` (8 + 22 + 5 + 21) | 401 retry, register/login/fetchMe/`requestPasswordReset`, SecureStore, Metro host resolution |
| UI | `src/components/__tests__/{DoublingCube,GameOverScreen,MatchScore}.test.jsx` (5 + 4 + 2) | cube prompts and gating props, win-type text (incl. abandoned), score banner |
| UI | `src/components/__tests__/{AbandonGameSection,DeleteAccountSection,EmailSection}.test.jsx` (11 + 6 + 5) | abandon visibility + confirmation, account deletion, email set/clear |
| UI | `src/components/__tests__/TurnClockSection.test.jsx` | countdown in both directions, claim visibility, `formatDuration` |

Both suites mock `fetch`; mobile uses the in-memory SecureStore mock in
[`jest.setup.js`](../../mobile/jest.setup.js) and the `jest-expo` preset. Run
commands are in [CLAUDE.md](../../CLAUDE.md#tests).

Untested on the web side: `LobbyPage`, `RegisterPage`, `MatchScore`,
`AbandonGamePanel`/`ClaimTimeoutPanel`/`DeleteAccountPanel`/`EmailSettings`
(exercised indirectly through `TurnClock`/`GamePage`/`ProfilePage`), and
`matchApi`. Untested on mobile:
every screen under `app/`, `Board`, `Dice`, `GameControls`, `games.js`, `matches.js`,
`errors.js`.

## Planned / Not Yet Implemented

- **Web focus/visibility gating of the poller.** Web polls unconditionally once
  `isOnlineGame` is true — there is no `visibilitychange` or blur check, so a
  backgrounded tab keeps ticking. Mobile has both. The same asymmetry applies to
  the turn clock: mobile's `useTurnClock` stops on `AppState` change, while
  `TurnClock.jsx` keeps its 1 s interval running in a hidden tab.
- **Live (reserve-time) clocks.** The countdown renders a single per-turn
  deadline. There is no reserve time, no Fischer/Bronstein increment, no
  accumulated-time display, and no clock-mode picker at game creation — deferred
  until presence exists ([ADR-002](../decisions/adr-002-inactivity-forfeit.md)).
- **An in-client timeout notification.** Nothing *in either client* tells a
  player their clock is running out unless the game screen is open: no push
  notification, no local notification, no badge. Neither app depends on
  `expo-notifications` or registers a device token, and closing that needs EAS
  push credentials before it needs code. The server side has a **reminder email**
  (`manage.py send_turn_reminders`, [ADR-002](../decisions/adr-002-inactivity-forfeit.md))
  which is dormant until a cron is scheduled and reaches only players who set an
  address — it changes nothing in these two codebases.
- **A mobile reset-confirm screen.** Mobile can request a reset link, but the emailed
  link is a web URL; there is no `backgammon://` deep-link route for
  `/reset-password/:uid/:token`.
- **Web turn gating.** The web UI renders controls for both seats regardless of
  who is logged in; there is no web counterpart to `computeGating` /
  `seatRegistry.js` (only the closed-seat predicates are shared). Unauthorized
  actions are caught only by the server's 403.
- **WebSockets.** Neither client has one; sync is HTTP polling on both.
- **Shared JS engine package.** The two ports are duplicated files, not a shared
  module — there is no workspace/package linking `frontend` and `mobile`.
- **Drag-and-drop checkers.** Both boards are tap/click-to-select then
  tap/click-to-place; there is no drag gesture in either client.
- **Web rematch.** `GamePage.handleRematch()` exists but is not rendered by any
  button.
- **TypeScript.** Both clients are plain JavaScript/JSX (`typedRoutes` in
  `app.json` is an Expo Router flag, not a TS setup).
