import React from "react";
import { Alert, AppState } from "react-native";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";

import TurnClockSection from "../TurnClockSection";
import { formatDuration } from "../../game/useTurnClock";

/*
 * The inactivity clock, in both directions.
 *
 * Everything here hangs off the server's `turn_deadline`: it is null whenever a
 * claim is impossible in principle, so the component renders nothing and no
 * eligibility rule is re-derived client-side. gating.test.js covers the
 * canClaimTimeout truth table; these tests cover what the player actually sees
 * — including that the player ON the clock is warned about it, which is the
 * whole point of building it in both directions.
 *
 * Fake timers with a pinned system time so the 1s countdown is deterministic.
 *
 * Run with:
 *   cd mobile && CI=true npx jest TurnClockSection
 */

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const CLAIM_BTN = "Claim Win on Time";

function clocked(over = {}) {
  return {
    status: "active",
    current_turn: "p2",
    player1_name: "Alice",
    player2_name: "Bob",
    player1_user: 1,
    player2_user: 2,
    turn_waiting_seat: "p2",
    // Five minutes out by default.
    turn_deadline: new Date(NOW + 5 * 60_000).toISOString(),
    ...over,
  };
}

function renderClock(game, viewerSeat, onClaimTimeout = jest.fn()) {
  render(
    <TurnClockSection game={game} viewerSeat={viewerSeat} onClaimTimeout={onClaimTimeout} />
  );
  return onClaimTimeout;
}

