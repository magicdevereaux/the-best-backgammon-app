import {
  isSeatClosed,
  blockedSeat,
  isDeadlocked,
  isOnlineGame,
  survivingSeat,
  canAbandon,
  canClaimTimeout,
} from "../seats";

/*
 * The deadlock cases here mirror mobile/src/game/__tests__/gating.test.js —
 * the two clients must agree on when a game can no longer move.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=seats
 */

// An online game between two accounts, p2 to play.
const online = {
  status: "active",
  current_turn: "p2",
  player1_user: 1,
  player2_user: 2,
};

describe("isSeatClosed", () => {
  test("reads the per-seat deletion flags", () => {
    const g = { ...online, player1_deleted: true, player2_deleted: false };
    expect(isSeatClosed(g, "p1")).toBe(true);
    expect(isSeatClosed(g, "p2")).toBe(false);
  });

  test("absent flags mean the seat is open", () => {
    expect(isSeatClosed(online, "p1")).toBe(false);
    expect(isSeatClosed(online, "p2")).toBe(false);
    expect(isSeatClosed(null, "p1")).toBe(false);
  });

  test("only an exact `true` closes a seat", () => {
    // A truthy-but-not-true value (a stale string, say) must not close a seat.
    expect(isSeatClosed({ ...online, player1_deleted: "yes" }, "p1")).toBe(false);
  });
});

describe("blockedSeat", () => {
  test("is the current turn normally", () => {
    expect(blockedSeat({ ...online, current_turn: "p1" })).toBe("p1");
  });

  test("is the responder while a double is pending", () => {
    expect(blockedSeat({ ...online, current_turn: "p1", double_offered_by: "p1" })).toBe("p2");
    expect(blockedSeat({ ...online, current_turn: "p2", double_offered_by: "p2" })).toBe("p1");
  });
});

describe("isDeadlocked", () => {
  test("a closed seat holding the turn deadlocks the game, either side", () => {
    expect(isDeadlocked({ ...online, current_turn: "p2", player2_deleted: true })).toBe(true);
    expect(isDeadlocked({ ...online, current_turn: "p1", player1_deleted: true })).toBe(true);
  });

  test("a closed seat that does not hold the turn leaves play normal", () => {
    expect(isDeadlocked({ ...online, current_turn: "p1", player2_deleted: true })).toBe(false);
    expect(isDeadlocked({ ...online, current_turn: "p2", player1_deleted: true })).toBe(false);
  });

  test("absent flags behave exactly as before — never deadlocked", () => {
    expect(isDeadlocked(online)).toBe(false);
    expect(isDeadlocked({ ...online, player1_deleted: false, player2_deleted: false })).toBe(false);
    expect(isDeadlocked(null)).toBe(false);
  });

  test("pending double: an open responder can still answer, so no deadlock", () => {
    // p1 offered then deleted. p2 (open) may still accept or drop.
    const g = { ...online, current_turn: "p1", player1_deleted: true, double_offered_by: "p1" };
    expect(isDeadlocked(g)).toBe(false);
  });

  test("pending double: a closed responder deadlocks even on the offerer's turn", () => {
    const g = { ...online, current_turn: "p1", player2_deleted: true, double_offered_by: "p1" };
    expect(isDeadlocked(g)).toBe(true);
  });

  test("a finished game is never deadlocked, closed seat or not", () => {
    const g = { ...online, status: "finished", current_turn: "p2", player2_deleted: true };
    expect(isDeadlocked(g)).toBe(false);
  });

  test("a hotseat game with a closed seat is deadlocked too", () => {
    // Both seats are on this device, but the server still 403s the closed one.
    const g = { status: "active", current_turn: "p2", player2_deleted: true };
    expect(isDeadlocked(g)).toBe(true);
  });
});

describe("survivingSeat", () => {
  // A deadlocked game: p2 deleted their account and owes the next action, so
  // the server nulled their FK and flagged the seat.
  const deadlocked = {
    status: "active",
    current_turn: "p2",
    player1_user: 1,
    player2_user: null,
    player2_deleted: true,
  };

  test("is the seat opposite the closed one", () => {
    expect(survivingSeat(deadlocked)).toBe("p1");
    expect(
      survivingSeat({
        ...deadlocked,
        current_turn: "p1",
        player1_user: null,
        player1_deleted: true,
        player2_user: 2,
        player2_deleted: false,
      })
    ).toBe("p2");
  });

  test("follows the responder seat while a double is pending", () => {
    // p2 (closed) owes the answer, so p1 — the offerer — is the survivor.
    const g = { ...deadlocked, current_turn: "p1", double_offered_by: "p1" };
    expect(survivingSeat(g)).toBe("p1");
  });

  test("is null when the game is not deadlocked", () => {
    expect(survivingSeat({ ...deadlocked, current_turn: "p1" })).toBeNull();
    expect(survivingSeat(null)).toBeNull();
  });

  test("is null when both seats are closed — there is no survivor to act for", () => {
    const g = { ...deadlocked, player1_user: null, player1_deleted: true };
    expect(survivingSeat(g)).toBeNull();
  });
});

