import {
  computeGating,
  isDeadlocked,
  isSeatClosed,
  canClaimTimeout,
  msUntilTurnDeadline,
  serverClockOffset,
} from "../gating";

function game(over = {}) {
  return {
    status: "active",
    current_turn: "p1",
    player1_user: null,
    player2_user: null,
    ...over,
  };
}

describe("computeGating", () => {
  test("hotseat (no accounts, no seat record) stays fully interactive", () => {
    const g = computeGating({ game: game(), userId: null, seatInfo: null });
    expect(g.gated).toBe(false);
    expect(g.canInteract).toBe(true); // both seats local on every turn
    const g2 = computeGating({ game: game({ current_turn: "p2" }), userId: null, seatInfo: null });
    expect(g2.canInteract).toBe(true);
  });

  test("two distinct accounts: I can act only on my seat's turn", () => {
    const g = game({ player1_user: 1, player2_user: 2, current_turn: "p1" });
    const asP1 = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(asP1.gated).toBe(true);
    expect(asP1.canInteract).toBe(true);
    expect(asP1.waitingForOpponent).toBe(false);

    const asP1OnP2Turn = computeGating({
      game: game({ player1_user: 1, player2_user: 2, current_turn: "p2" }),
      userId: 1,
      seatInfo: null,
    });
    expect(asP1OnP2Turn.canInteract).toBe(false);
    expect(asP1OnP2Turn.waitingForOpponent).toBe(true);
  });

  test("two accounts, I own neither seat → spectating, never interactive", () => {
    const g = game({ player1_user: 1, player2_user: 2 });
    const spec = computeGating({ game: g, userId: 99, seatInfo: null });
    expect(spec.spectating).toBe(true);
    expect(spec.canInteract).toBe(false);
  });

  test("guest-online via seat registry: gated even though player2_user is null", () => {
    // Logged-in creator (p1) vs a guest (player2_user stays null).
    const g = game({ player1_user: 1, player2_user: null, current_turn: "p1" });
    const seatInfo = { online: true, seats: ["p1"] };

    const myTurn = computeGating({ game: g, userId: 1, seatInfo });
    expect(myTurn.gated).toBe(true);
    expect(myTurn.canInteract).toBe(true);

    const oppTurn = computeGating({
      game: game({ player1_user: 1, player2_user: null, current_turn: "p2" }),
      userId: 1,
      seatInfo,
    });
    expect(oppTurn.canInteract).toBe(false);
    expect(oppTurn.waitingForOpponent).toBe(true);
  });

  test("server viewer_seat gates a fresh device with no local record (deep-link case)", () => {
    // Logged-in p1 vs a guest p2 (player2_user null), opened via deep link so
    // there is no seat registry record. The server's viewer_seat closes the gap.
    const base = { player1_user: 1, player2_user: null, viewer_seat: "p1" };

    const myTurn = computeGating({
      game: game({ ...base, current_turn: "p1" }),
      userId: 1,
      seatInfo: null,
    });
    expect(myTurn.gated).toBe(true);
    expect(myTurn.canInteract).toBe(true);

    const oppTurn = computeGating({
      game: game({ ...base, current_turn: "p2" }),
      userId: 1,
      seatInfo: null,
    });
    expect(oppTurn.canInteract).toBe(false);
    expect(oppTurn.waitingForOpponent).toBe(true);
  });

  test("local seat registry overrides server viewer_seat (hotseat opened by its owner)", () => {
    // A hotseat game whose creator is logged in: the server reports viewer_seat
    // "p1", but the device recorded it as local — local record wins, both seats
    // stay interactive.
    const g = game({ player1_user: 1, player2_user: null, viewer_seat: "p1", current_turn: "p2" });
    const seatInfo = { online: false, seats: ["p1", "p2"] };
    const res = computeGating({ game: g, userId: 1, seatInfo });
    expect(res.gated).toBe(false);
    expect(res.canInteract).toBe(true);
  });

  test("server viewer_seat 'p1p2' (same account both seats) is not gated", () => {
    const g = game({ player1_user: 1, player2_user: 1, viewer_seat: "p1p2", current_turn: "p2" });
    const res = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(res.gated).toBe(false);
    expect(res.canInteract).toBe(true);
  });

  test("seat registry marked local keeps a single device fully interactive", () => {
    const seatInfo = { online: false, seats: ["p1", "p2"] };
    const g1 = computeGating({ game: game({ current_turn: "p1" }), userId: 1, seatInfo });
    const g2 = computeGating({ game: game({ current_turn: "p2" }), userId: 1, seatInfo });
    expect(g1.canInteract).toBe(true);
    expect(g2.canInteract).toBe(true);
  });

  test("nothing is interactive once the game is finished", () => {
    const g = computeGating({
      game: game({ status: "finished", player1_user: 1, player2_user: 2 }),
      userId: 1,
      seatInfo: null,
    });
    expect(g.canInteract).toBe(false);
    expect(g.waitingForOpponent).toBe(false);
  });
});

