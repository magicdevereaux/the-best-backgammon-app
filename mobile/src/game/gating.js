// Pure turn-ownership derivation, extracted from the game screen so it can be
// unit-tested without rendering the whole board.
//
// Inputs:
//   game     — the game payload (needs status, current_turn, player1_user,
//              player2_user; optionally player1_deleted/player2_deleted)
//   userId   — the logged-in user's id, or null/undefined for a guest
//   seatInfo — device-local seat record { online, seats } or null (see
//              seatRegistry); catches online-vs-guest games the FKs can't.
//
// A game is "gated" (online) when it's between two distinct accounts, when the
// device-local seat registry says this device is in an online game, or when the
// server reports the requesting account owns a single seat (`viewer_seat`).
// Otherwise it's a single-device hotseat/guest game and both seats stay
// interactive here.
//
// Priority:
//   1. twoAccounts — both seats are distinct accounts (FK-derived, definitive).
//   2. seatInfo    — this device created/joined the game and recorded its seat,
//                    so it knows hotseat-vs-online even when the opponent is a
//                    guest. Authoritative for this device.
//   3. viewer_seat — server-side ownership signal. Closes the deep-link edge
//                    case: a fresh device with no local record still gates to
//                    the account's own seat when the server says it owns one.
//   4. default     — unknown, single-device: both seats interactive.
//
// Stay-in-sync obligation: `isSeatClosed` / `blockedSeat` / `isDeadlocked` /
// `canClaimTimeout` / `serverClockOffset`, plus the `toMillis` helper the last
// two are built on, are mirrored verbatim in frontend/src/utils/seats.js and
// **must stay identical to it**. `computeGating` itself is deliberately NOT ported — the web client is
// ungated and lets the server's 403 speak for itself.

// True when the seat is marked closed by account deletion. The flags are
// read-only server fields; a missing/absent flag means the seat is OPEN, so
// older payloads and fixtures without the fields behave exactly as before.
export function isSeatClosed(game, seat) {
  if (!game) return false;
  return seat === "p1"
    ? game.player1_deleted === true
    : seat === "p2"
      ? game.player2_deleted === true
      : false;
}

export function otherSeat(seat) {
  return seat === "p1" ? "p2" : seat === "p2" ? "p1" : null;
}

// The seat that owes the next action. Normally that is current_turn. A pending
// double is the exception: it blocks all play until the *responder* (the
// offerer's opponent) answers, so that seat is the one that has to act. Mirrors
// the server's own choice of seat in `respond_to_double` and in `abandon`.
export function blockedSeat(game) {
  if (!game) return null;
  return game.double_offered_by
    ? otherSeat(game.double_offered_by)
    : game.current_turn ?? null;
}

// A game is deadlocked when the seat that has to act next has been closed: the
// server 403s that seat for *everyone* (including the surviving opponent, who
// would otherwise get to play both sides), so nobody can move it along and no
// opponent is ever coming. Distinct from waitingForOpponent — that one resolves
// on its own, this one never does. Callers use it to stop polling and to say so.
export function isDeadlocked(game) {
  if (!game || game.status !== "active") return false;
  return isSeatClosed(game, blockedSeat(game));
}

