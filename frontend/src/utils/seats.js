// Seat-state derivation from a game payload.
//
// `isSeatClosed` / `blockedSeat` / `isDeadlocked` are a port of the closed-seat
// half of mobile/src/game/gating.js and **must stay identical to it** — the two
// clients have to agree on when a game can no longer move. Mobile's gating
// layer proper (which seats this device may touch) is deliberately *not* ported:
// the web client is ungated and lets the server's 403 speak for itself.

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

// The seat that owes the next action. Normally that's current_turn. A pending
// double is the exception: it blocks all play until the *responder* (the
// offerer's opponent) answers, so that seat is the one that has to be open.
export function blockedSeat(game) {
  if (!game) return null;
  if (game.double_offered_by) {
    return game.double_offered_by === "p1" ? "p2" : "p1";
  }
  return game.current_turn;
}

// A game is deadlocked when the seat that has to act next has been closed: the
// server 403s that seat for *everyone* (including the surviving opponent, who
// would otherwise get to play both sides), so nobody can move it along and no
// opponent is ever coming. Callers use it to stop polling and to say so.
export function isDeadlocked(game) {
  if (!game || game.status !== "active") return false;
  return isSeatClosed(game, blockedSeat(game));
}

// True when the game's other seat lives on some other device, which is the only
// case where polling can ever return something new. Unlike mobile, the web
// client keeps no device-local seat registry, so this is derived purely from the
// payload plus the viewer's user id:
//
//   - two distinct accounts        -> definitively two devices;
//   - status "waiting"             -> a seat is still empty and only another
//                                     client can fill it (hotseat games are
//                                     created with both names and start active);
//   - a seat owned by an account   -> whoever owns it isn't sitting here (a
//     that isn't the viewer's         hotseat game's seats are the viewer's own
//                                     or nobody's).
//
// The one case this cannot see is a logged-in player whose opponent joined as a
// guest: that payload is byte-identical to a hotseat game they created. It falls
// to the local side, i.e. no polling — the conservative half of the trade, since
// polling a hotseat game would churn the network for a board only this device
// can change.
export function isOnlineGame(game, viewerUserId) {
  if (!game) return false;
  const p1 = game.player1_user ?? null;
  const p2 = game.player2_user ?? null;
  if (p1 != null && p2 != null && p1 !== p2) return true;
  if (game.status === "waiting") return true;
  const mine = viewerUserId ?? null;
  return (p1 != null && p1 !== mine) || (p2 != null && p2 !== mine);
}
