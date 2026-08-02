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

  return {
    gated,
    mySeats,
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