// A seat closed by account deletion 403s for everyone, so a game whose next
// action belongs to that seat can never proceed. Absent flags mean OPEN.
describe("closed seats (account deletion)", () => {
  const online = { player1_user: 1, player2_user: 2 };

  test("flags absent entirely behave exactly as before", () => {
    const g = game({ ...online, current_turn: "p2" });
    expect(isSeatClosed(g, "p1")).toBe(false);
    expect(isSeatClosed(g, "p2")).toBe(false);
    expect(isDeadlocked(g)).toBe(false);
    const res = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(res.deadlocked).toBe(false);
    expect(res.waitingForOpponent).toBe(true);
  });

  test("neither seat closed (flags present and false) is not deadlocked", () => {
    const g = game({ ...online, player1_deleted: false, player2_deleted: false });
    expect(isDeadlocked(g)).toBe(false);
    expect(computeGating({ game: g, userId: 1, seatInfo: null }).deadlocked).toBe(false);
  });

  test("closed seat that does NOT hold the turn leaves play normal", () => {
    // p2 deleted, but it's p1's turn — p1 can still move.
    const g = game({ ...online, current_turn: "p1", player2_deleted: true });
    expect(isDeadlocked(g)).toBe(false);
    const asP1 = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(asP1.deadlocked).toBe(false);
    expect(asP1.canInteract).toBe(true);
  });

  test("closed p2 holding the turn deadlocks it for the surviving p1", () => {
    const g = game({ ...online, current_turn: "p2", player2_deleted: true });
    expect(isDeadlocked(g)).toBe(true);
    const asP1 = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(asP1.deadlocked).toBe(true);
    expect(asP1.canInteract).toBe(false);
    // distinct from waiting: nobody is coming
    expect(asP1.waitingForOpponent).toBe(false);
  });

  test("closed p1 holding the turn deadlocks it for the surviving p2", () => {
    const g = game({ ...online, current_turn: "p1", player1_deleted: true });
    expect(isDeadlocked(g)).toBe(true);
    const asP2 = computeGating({ game: g, userId: 2, seatInfo: null });
    expect(asP2.deadlocked).toBe(true);
    expect(asP2.canInteract).toBe(false);
    expect(asP2.waitingForOpponent).toBe(false);
  });

  test("the deleted account's own viewpoint is deadlocked too, not playable", () => {
    // Same payload, viewed from the closed seat's user id: still no play.
    const g = game({ ...online, current_turn: "p1", player1_deleted: true });
    const asP1 = computeGating({ game: g, userId: 1, seatInfo: null });
    expect(asP1.deadlocked).toBe(true);
    expect(asP1.canInteract).toBe(false);
  });

  test("a spectator sees the deadlock rather than a live game", () => {
    const g = game({ ...online, current_turn: "p2", player2_deleted: true });
    const spec = computeGating({ game: g, userId: 99, seatInfo: null });
    expect(spec.deadlocked).toBe(true);
    expect(spec.spectating).toBe(false);
    expect(spec.canInteract).toBe(false);
  });

  test("hotseat with a closed seat is deadlocked despite both seats being local", () => {
    const g = game({ current_turn: "p2", player2_deleted: true });
    const res = computeGating({ game: g, userId: null, seatInfo: null });
    expect(res.gated).toBe(false);
    expect(res.deadlocked).toBe(true);
    expect(res.canInteract).toBe(false);
  });

  test("a finished game is never deadlocked, closed seat or not", () => {
    const g = game({ ...online, status: "finished", player1_deleted: true });
    expect(isDeadlocked(g)).toBe(false);
    expect(computeGating({ game: g, userId: 2, seatInfo: null }).deadlocked).toBe(false);
  });

  test("pending double: an open responder can still answer, so no deadlock", () => {
    // p1 offered then deleted. p2 (open) may still accept or drop.
    const g = game({
      ...online,
      current_turn: "p1",
      player1_deleted: true,
      double_offered_by: "p1",
    });
    expect(isDeadlocked(g)).toBe(false);
    expect(computeGating({ game: g, userId: 2, seatInfo: null }).deadlocked).toBe(false);
  });

  test("pending double: a closed responder deadlocks even on the offerer's turn", () => {
    const g = game({
      ...online,
      current_turn: "p1",
      player2_deleted: true,
      double_offered_by: "p1",
    });
    expect(isDeadlocked(g)).toBe(true);
    expect(computeGating({ game: g, userId: 1, seatInfo: null }).deadlocked).toBe(true);
  });
});

