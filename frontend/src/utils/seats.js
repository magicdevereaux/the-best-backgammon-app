// Seat-state derivation from a game payload.
//
// `isSeatClosed` / `blockedSeat` / `isDeadlocked` / `canClaimTimeout` — and the
// `toMillis` helper the last of those is built on — are a port of
// mobile/src/game/gating.js and **must stay identical to it** — the two
// clients have to agree on when a game can no longer move and on when an
// inactivity forfeit is claimable. Mobile's gating layer proper (which seats
// this device may touch) is deliberately *not* ported: the web client is ungated
// and lets the server's 403 speak for itself. The one legitimate divergence is
// how each client answers "which seat is the viewer?" — web reads the server's
// `viewer_seat`, mobile a device-local registry — so that answer is a *parameter*
// of `canClaimTimeout` rather than something it derives.

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

// The seat that owes the next action. Normally that's current_turn. A pending
// double is the exception: it blocks all play until the *responder* (the
// offerer's opponent) answers, so that seat is the one that has to be open.
export function blockedSeat(game) {
  if (!game) return null;
  return game.double_offered_by
    ? otherSeat(game.double_offered_by)
    : game.current_turn ?? null;
}

// A game is deadlocked when the seat that has to act next has been closed: the
// server 403s that seat for *everyone* (including the surviving opponent, who
// would otherwise get to play both sides), so nobody can move it along and no
// opponent is ever coming. Callers use it to stop polling and to say so.
export function isDeadlocked(game) {
  if (!game || game.status !== "active") return false;
  return isSeatClosed(game, blockedSeat(game));
}

// The seat that survives a deadlock — the one `POST /api/games/{id}/abandon/`
// acts for. Null when the game isn't deadlocked at all, or when *both* seats are
// closed: there is then no survivor to act for and the server refuses everyone.
export function survivingSeat(game) {
  if (!isDeadlocked(game)) return null;
  const survivor = otherSeat(blockedSeat(game));
  return isSeatClosed(game, survivor) ? null : survivor;
}

// Whether to offer this viewer the abandon control. Mirrors the server's seat
// check applied to the *surviving* seat (see docs/architecture/api.md):
//
//   - a registered survivor seat is only playable by its owner, and `viewer_seat`
//     is the server's own answer to "is that you?" — so require the match. The
//     closed seat always has a null FK, so a bystander's `viewer_seat` is null
//     and the button stays hidden from them.
//   - a *guest* survivor seat is unverifiable server-side and anonymous-playable
//     by design, so nothing here can decide it. The button is offered, matching
//     the web client's ungated idiom elsewhere: an unauthorised click surfaces
//     the server's 403.
export function canAbandon(game) {
  const seat = survivingSeat(game);
  if (!seat) return false;
  const ownerId = seat === "p1" ? game.player1_user : game.player2_user;
  if (ownerId != null) return game.viewer_seat === seat;
  return true;
}

// Milliseconds since the epoch for a Date / number / ISO string, or null when
// the value isn't a usable instant. A verbatim port of `toMillis` in
// mobile/src/game/gating.js — the two clients must agree byte for byte on which
// clock values are usable. Anything null, unparseable, or non-finite comes back
// null, which callers read as "no clock", never as "expired".
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

// Whether this viewer may claim an inactivity forfeit right now.
//
// The server hands down the whole eligibility question in two read-only fields
// (see docs/decisions/adr-002-inactivity-forfeit.md):
//
//   - `turn_waiting_seat` — the seat on the clock;
//   - `turn_deadline` — an ISO timestamp, or **null whenever a claim is
//     impossible in principle**: game not active, a closed/deleted seat, either
//     seat a guest, or no clock recorded.
//
// So a null deadline is the whole answer and this must never re-derive the rule
// from status/user FKs — that would drift from the server the moment the rule is
// tuned. All that's left is the clock and the direction: you claim against the
// *idle* player, never yourself, so the viewer must hold the opposite seat.
//
// An *unparseable* deadline is read the same way as a null one — "no clock", so
// no claim. Never as "expired": a garbled field must not hand somebody a win.
//
// Both the deadline and `now` go through `toMillis`, so each accepts a Date,
// epoch ms, or an ISO string and defaults to the current time. The comparison is
// inclusive: exactly at the deadline, the claim is on.
export function canClaimTimeout(game, viewerSeat, now = Date.now()) {
  if (!game) return false;

  const waiting = game.turn_waiting_seat;
  if (waiting !== "p1" && waiting !== "p2") return false;
  if (viewerSeat !== otherSeat(waiting)) return false;

  const deadline = toMillis(game.turn_deadline);
  if (deadline == null) return false;
  const at = toMillis(now);
  if (at == null) return false;

  return at >= deadline;
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
