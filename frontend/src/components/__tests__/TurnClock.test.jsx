import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import TurnClock, { formatRemaining } from "../TurnClock";

/*
 * The inactivity clock in both directions, plus the claim control it reveals.
 *
 * The countdown must come from a local 1s tick extrapolating `turn_deadline` —
 * NOT from the ~3.5s poll — so these tests advance fake timers without ever
 * handing the component a new payload. If a test here only passes when the game
 * prop changes, the countdown has been wired to polling by mistake.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=TurnClock
 */

const NOW = Date.parse("2026-08-02T12:00:00Z");
const inMs = (ms) => new Date(NOW + ms).toISOString();

// p2 (bob) is on the clock; viewer holds p1 (alice) unless overridden.
const BASE = {
  status: "active",
  current_turn: "p2",
  player1_name: "alice",
  player2_name: "bob",
  player1_user: 1,
  player2_user: 2,
  viewer_seat: "p1",
  turn_waiting_seat: "p2",
  turn_deadline: inMs(90 * 1000),
};

function renderClock(overrides = {}, onClaimTimeout = jest.fn()) {
  const utils = render(<TurnClock game={{ ...BASE, ...overrides }} onClaimTimeout={onClaimTimeout} />);
  return { ...utils, onClaimTimeout };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("formatRemaining", () => {
  test("is coarse at the top and precise at the bottom", () => {
    expect(formatRemaining(50 * 3600 * 1000)).toBe("2d 2h");
    expect(formatRemaining(3 * 3600 * 1000 + 12 * 60 * 1000)).toBe("3h 12m");
    expect(formatRemaining(90 * 1000)).toBe("1m 30s");
    expect(formatRemaining(45 * 1000)).toBe("45s");
  });

  test("never goes negative", () => {
    expect(formatRemaining(0)).toBe("0s");
    expect(formatRemaining(-5000)).toBe("0s");
  });
});

describe("TurnClock — nothing to show", () => {
  test("renders nothing when the server sent no deadline", () => {
    // The server withholds it whenever a claim is impossible in principle, so
    // this one field is the whole gate.
    const { container } = renderClock({ turn_deadline: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing when the field is absent entirely (older payloads)", () => {
    const game = { ...BASE };
    delete game.turn_deadline;
    delete game.turn_waiting_seat;
    const { container } = render(<TurnClock game={game} onClaimTimeout={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing for a bystander with no seat", () => {
    const { container } = renderClock({ viewer_seat: null, turn_deadline: inMs(-60 * 1000) });
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing without a waiting seat", () => {
    const { container } = renderClock({ turn_waiting_seat: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("renders nothing for a game object that never arrived", () => {
    const { container } = render(<TurnClock game={null} onClaimTimeout={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TurnClock — waiting on the opponent", () => {
  test("counts down to when the claim opens, naming the idle player", () => {
    renderClock();
    expect(screen.getByText(/waiting on bob — 1m 30s until you can claim/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim the win/i })).not.toBeInTheDocument();
  });

  test("ticks down every second without a new payload", () => {
    renderClock();
    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText(/1m 29s/)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(29 * 1000); });
    expect(screen.getByText(/1m 00s/)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(15 * 1000); });
    expect(screen.getByText(/45s until you can claim/i)).toBeInTheDocument();
  });

  test("the claim control appears the moment the clock runs out, poll or no poll", () => {
    renderClock();
    expect(screen.queryByRole("button", { name: /claim the win/i })).not.toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(90 * 1000); });

    expect(screen.getByRole("button", { name: /claim the win on time/i })).toBeInTheDocument();
    expect(screen.queryByText(/until you can claim/i)).not.toBeInTheDocument();
  });

  test("an already-elapsed deadline shows the claim control straight away", () => {
    renderClock({ turn_deadline: inMs(-60 * 1000) });
    expect(screen.getByRole("button", { name: /claim the win on time/i })).toBeInTheDocument();
    expect(screen.getByText(/bob ran out of time to move/i)).toBeInTheDocument();
  });

  test("clears its interval on unmount", () => {
    const clear = jest.spyOn(global, "clearInterval");
    const { unmount } = renderClock();
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("TurnClock — you are the one on the clock", () => {
  // Same payload, opposite seat: bob's browser.
  const mine = { viewer_seat: "p2" };

  test("warns you that you are on the clock, with time left and the consequence", () => {
    renderClock({ ...mine, turn_deadline: inMs(2 * 3600 * 1000) });
    expect(screen.getByText(/you're on the clock — 2h 0m left to move/i)).toBeInTheDocument();
    expect(screen.getByText(/alice can claim the win/i)).toBeInTheDocument();
  });

  test("never offers the idle player a claim against themselves", () => {
    renderClock({ ...mine, turn_deadline: inMs(-60 * 1000) });
    expect(screen.queryByRole("button", { name: /claim the win/i })).not.toBeInTheDocument();
  });

  test("says plainly when your time is up, and that moving still saves you", () => {
    renderClock({ ...mine, turn_deadline: inMs(-60 * 1000) });
    expect(screen.getByText(/your time is up/i)).toBeInTheDocument();
    expect(screen.getByText(/move now to stay in the game/i)).toBeInTheDocument();
  });

  test("counts down live, and crosses into the time-is-up warning on its own", () => {
    renderClock({ ...mine, turn_deadline: inMs(3000) });
    expect(screen.getByText(/3s left to move/i)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(2000); });
    expect(screen.getByText(/1s left to move/i)).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1500); });
    expect(screen.getByText(/your time is up/i)).toBeInTheDocument();
  });

  test("goes loud as the deadline gets close", () => {
    const { unmount } = renderClock({ ...mine, turn_deadline: inMs(6 * 3600 * 1000) });
    expect(screen.getByText(/you're on the clock/i)).toHaveAttribute("data-urgent", "false");
    unmount();

    renderClock({ ...mine, turn_deadline: inMs(30 * 1000) });
    expect(screen.getByText(/you're on the clock/i)).toHaveAttribute("data-urgent", "true");
  });

  // The urgency threshold is shared with mobile's TurnClockSection (URGENT_MS,
  // one hour). It diverged once — 5 minutes here vs 60 there — so pin the exact
  // boundary on both sides; mobile's mirror of this lives in
  // mobile/src/components/__tests__/TurnClockSection.test.jsx.
  test("the urgency threshold is one hour, inclusive", () => {
    const HOUR = 3600 * 1000;
    const { unmount } = renderClock({ ...mine, turn_deadline: inMs(HOUR + 1000) });
    expect(screen.getByText(/you're on the clock/i)).toHaveAttribute("data-urgent", "false");
    unmount();

    const second = renderClock({ ...mine, turn_deadline: inMs(HOUR) });
    expect(screen.getByText(/you're on the clock/i)).toHaveAttribute("data-urgent", "true");
    second.unmount();

    renderClock({ ...mine, turn_deadline: inMs(HOUR - 1000) });
    expect(screen.getByText(/you're on the clock/i)).toHaveAttribute("data-urgent", "true");
  });
});

describe("TurnClock — claiming", () => {
  const elapsed = { turn_deadline: inMs(-60 * 1000) };

  test("needs a second, explicit yes before it fires", () => {
    const { onClaimTimeout } = renderClock(elapsed);

    fireEvent.click(screen.getByRole("button", { name: /claim the win on time/i }));
    expect(onClaimTimeout).not.toHaveBeenCalled();
    expect(screen.getByText(/end the game and award yourself the win\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /yes, claim the win/i }));
    expect(onClaimTimeout).toHaveBeenCalledTimes(1);
  });

  test("cancelling calls nothing and leaves the control in place", () => {
    const { onClaimTimeout } = renderClock(elapsed);
    fireEvent.click(screen.getByRole("button", { name: /claim the win on time/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClaimTimeout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /claim the win on time/i })).toBeInTheDocument();
  });

  test("says this one scores, unlike closing out a deadlocked game", () => {
    renderClock(elapsed);
    expect(screen.getByText(/scores as a single, doubled by the cube/i)).toBeInTheDocument();
    // ...and that waiting stays an option: nothing expires on its own.
    expect(screen.getByText(/keep waiting; nothing expires/i)).toBeInTheDocument();
  });
});