// canAbandon mirrors POST /api/games/{id}/abandon/: it may only be offered to
// the surviving seat of a genuinely deadlocked game.
describe("canAbandon (the abandon button's visibility)", () => {
  const online = { player1_user: 1, player2_user: 2 };

  function gate(over, userId, seatInfo = null) {
    return computeGating({ game: game(over), userId, seatInfo });
  }

  test("false while the game is playable — nothing to close out", () => {
    expect(gate({ ...online, current_turn: "p1" }, 1).canAbandon).toBe(false);
    // opponent's turn, both seats open: waiting, not deadlocked
    expect(gate({ ...online, current_turn: "p2" }, 1).canAbandon).toBe(false);
  });

  test("false when a closed seat is not the one that owes the action", () => {
    const res = gate({ ...online, current_turn: "p1", player2_deleted: true }, 1);
    expect(res.deadlocked).toBe(false);
    expect(res.canAbandon).toBe(false);
  });

  test("true for the survivor once the closed seat holds the turn", () => {
    const asP1 = gate({ ...online, current_turn: "p2", player2_deleted: true }, 1);
    expect(asP1.deadlocked).toBe(true);
    expect(asP1.blockedSeat).toBe("p2");
    expect(asP1.survivingSeat).toBe("p1");
    expect(asP1.canAbandon).toBe(true);

    const asP2 = gate({ ...online, current_turn: "p1", player1_deleted: true }, 2);
    expect(asP2.canAbandon).toBe(true);
    expect(asP2.survivingSeat).toBe("p2");
  });

  test("false from the closed seat's own viewpoint", () => {
    // Viewed as the deleted account (user 1, seat p1): p1 is the blocked seat,
    // so this viewer holds no surviving seat and gets no button.
    const asClosed = gate({ ...online, current_turn: "p1", player1_deleted: true }, 1);
    expect(asClosed.deadlocked).toBe(true);
    expect(asClosed.canAbandon).toBe(false);
  });

  test("false for a spectator, who owns no seat at all", () => {
    const spec = gate({ ...online, current_turn: "p2", player2_deleted: true }, 99);
    expect(spec.deadlocked).toBe(true);
    expect(spec.iOwnASeat).toBe(false);
    expect(spec.canAbandon).toBe(false);
  });

  test("false when BOTH seats are closed — there is no survivor to act for", () => {
    const res = gate(
      { ...online, current_turn: "p2", player1_deleted: true, player2_deleted: true },
      1
    );
    expect(res.deadlocked).toBe(true);
    expect(res.canAbandon).toBe(false);
  });

  test("false once the game is finished (including right after abandoning)", () => {
    const res = gate(
      { ...online, status: "finished", win_type: "abandoned", current_turn: "p2", player2_deleted: true },
      1
    );
    expect(res.deadlocked).toBe(false);
    expect(res.canAbandon).toBe(false);
  });

  test("pending double: offered to the responder's survivor, not the offerer's", () => {
    // p2 (the responder) is closed, so p1 — who offered — is the survivor.
    const blocked = { ...online, current_turn: "p1", player2_deleted: true, double_offered_by: "p1" };
    expect(gate(blocked, 1).canAbandon).toBe(true);
    expect(gate(blocked, 2).canAbandon).toBe(false);

    // A closed *offerer* is no deadlock at all — the open responder can answer.
    const answerable = { ...online, current_turn: "p1", player1_deleted: true, double_offered_by: "p1" };
    expect(gate(answerable, 2).canAbandon).toBe(false);
  });

  test("guest survivor via the local seat registry still gets the button", () => {
    // Logged-out device that recorded seat p1 in an online game; p2 (an account)
    // was deleted. The server allows an anonymous caller on a guest seat.
    const res = gate(
      { player1_user: null, player2_user: 2, current_turn: "p2", player2_deleted: true },
      null,
      { online: true, seats: ["p1"] }
    );
    expect(res.canAbandon).toBe(true);
  });

  test("a device holding only the closed seat gets no button", () => {
    const res = gate(
      { player1_user: 1, player2_user: null, current_turn: "p1", player1_deleted: true },
      null,
      { online: true, seats: ["p1"] }
    );
    expect(res.deadlocked).toBe(true);
    expect(res.canAbandon).toBe(false);
  });
});