// Milliseconds since the epoch for a Date / number / ISO string, or null when
// the value isn't a usable instant. Shared by the clock predicates below, and
// ported verbatim into frontend/src/utils/seats.js. Anything null, unparseable,
// or non-finite comes back null, which callers read as "no clock" — never as
// "expired", so a garbled field can't hand somebody a win.
function toMillis(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// How far this device's clock is behind the server's, in milliseconds: add it to
// `Date.now()` to get the time the *server* thinks it is.
//
// Every game payload carries `server_now` — the instant the response was
// serialised, always present, never null. The device clock is not trustworthy:
// a phone running hours fast would show the claim control early and then eat a
// 400 forever, and one running slow would promise a player time they do not
// have. So no countdown and no `canClaimTimeout` comparison is made against
// `Date.now()` directly; they all go through `Date.now() + offset`.
//
// Network latency is folded into this (the payload was serialised slightly
// before it arrived), which biases the offset a few hundred ms *behind* the
// server. That is the harmless direction: the claim opens a moment late rather
// than a moment early, which is exactly the side the server would refuse.
//
// A missing, null, or unparseable `server_now` — an older cached payload, a
// fixture — yields **0**: fall back to the device clock rather than break the
// countdown. Ported verbatim into frontend/src/utils/seats.js.
export function serverClockOffset(game, deviceNow = Date.now()) {
  if (!game) return 0;
  const server = toMillis(game.server_now);
  if (server == null) return 0;
  const device = toMillis(deviceNow);
  if (device == null) return 0;
  return server - device;
}

// Whether `viewerSeat` may claim an inactivity forfeit right now.
//
// Mirrors POST /api/games/{id}/claim_timeout/ as an affordance only — the
// server re-checks everything and is authoritative.
//
// The eligibility rule itself is NOT re-derived here. The server publishes
// `turn_deadline` as null whenever a claim is impossible in principle (game not
// active, a closed/deleted seat, either seat a guest, no clock recorded), so a
// null deadline is a complete answer: show nothing. All this adds is the two
// things the server cannot know — what time it is on this device, and which
// seat is looking.
//
//   game       — payload carrying `turn_waiting_seat` and `turn_deadline`
//   viewerSeat — "p1" / "p2" / null: the seat this device is acting as
//   now        — Date, epoch ms, or ISO string; defaults to the wall clock
//
// True only when the deadline has passed AND the viewer is the OPPONENT of the
// seat on the clock. You claim against the idle player, never against yourself:
// a player who is themselves out of time gets false, not a button that forfeits
// their own game.
//
// Kept in sync with frontend/src/utils/seats.js — same name, same signature,
// same semantics. (How each client works out the *viewer's* seat differs by
// design: mobile from its device-local seat registry, web from the server's
// `viewer_seat`.)
export function canClaimTimeout(game, viewerSeat, now = Date.now()) {
  if (!game) return false;
  const waiting = game.turn_waiting_seat;
  if (waiting !== "p1" && waiting !== "p2") return false;
  if (viewerSeat !== otherSeat(waiting)) return false;
  const deadline = toMillis(game.turn_deadline);
  if (deadline == null) return false;
  const current = toMillis(now);
  if (current == null) return false;
  return current >= deadline;
}

// How long `viewerSeat` has left before the clock runs out, in milliseconds, or
// null when no clock applies to them. Non-negative — it floors at 0 rather than
// counting up past the deadline. Used for the countdown in both directions: the
// seat on the clock sees its own time draining, the opponent sees how long
// until a claim becomes possible.
export function msUntilTurnDeadline(game, now = Date.now()) {
  if (!game) return null;
  const deadline = toMillis(game.turn_deadline);
  if (deadline == null) return null;
  const current = toMillis(now);
  if (current == null) return null;
  return Math.max(0, deadline - current);
}

export function computeGating({ game, userId, seatInfo }) {
  const iAmP1 =
    userId != null && game.player1_user != null && game.player1_user === userId;
  const iAmP2 =
    userId != null && game.player2_user != null && game.player2_user === userId;
  const twoAccounts =
    game.player1_user != null &&
    game.player2_user != null &&
    game.player1_user !== game.player2_user;

  let gated;
  let mySeats;
  if (twoAccounts) {
    gated = true;
    mySeats = [];
    if (iAmP1) mySeats.push("p1");
    if (iAmP2) mySeats.push("p2");
  } else if (seatInfo) {
    gated = seatInfo.online;
    mySeats = seatInfo.seats;
  } else if (game.viewer_seat === "p1" || game.viewer_seat === "p2") {
    // Server says this account owns exactly one seat but the other player is a
    // guest (no FK) and we have no local record — treat as an online game and
    // gate to the owned seat so we can't play the opponent's turn.
    gated = true;
    mySeats = [game.viewer_seat];
  } else {
    gated = false;
    mySeats = ["p1", "p2"];
  }

  const active = game.status === "active";
  const iOwnASeat = mySeats.length > 0;
  const isMyTurn = !gated || mySeats.includes(game.current_turn);
  // A closed seat outranks every other state: the turn can't move, so nothing is
  // interactive and nobody is "waiting" in the sense that ends.
  const deadlocked = isDeadlocked(game);
  const canInteract = active && isMyTurn && !deadlocked;
  const spectating = gated && !iOwnASeat && active && !deadlocked;
  const waitingForOpponent = gated && iOwnASeat && !isMyTurn && active && !deadlocked;

  // Who is stuck and who is left. `blocked` is the seat that can't act (closed,
  // when deadlocked); `survivingSeat` is its opponent — the only seat the
  // server's `abandon` action will accept a caller for.
  const blocked = blockedSeat(game);
  const surviving = otherSeat(blocked);

  // Mirror of POST /api/games/{id}/abandon/'s preconditions, so the button only
  // appears where the server would say yes: the game is genuinely deadlocked and
  // this viewer holds the *surviving* seat. A spectator (no seats), the closed
  // seat's own viewpoint (mySeats has only the blocked seat), and the both-seats-
  // closed case (no survivor to act for) all come back false. The server
  // re-checks all of it; this is affordance, not authorization.
  const canAbandon =
    deadlocked &&
    surviving != null &&
    mySeats.includes(surviving) &&
    !isSeatClosed(game, surviving);

  // The single seat this device acts as, for predicates that need one seat
  // rather than a set (canClaimTimeout). Null for a spectator and null for
  // hotseat, where the device holds both seats and there is no "opponent" to
  // claim against — the server never issues a deadline for either case, so this
  // only ever hardens what the payload already decided.
  const viewerSeat = mySeats.length === 1 ? mySeats[0] : null;

  return {
    gated,
    mySeats,
    viewerSeat,
    iOwnASeat,
    isMyTurn,
    canInteract,
    spectating,
    waitingForOpponent,
    deadlocked,
    blockedSeat: blocked,
    survivingSeat: surviving,
    canAbandon,
  };
}
