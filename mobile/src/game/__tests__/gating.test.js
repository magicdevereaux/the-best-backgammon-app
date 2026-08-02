import { computeGating, isDeadlocked, isSeatClosed } from "../gating";

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