// canClaimTimeout mirrors POST /api/games/{id}/claim_timeout/. The eligibility
// rule itself lives on the server, which publishes turn_deadline: null whenever
// a claim is impossible in principle — so the predicate only adds "has it
// passed?" and "is it my opponent's clock?". Kept in sync with the identical
// function in frontend/src/utils/seats.js.
describe("canClaimTimeout", () => {
  const DEADLINE = "2026-08-02T12:00:00Z";
  const AT = Date.parse(DEADLINE);

  function clocked(over = {}) {
    return {
      status: "active",
      current_turn: "p2",
      player1_user: 1,
      player2_user: 2,
      turn_waiting_seat: "p2",
      turn_deadline: DEADLINE,
      ...over,
    };
  }

  test("true for the opponent of the idle seat once the deadline has passed", () => {
    expect(canClaimTimeout(clocked(), "p1", AT + 1000)).toBe(true);
  });

  test("mirrored for the other seat", () => {
    const g = clocked({ turn_waiting_seat: "p1", current_turn: "p1" });
    expect(canClaimTimeout(g, "p2", AT + 1000)).toBe(true);
    expect(canClaimTimeout(g, "p1", AT + 1000)).toBe(false);
  });

  test("false before the deadline", () => {
    expect(canClaimTimeout(clocked(), "p1", AT - 1)).toBe(false);
    expect(canClaimTimeout(clocked(), "p1", AT - 3600_000)).toBe(false);
  });

  test("the boundary is inclusive — exactly at the deadline is claimable", () => {
    expect(canClaimTimeout(clocked(), "p1", AT)).toBe(true);
  });

  test("false when claiming against yourself, however late it is", () => {
    // The seat on the clock never gets a button that forfeits its own game.
    expect(canClaimTimeout(clocked(), "p2", AT + 86_400_000)).toBe(false);
  });

  test("null turn_deadline means no claim is possible, full stop", () => {
    // The server nulls it for every ineligible case (guest seat, closed seat,
    // finished game, no clock recorded); the client never re-derives why.
    expect(canClaimTimeout(clocked({ turn_deadline: null }), "p1", AT + 1000)).toBe(false);
  });

  test("a missing turn_deadline field behaves like null", () => {
    const { turn_deadline, ...rest } = clocked();
    expect(canClaimTimeout(rest, "p1", AT + 1000)).toBe(false);
  });

  test("false without a turn_waiting_seat, or with a nonsense one", () => {
    expect(canClaimTimeout(clocked({ turn_waiting_seat: null }), "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked({ turn_waiting_seat: "p3" }), "p1", AT + 1000)).toBe(false);
  });

  test("false for a spectator or any viewer holding no seat", () => {
    expect(canClaimTimeout(clocked(), null, AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked(), undefined, AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked(), "p3", AT + 1000)).toBe(false);
  });

  test("false for a null/absent game", () => {
    expect(canClaimTimeout(null, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(undefined, "p1", AT + 1000)).toBe(false);
  });

  test("an unparseable deadline is treated as no deadline, not as expired", () => {
    expect(canClaimTimeout(clocked({ turn_deadline: "not a date" }), "p1", AT + 1000)).toBe(false);
  });

  test("now accepts a Date, epoch ms, or an ISO string alike", () => {
    expect(canClaimTimeout(clocked(), "p1", new Date(AT + 1000))).toBe(true);
    expect(canClaimTimeout(clocked(), "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(clocked(), "p1", new Date(AT + 1000).toISOString())).toBe(true);
    expect(canClaimTimeout(clocked(), "p1", new Date(AT - 1000))).toBe(false);
  });

  test("now defaults to the wall clock", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(canClaimTimeout(clocked({ turn_deadline: past }), "p1")).toBe(true);
    expect(canClaimTimeout(clocked({ turn_deadline: future }), "p1")).toBe(false);
  });

  test("the waiting seat need not be current_turn (a pending double)", () => {
    // The server decides which seat is on the clock; the client just reads it.
    // With a double pending that is the responder, not the player to move.
    const g = clocked({ current_turn: "p1", double_offered_by: "p1", turn_waiting_seat: "p2" });
    expect(canClaimTimeout(g, "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(g, "p2", AT + 1000)).toBe(false);
  });

  /*
   * Parity block. These four cases are byte-for-byte the ones in
   * frontend/src/utils/__tests__/seats.test.js: both clients route the deadline
   * *and* `now` through the same toMillis, so both accept the same values and
   * reject the same ones. They drifted once (web rejected a numeric deadline and
   * accepted `now = Infinity`); these pin them together.
   */
  test("a numeric epoch deadline is accepted, exactly like an ISO string", () => {
    const numeric = clocked({ turn_deadline: AT });
    expect(canClaimTimeout(numeric, "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(numeric, "p1", AT)).toBe(true); // inclusive here too
    expect(canClaimTimeout(numeric, "p1", AT - 1)).toBe(false);
    // ...and a Date deadline, the third accepted shape.
    expect(canClaimTimeout(clocked({ turn_deadline: new Date(AT) }), "p1", AT + 1)).toBe(true);
  });

  test("a non-finite deadline is 'no clock', not 'expired'", () => {
    expect(canClaimTimeout(clocked({ turn_deadline: Infinity }), "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked({ turn_deadline: -Infinity }), "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked({ turn_deadline: NaN }), "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(clocked({ turn_deadline: new Date(NaN) }), "p1", AT + 1000)).toBe(false);
  });

  test("a non-finite `now` is false — an unusable clock never claims", () => {
    expect(canClaimTimeout(clocked(), "p1", Infinity)).toBe(false);
    expect(canClaimTimeout(clocked(), "p1", -Infinity)).toBe(false);
    expect(canClaimTimeout(clocked(), "p1", NaN)).toBe(false);
    expect(canClaimTimeout(clocked(), "p1", new Date(NaN))).toBe(false);
    expect(canClaimTimeout(clocked(), "p1", null)).toBe(false);
  });

  test("eligibility is never re-derived — only turn_deadline gates", () => {
    // A finished game, a deleted seat and guest seats all still claim, because
    // the server would have nulled turn_deadline for every one of them. Adding
    // checks here would drift the moment the server's rule is tuned.
    expect(canClaimTimeout(clocked({ status: "finished" }), "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(clocked({ player2_deleted: true }), "p1", AT + 1000)).toBe(true);
    const guests = clocked({ player1_user: null, player2_user: null });
    expect(canClaimTimeout(guests, "p1", AT + 1000)).toBe(true);
  });
});

/*
 * Device clock skew. Every payload carries `server_now`; the offset it yields is
 * added to Date.now() before any deadline comparison, so a device running fast
 * or slow still counts down against the clock the server is judging by.
 *
 * Mirrored verbatim in frontend/src/utils/__tests__/seats.test.js.
 */
describe("serverClockOffset", () => {
  const SERVER = "2026-08-02T12:00:00Z";
  const AT = Date.parse(SERVER);

  test("a device running fast yields a negative offset that walks it back", () => {
    // Device thinks it is 12:02; the server says 12:00. Correcting the device
    // clock by the offset lands exactly on the server's time.
    const device = AT + 2 * 60_000;
    const offset = serverClockOffset({ server_now: SERVER }, device);
    expect(offset).toBe(-2 * 60_000);
    expect(device + offset).toBe(AT);
  });

  test("a device running slow yields a positive offset that pushes it forward", () => {
    const device = AT - 90 * 60_000; // an hour and a half behind
    const offset = serverClockOffset({ server_now: SERVER }, device);
    expect(offset).toBe(90 * 60_000);
    expect(device + offset).toBe(AT);
  });

  test("a device already in step yields no correction", () => {
    expect(serverClockOffset({ server_now: SERVER }, AT)).toBe(0);
  });

  test("a missing, null or garbage server_now falls back to zero, not to a broken clock", () => {
    // An older cached payload, or a fixture written before the field existed.
    expect(serverClockOffset({}, AT)).toBe(0);
    expect(serverClockOffset({ server_now: null }, AT)).toBe(0);
    expect(serverClockOffset({ server_now: "yesterday-ish" }, AT)).toBe(0);
    expect(serverClockOffset({ server_now: NaN }, AT)).toBe(0);
    expect(serverClockOffset({ server_now: Infinity }, AT)).toBe(0);
    expect(serverClockOffset(null, AT)).toBe(0);
    expect(serverClockOffset(undefined, AT)).toBe(0);
  });

  test("an unusable device clock also falls back to zero", () => {
    expect(serverClockOffset({ server_now: SERVER }, NaN)).toBe(0);
    expect(serverClockOffset({ server_now: SERVER }, "whenever")).toBe(0);
    expect(serverClockOffset({ server_now: SERVER }, null)).toBe(0);
  });

  test("server_now and the device clock take the same three shapes as every other instant", () => {
    expect(serverClockOffset({ server_now: AT }, AT - 1000)).toBe(1000);
    expect(serverClockOffset({ server_now: new Date(AT) }, AT - 1000)).toBe(1000);
    expect(serverClockOffset({ server_now: SERVER }, new Date(AT - 1000))).toBe(1000);
  });

  test("the device clock defaults to now, so a live payload reads as near-zero skew", () => {
    const offset = serverClockOffset({ server_now: new Date().toISOString() });
    expect(Math.abs(offset)).toBeLessThan(5000);
  });
});

/*
 * The point of the offset: canClaimTimeout keeps its signature (the caller
 * decides what "now" means), and the caller hands it the corrected instant.
 * Mirrored in frontend/src/utils/__tests__/seats.test.js.
 */
describe("canClaimTimeout with a corrected clock", () => {
  const DEADLINE = "2026-08-02T12:00:00Z";
  const AT = Date.parse(DEADLINE);
  const onClock = {
    status: "active",
    current_turn: "p2",
    player1_user: 1,
    player2_user: 2,
    turn_waiting_seat: "p2",
    turn_deadline: DEADLINE,
    server_now: new Date(AT - 60_000).toISOString(), // a minute of clock left
  };

  test("a device running two hours fast does not claim early once corrected", () => {
    const device = AT + 2 * 3600_000 - 60_000; // reads as an hour PAST the deadline
    expect(canClaimTimeout(onClock, "p1", device)).toBe(true); // uncorrected: wrong
    const offset = serverClockOffset(onClock, device);
    expect(canClaimTimeout(onClock, "p1", device + offset)).toBe(false);
  });

  test("a device running two hours slow still gets its claim once corrected", () => {
    // The server says the deadline passed a minute ago; the device disagrees.
    const past = { ...onClock, server_now: new Date(AT + 60_000).toISOString() };
    const device = AT - 2 * 3600_000 + 60_000;
    expect(canClaimTimeout(past, "p1", device)).toBe(false); // uncorrected: wrong
    const offset = serverClockOffset(past, device);
    expect(canClaimTimeout(past, "p1", device + offset)).toBe(true);
  });

  test("the boundary stays inclusive against the corrected clock", () => {
    const exact = { ...onClock, server_now: DEADLINE };
    const device = AT + 7 * 3600_000; // seven hours fast, arbitrarily
    const offset = serverClockOffset(exact, device);
    expect(canClaimTimeout(exact, "p1", device + offset)).toBe(true);
    expect(canClaimTimeout(exact, "p1", device + offset - 1)).toBe(false);
  });

  test("with no server_now the offset is zero, so behaviour is exactly as before", () => {
    const noAnchor = { ...onClock };
    delete noAnchor.server_now;
    const offset = serverClockOffset(noAnchor, AT + 1000);
    expect(offset).toBe(0);
    expect(canClaimTimeout(noAnchor, "p1", AT + 1000 + offset)).toBe(true);
  });
});

describe("msUntilTurnDeadline", () => {
  const DEADLINE = "2026-08-02T12:00:00Z";
  const AT = Date.parse(DEADLINE);
  const g = { turn_waiting_seat: "p2", turn_deadline: DEADLINE };

  test("counts down toward the deadline", () => {
    expect(msUntilTurnDeadline(g, AT - 90_000)).toBe(90_000);
    expect(msUntilTurnDeadline(g, AT)).toBe(0);
  });

  test("floors at zero rather than counting up past it", () => {
    expect(msUntilTurnDeadline(g, AT + 500_000)).toBe(0);
  });

  test("null when there is no usable deadline", () => {
    expect(msUntilTurnDeadline({ turn_deadline: null }, AT)).toBeNull();
    expect(msUntilTurnDeadline({}, AT)).toBeNull();
    expect(msUntilTurnDeadline({ turn_deadline: "nope" }, AT)).toBeNull();
    expect(msUntilTurnDeadline(null, AT)).toBeNull();
  });
});

// computeGating.viewerSeat: the single seat this device acts as, which is what
// canClaimTimeout needs (mySeats is a set and can hold two).
describe("computeGating viewerSeat", () => {
  test("the owned seat in a gated two-account game", () => {
    const g = game({ player1_user: 1, player2_user: 2 });
    expect(computeGating({ game: g, userId: 1, seatInfo: null }).viewerSeat).toBe("p1");
    expect(computeGating({ game: g, userId: 2, seatInfo: null }).viewerSeat).toBe("p2");
  });

  test("null for hotseat, where the device holds both seats", () => {
    const res = computeGating({ game: game(), userId: null, seatInfo: null });
    expect(res.mySeats).toEqual(["p1", "p2"]);
    expect(res.viewerSeat).toBeNull();
  });

  test("null for a spectator, who holds none", () => {
    const g = game({ player1_user: 1, player2_user: 2 });
    expect(computeGating({ game: g, userId: 99, seatInfo: null }).viewerSeat).toBeNull();
  });

  test("follows the device-local seat registry in a guest-online game", () => {
    const g = game({ player1_user: 1, player2_user: null });
    const res = computeGating({ game: g, userId: 1, seatInfo: { online: true, seats: ["p2"] } });
    expect(res.viewerSeat).toBe("p2");
  });
});