describe("canAbandon", () => {
  const deadlocked = {
    status: "active",
    current_turn: "p2",
    player1_user: 1,
    player2_user: null,
    player2_deleted: true,
  };

  test("false whenever the game is not deadlocked", () => {
    expect(canAbandon({ ...deadlocked, current_turn: "p1" })).toBe(false);
    expect(canAbandon({ ...deadlocked, status: "finished" })).toBe(false);
    expect(canAbandon(null)).toBe(false);
  });

  test("a registered survivor may abandon only when viewer_seat says it's them", () => {
    expect(canAbandon({ ...deadlocked, viewer_seat: "p1" })).toBe(true);
  });

  test("a bystander on a registered survivor seat may not", () => {
    // viewer_seat is the server's own answer; anyone who isn't the survivor
    // gets null (the closed seat's FK is null, so it can never be claimed).
    expect(canAbandon({ ...deadlocked, viewer_seat: null })).toBe(false);
    expect(canAbandon(deadlocked)).toBe(false);
    expect(canAbandon({ ...deadlocked, viewer_seat: "p2" })).toBe(false);
  });

  test("a guest survivor seat is offered the control — the server judges it", () => {
    // Null FK on the surviving seat: unverifiable server-side and
    // anonymous-playable by design, so nothing local can decide it.
    expect(canAbandon({ ...deadlocked, player1_user: null, viewer_seat: null })).toBe(true);
  });

  test("false when both seats are closed", () => {
    const g = { ...deadlocked, player1_user: null, player1_deleted: true, viewer_seat: null };
    expect(canAbandon(g)).toBe(false);
  });
});

/*
 * Inactivity forfeit. Mirrors mobile/src/game/__tests__/gating.test.js — the two
 * clients must agree on when a claim is on, and both take the viewer's seat as a
 * parameter because they answer "which seat is this?" differently (web: the
 * server's viewer_seat; mobile: a device-local registry).
 */