function autoPressAlertButton(label) {
  return jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => {
    const button = buttons.find((b) => b.text === label);
    if (button && button.onPress) button.onPress();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("TurnClockSection visibility", () => {
  test("renders nothing when the server issued no deadline", () => {
    const { toJSON } = render(
      <TurnClockSection
        game={clocked({ turn_deadline: null })}
        viewerSeat="p1"
        onClaimTimeout={jest.fn()}
      />
    );
    expect(toJSON()).toBeNull();
  });

  test("renders nothing when the payload has no clock fields at all", () => {
    const { toJSON } = render(
      <TurnClockSection
        game={{ status: "active", current_turn: "p1", player1_name: "Alice", player2_name: "Bob" }}
        viewerSeat="p1"
        onClaimTimeout={jest.fn()}
      />
    );
    expect(toJSON()).toBeNull();
  });

  test("renders nothing for a spectator, who is on neither side of the clock", () => {
    const { toJSON } = render(
      <TurnClockSection game={clocked()} viewerSeat={null} onClaimTimeout={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  test("renders nothing without a turn_waiting_seat", () => {
    const { toJSON } = render(
      <TurnClockSection
        game={clocked({ turn_waiting_seat: null })}
        viewerSeat="p1"
        onClaimTimeout={jest.fn()}
      />
    );
    expect(toJSON()).toBeNull();
  });
});

describe("TurnClockSection — the opponent is on the clock", () => {
  test("counts down toward the claim instead of offering it early", () => {
    renderClock(clocked(), "p1");
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();
  });

  test("the countdown ticks once a second, not once a poll", () => {
    renderClock(clocked(), "p1");
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText("Waiting on Bob — 4:59")).toBeTruthy();
    act(() => { jest.advanceTimersByTime(59_000); });
    expect(screen.getByText("Waiting on Bob — 4:00")).toBeTruthy();
  });

  test("the claim control appears the moment the deadline elapses", () => {
    renderClock(clocked(), "p1");
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();

    act(() => { jest.advanceTimersByTime(5 * 60_000); });

    expect(screen.getByText("Bob ran out of time")).toBeTruthy();
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
    expect(screen.queryByText(/Waiting on Bob/)).toBeNull();
  });

  test("an already-expired deadline offers the claim on first render", () => {
    renderClock(clocked({ turn_deadline: new Date(NOW - 60_000).toISOString() }), "p1");
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
  });

  test("mirrored for the other seat", () => {
    renderClock(
      clocked({
        current_turn: "p1",
        turn_waiting_seat: "p1",
        turn_deadline: new Date(NOW - 1).toISOString(),
      }),
      "p2"
    );
    expect(screen.getByText("Alice ran out of time")).toBeTruthy();
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
  });

  test("says the claim scores, unlike closing out an abandoned game", () => {
    renderClock(clocked({ turn_deadline: new Date(NOW - 1).toISOString() }), "p1");
    expect(screen.getByText(/scored into the match/i)).toBeTruthy();
  });
});

describe("TurnClockSection — you are on the clock", () => {
  test("warns you, with time remaining, and never offers you a claim", () => {
    // Three hours out: informational, not yet a warning.
    renderClock(clocked({ turn_deadline: new Date(NOW + 3 * 3600_000).toISOString() }), "p2");
    expect(screen.getByText("It's your move — 3h 0m left")).toBeTruthy();
    expect(screen.getByText(/Alice can claim the win/)).toBeTruthy();
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();
  });

  test("escalates to a bare time-left warning as it gets close", () => {
    renderClock(clocked(), "p2"); // five minutes
    expect(screen.getByText("5:00 left to move")).toBeTruthy();
    expect(screen.queryByText(/It's your move/)).toBeNull();
  });

  test("your own countdown ticks too", () => {
    renderClock(clocked(), "p2");
    act(() => { jest.advanceTimersByTime(61_000); });
    expect(screen.getByText("3:59 left to move")).toBeTruthy();
  });

  test("past the deadline you are told so, but the game is still yours to save", () => {
    renderClock(clocked({ turn_deadline: new Date(NOW - 60_000).toISOString() }), "p2");
    expect(screen.getByText("You are out of time")).toBeTruthy();
    expect(screen.getByText(/Move now/)).toBeTruthy();
    // The seat on the clock must never be handed a button that forfeits itself.
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();
  });

  test("no claim button however far past the deadline it is", () => {
    renderClock(clocked({ turn_deadline: new Date(NOW - 86_400_000).toISOString() }), "p2");
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();
  });

  // The urgency threshold is shared with the web client's TurnClock (URGENT_MS,
  // one hour). It diverged once — 60 minutes here vs 5 there — so pin the exact
  // boundary on both sides; web's mirror of this lives in
  // frontend/src/components/__tests__/TurnClock.test.jsx.
  test("the urgency threshold is one hour, inclusive", () => {
    const HOUR = 3600_000;
    const at = (ms) => clocked({ turn_deadline: new Date(NOW + ms).toISOString() });

    const over = render(
      <TurnClockSection game={at(HOUR + 1000)} viewerSeat="p2" onClaimTimeout={jest.fn()} />
    );
    expect(screen.getByText(/^It's your move/)).toBeTruthy();
    over.unmount();

    const exact = render(
      <TurnClockSection game={at(HOUR)} viewerSeat="p2" onClaimTimeout={jest.fn()} />
    );
    expect(screen.getByText("1h 0m left to move")).toBeTruthy();
    exact.unmount();

    render(<TurnClockSection game={at(HOUR - 1000)} viewerSeat="p2" onClaimTimeout={jest.fn()} />);
    expect(screen.getByText("59:59 left to move")).toBeTruthy();
  });
});

/*
 * Device clock skew. The tick samples this device's clock, but every reading is
 * corrected by `clockOffset` (useGame, from `server_now`) before it is compared
 * with the deadline — so what the player sees is the server's clock, which is
 * the one that decides the game.
 *
 * Mirrored in frontend/src/components/__tests__/TurnClock.test.jsx.
 */
describe("TurnClockSection — a device whose clock is wrong", () => {
  const HOUR = 3600_000;

  function renderSkewed(game, viewerSeat, clockOffset) {
    return render(
      <TurnClockSection
        game={game}
        viewerSeat={viewerSeat}
        clockOffset={clockOffset}
        onClaimTimeout={jest.fn()}
      />
    );
  }

  test("a fast device counts down correctly instead of claiming early", () => {
    // The device reads two hours ahead of the server. Five minutes left in
    // SERVER time, so an uncorrected clock would already offer the claim.
    const game = clocked({ turn_deadline: new Date(NOW - 2 * HOUR + 5 * 60_000).toISOString() });
    renderSkewed(game, "p1", -2 * HOUR);

    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();

    // ...and it still opens on time, ticking against the corrected clock.
    act(() => { jest.advanceTimersByTime(5 * 60_000); });
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
  });

  test("a slow device is not told it still has time it does not have", () => {
    // Three hours behind. In server time the deadline passed a minute ago.
    const game = clocked({ turn_deadline: new Date(NOW + 3 * HOUR - 60_000).toISOString() });
    renderSkewed(game, "p1", 3 * HOUR);

    expect(screen.getByText("Bob ran out of time")).toBeTruthy();
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
    expect(screen.queryByText(/Waiting on Bob/)).toBeNull();
  });

  test("the seat on the clock is warned against the corrected clock too", () => {
    // Bob's slow device would otherwise think he had three more hours.
    const game = clocked({ turn_deadline: new Date(NOW + 3 * HOUR - 60_000).toISOString() });
    renderSkewed(game, "p2", 3 * HOUR);
    expect(screen.getByText("You are out of time")).toBeTruthy();
  });

  test("the boundary is still inclusive once the offset is applied", () => {
    // Corrected now === deadline exactly.
    const exact = renderSkewed(
      clocked({ turn_deadline: new Date(NOW - HOUR).toISOString() }),
      "p1",
      -HOUR
    );
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
    exact.unmount();

    // One millisecond short of it.
    renderSkewed(clocked({ turn_deadline: new Date(NOW - HOUR + 1).toISOString() }), "p1", -HOUR);
    expect(screen.queryByText(CLAIM_BTN)).toBeNull();
  });

  test("a missing or unusable offset falls back to the device clock, unbroken", () => {
    // No prop at all (an older caller), and a garbage one.
    const plain = render(
      <TurnClockSection game={clocked()} viewerSeat="p1" onClaimTimeout={jest.fn()} />
    );
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
    plain.unmount();

    renderSkewed(clocked(), "p1", NaN);
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
  });

  test("a gross disagreement is explained, and says which way round it is", () => {
    const fast = renderSkewed(clocked(), "p1", -2 * HOUR);
    expect(screen.getByText(/this device's clock is 2h 0m ahead of the server's/i)).toBeTruthy();
    expect(screen.getByText(/follows the server/i)).toBeTruthy();
    fast.unmount();

    renderSkewed(clocked(), "p1", 2 * HOUR);
    expect(screen.getByText(/this device's clock is 2h 0m behind the server's/i)).toBeTruthy();
  });

  test("a small, ordinary offset is not worth mentioning — five minutes is the line", () => {
    const FIVE = 5 * 60_000;
    const under = renderSkewed(clocked(), "p1", FIVE - 1000);
    expect(screen.queryByText(/this device's clock/i)).toBeNull();
    under.unmount();

    renderSkewed(clocked(), "p1", FIVE);
    expect(screen.getByText(/this device's clock/i)).toBeTruthy();
  });

  test("the notice reaches every branch — waiting, claimable, and on the clock", () => {
    const onClock = renderSkewed(clocked(), "p2", 6 * HOUR);
    expect(screen.getByText(/this device's clock/i)).toBeTruthy();
    onClock.unmount();

    const claimable = renderSkewed(
      clocked({ turn_deadline: new Date(NOW - 60_000).toISOString() }),
      "p1",
      6 * HOUR
    );
    expect(screen.getByText(/this device's clock/i)).toBeTruthy();
    claimable.unmount();

    // Still waiting: the deadline is beyond even the corrected clock.
    renderSkewed(
      clocked({ turn_deadline: new Date(NOW + 6 * HOUR + 5 * 60_000).toISOString() }),
      "p1",
      6 * HOUR
    );
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
    expect(screen.getByText(/this device's clock/i)).toBeTruthy();
  });
});

describe("TurnClockSection claiming", () => {
  const expired = () => clocked({ turn_deadline: new Date(NOW - 1000).toISOString() });

  test("confirms through the platform dialog before ending anyone's game", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onClaim = renderClock(expired(), "p1");

    fireEvent.press(screen.getByText(CLAIM_BTN));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Claim a win on time?");
    expect(message).toMatch(/Bob has run out of time/);
    expect(message).toMatch(/single game at the current stakes/);
    expect(buttons.map((b) => b.style)).toEqual(["cancel", "destructive"]);
    // Nothing fires until the dialog is answered.
    expect(onClaim).not.toHaveBeenCalled();
  });

  test("cancelling does not call the endpoint", () => {
    autoPressAlertButton("Cancel");
    const onClaim = renderClock(expired(), "p1");
    fireEvent.press(screen.getByText(CLAIM_BTN));
    expect(onClaim).not.toHaveBeenCalled();
  });

  test("confirming calls onClaimTimeout once", async () => {
    autoPressAlertButton("Claim Win");
    const onClaim = jest.fn().mockResolvedValue(undefined);
    renderClock(expired(), "p1", onClaim);

    fireEvent.press(screen.getByText(CLAIM_BTN));
    await waitFor(() => expect(onClaim).toHaveBeenCalledTimes(1));
  });

  test("a rejected claim (e.g. a 400 'too early' from clock skew) leaves the button usable", async () => {
    autoPressAlertButton("Claim Win");
    // useGame routes the server message into actionError; guard the rejecting
    // case too, so the busy flag clears and a retry is possible.
    const onClaim = jest.fn().mockRejectedValue(new Error("The turn deadline has not passed."));
    renderClock(expired(), "p1", onClaim);

    fireEvent.press(screen.getByText(CLAIM_BTN));
    await waitFor(() => expect(onClaim).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(CLAIM_BTN)).toBeTruthy());

    fireEvent.press(screen.getByText(CLAIM_BTN));
    await waitFor(() => expect(onClaim).toHaveBeenCalledTimes(2));
  });
});

describe("TurnClockSection lifecycle", () => {
  test("the tick is torn down on unmount", () => {
    const { unmount } = render(
      <TurnClockSection game={clocked()} viewerSeat="p1" onClaimTimeout={jest.fn()} />
    );
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("no timer is left running with no deadline to count", () => {
    render(
      <TurnClockSection
        game={clocked({ turn_deadline: null })}
        viewerSeat="p1"
        onClaimTimeout={jest.fn()}
      />
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test("backgrounding stops the tick; resuming recomputes from the wall clock", () => {
    const listeners = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, cb) => {
      if (event === "change") listeners.push(cb);
      return { remove: jest.fn() };
    });

    renderClock(clocked(), "p1");
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    act(() => { listeners.forEach((cb) => cb("background")); });
    expect(jest.getTimerCount()).toBe(0);

    // Two minutes pass with the app backgrounded and nothing ticking.
    act(() => { jest.setSystemTime(NOW + 120_000); });
    expect(screen.getByText("Waiting on Bob — 5:00")).toBeTruthy(); // stale, as expected

    // Resuming resyncs to the wall clock rather than replaying missed ticks.
    act(() => { listeners.forEach((cb) => cb("active")); });
    expect(screen.getByText("Waiting on Bob — 3:00")).toBeTruthy();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  test("the tick stops once the deadline has passed — nothing left to count", () => {
    renderClock(clocked(), "p1");
    act(() => { jest.advanceTimersByTime(5 * 60_000); });
    expect(screen.getByText(CLAIM_BTN)).toBeTruthy();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("formatDuration", () => {
  test("coarse above an hour, precise below it", () => {
    expect(formatDuration(2 * 86_400_000 + 3 * 3600_000)).toBe("2d 3h");
    expect(formatDuration(5 * 3600_000 + 12 * 60_000)).toBe("5h 12m");
    expect(formatDuration(4 * 60_000 + 31_000)).toBe("4:31");
    expect(formatDuration(18_000)).toBe("18s");
    expect(formatDuration(0)).toBe("0s");
  });

  test("never renders a negative clock", () => {
    expect(formatDuration(-5000)).toBe("0s");
  });
});
