import { isSeatClosed, blockedSeat, isDeadlocked, isOnlineGame } from "../seats";

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
