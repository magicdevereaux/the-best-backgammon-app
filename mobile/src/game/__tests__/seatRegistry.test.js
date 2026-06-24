import {
  recordOnlineSeat,
  recordLocalGame,
  getSeatInfo,
  __resetSeatsForTest,
} from "../seatRegistry";

beforeEach(() => __resetSeatsForTest());

describe("seatRegistry", () => {
  test("unknown game → null", () => {
    expect(getSeatInfo(123)).toBeNull();
  });

  test("local (hotseat) game owns both seats and is not online", () => {
    recordLocalGame(7);
    expect(getSeatInfo(7)).toEqual({ online: false, seats: ["p1", "p2"] });
  });

  test("online seat records the single owned seat", () => {
    recordOnlineSeat(7, "p1");
    expect(getSeatInfo(7)).toEqual({ online: true, seats: ["p1"] });
    recordOnlineSeat(8, "p2");
    expect(getSeatInfo(8)).toEqual({ online: true, seats: ["p2"] });
  });

  test("recording both seats on one device collapses to p1p2", () => {
    recordOnlineSeat(9, "p1");
    recordOnlineSeat(9, "p2");
    expect(getSeatInfo(9)).toEqual({ online: true, seats: ["p1", "p2"] });
  });

  test("ids are normalised across string/number", () => {
    recordOnlineSeat("42", "p2");
    expect(getSeatInfo(42)).toEqual({ online: true, seats: ["p2"] });
  });
});