describe("canClaimTimeout", () => {
  const DEADLINE = "2026-08-02T12:00:00Z";
  const AT = Date.parse(DEADLINE);

  // p2 is on the clock, so p1 is the one who may claim.
  const onClock = {
    status: "active",
    current_turn: "p2",
    player1_user: 1,
    player2_user: 2,
    turn_waiting_seat: "p2",
    turn_deadline: DEADLINE,
  };

  test("the opponent of the waiting seat may claim once the deadline passes", () => {
    expect(canClaimTimeout(onClock, "p1", AT + 1000)).toBe(true);
    // ...and the mirror image, with p1 idle.
    const p1Idle = { ...onClock, current_turn: "p1", turn_waiting_seat: "p1" };
    expect(canClaimTimeout(p1Idle, "p2", AT + 1000)).toBe(true);
  });

  test("the boundary is inclusive: exactly at the deadline, the claim is on", () => {
    expect(canClaimTimeout(onClock, "p1", AT - 1)).toBe(false);
    expect(canClaimTimeout(onClock, "p1", AT)).toBe(true);
  });

  test("you can never claim against yourself", () => {
    // The idle player's own view, long past the deadline.
    expect(canClaimTimeout(onClock, "p2", AT + 86400000)).toBe(false);
  });

  test("a null deadline is the whole answer — no claim, ever", () => {
    // The server nulls it whenever a claim is impossible in principle (game not
    // active, a closed seat, a guest seat, no clock). Nothing here second-guesses
    // that, so even a payload that otherwise looks claimable stays false.
    expect(canClaimTimeout({ ...onClock, turn_deadline: null }, "p1", AT + 1000)).toBe(false);
    const noField = { ...onClock };
    delete noField.turn_deadline;
    expect(canClaimTimeout(noField, "p1", AT + 1000)).toBe(false);
  });

  test("no waiting seat means no claim", () => {
    expect(canClaimTimeout({ ...onClock, turn_waiting_seat: null }, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout({ ...onClock, turn_waiting_seat: "p3" }, "p1", AT + 1000)).toBe(false);
  });

  test("a viewer with no seat — a bystander — may not claim", () => {
    expect(canClaimTimeout(onClock, null, AT + 1000)).toBe(false);
    expect(canClaimTimeout(onClock, undefined, AT + 1000)).toBe(false);
  });

  test("accepts a Date, epoch ms, or an ISO string for `now`", () => {
    expect(canClaimTimeout(onClock, "p1", new Date(AT + 1000))).toBe(true);
    expect(canClaimTimeout(onClock, "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(onClock, "p1", "2026-08-02T12:00:01Z")).toBe(true);
    expect(canClaimTimeout(onClock, "p1", new Date(AT - 1000))).toBe(false);
  });

  test("`now` defaults to the current time", () => {
    const past = { ...onClock, turn_deadline: new Date(Date.now() - 60000).toISOString() };
    const future = { ...onClock, turn_deadline: new Date(Date.now() + 60000).toISOString() };
    expect(canClaimTimeout(past, "p1")).toBe(true);
    expect(canClaimTimeout(future, "p1")).toBe(false);
  });

  test("an unparseable deadline or clock is false, not a crash", () => {
    expect(canClaimTimeout({ ...onClock, turn_deadline: "soon" }, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(onClock, "p1", "whenever")).toBe(false);
  });

  test("no game is not claimable", () => {
    expect(canClaimTimeout(null, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout(undefined, "p1", AT + 1000)).toBe(false);
  });

  /*
   * Parity block. These four cases are byte-for-byte the ones in
   * mobile/src/game/__tests__/gating.test.js: both clients route the deadline
   * *and* `now` through the same toMillis, so both accept the same values and
   * reject the same ones. They drifted once (web rejected a numeric deadline and
   * accepted `now = Infinity`); these pin them together.
   */
  test("a numeric epoch deadline is accepted, exactly like an ISO string", () => {
    const numeric = { ...onClock, turn_deadline: AT };
    expect(canClaimTimeout(numeric, "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout(numeric, "p1", AT)).toBe(true); // inclusive here too
    expect(canClaimTimeout(numeric, "p1", AT - 1)).toBe(false);
    // ...and a Date deadline, the third accepted shape.
    expect(canClaimTimeout({ ...onClock, turn_deadline: new Date(AT) }, "p1", AT + 1)).toBe(true);
  });

  test("a non-finite deadline is 'no clock', not 'expired'", () => {
    expect(canClaimTimeout({ ...onClock, turn_deadline: Infinity }, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout({ ...onClock, turn_deadline: -Infinity }, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout({ ...onClock, turn_deadline: NaN }, "p1", AT + 1000)).toBe(false);
    expect(canClaimTimeout({ ...onClock, turn_deadline: new Date(NaN) }, "p1", AT + 1000)).toBe(false);
  });

  test("a non-finite `now` is false — an unusable clock never claims", () => {
    expect(canClaimTimeout(onClock, "p1", Infinity)).toBe(false);
    expect(canClaimTimeout(onClock, "p1", -Infinity)).toBe(false);
    expect(canClaimTimeout(onClock, "p1", NaN)).toBe(false);
    expect(canClaimTimeout(onClock, "p1", new Date(NaN))).toBe(false);
    expect(canClaimTimeout(onClock, "p1", null)).toBe(false);
  });

  test("eligibility is never re-derived — only turn_deadline gates", () => {
    // A finished game, a deleted seat and guest seats all still claim, because
    // the server would have nulled turn_deadline for every one of them. Adding
    // checks here would drift the moment the server's rule is tuned.
    expect(canClaimTimeout({ ...onClock, status: "finished" }, "p1", AT + 1000)).toBe(true);
    expect(canClaimTimeout({ ...onClock, player2_deleted: true }, "p1", AT + 1000)).toBe(true);
    const guests = { ...onClock, player1_user: null, player2_user: null };
    expect(canClaimTimeout(guests, "p1", AT + 1000)).toBe(true);
  });
});

describe("isOnlineGame", () => {
  test("two distinct accounts is online for anyone", () => {
    expect(isOnlineGame(online, 1)).toBe(true);
    expect(isOnlineGame(online, 2)).toBe(true);
    expect(isOnlineGame(online, undefined)).toBe(true); // spectating guest
  });

  test("a waiting game is online — only another client can fill the seat", () => {
    expect(isOnlineGame({ status: "waiting", player1_user: 1 }, 1)).toBe(true);
    expect(isOnlineGame({ status: "waiting", player1_user: null }, undefined)).toBe(true);
  });

  test("a guest hotseat game (no accounts on either seat) is local", () => {
    expect(isOnlineGame({ status: "active", player1_user: null, player2_user: null }, undefined)).toBe(false);
  });

  test("a hotseat game created by the logged-in viewer is local", () => {
    expect(isOnlineGame({ status: "active", player1_user: 7, player2_user: null }, 7)).toBe(false);
  });

  test("a seat owned by someone other than the viewer is online", () => {
    // Guest who joined a logged-in player's game by link, and a spectator.
    expect(isOnlineGame({ status: "active", player1_user: 7, player2_user: null }, undefined)).toBe(true);
    expect(isOnlineGame({ status: "active", player1_user: 7, player2_user: null }, 9)).toBe(true);
  });

  test("no game is not online", () => {
    expect(isOnlineGame(null, 1)).toBe(false);
  });
});
