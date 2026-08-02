import React from "react";
import { Alert } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import AbandonGameSection from "../AbandonGameSection";
import { computeGating } from "../../game/gating";

/*
 * The abandon control: the only way out of a game deadlocked by a closed seat.
 *
 * Visibility is decided by `canAbandon` from computeGating (exercised end-to-end
 * below with real gating output, so the button and the rule can't drift apart);
 * gating.test.js covers the derivation itself. Alert.alert is spied on so the
 * platform confirmation can be inspected without a native runtime.
 *
 * Run with:
 *   cd mobile && CI=true npx jest AbandonGameSection
 */

function autoPressAlertButton(label) {
  return jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => {
    const button = buttons.find((b) => b.text === label);
    if (button && button.onPress) button.onPress();
  });
}

const BTN = "Close Out This Game";

function deadlockedGame(over = {}) {
  return {
    status: "active",
    current_turn: "p2",
    player1_user: 1,
    player2_user: 2,
    player2_deleted: true,
    ...over,
  };
}

/** Render the section the way the game screen does: gating decides visibility. */
function renderFor(game, userId, onAbandon = jest.fn()) {
  const { canAbandon } = computeGating({ game, userId, seatInfo: null });
  render(<AbandonGameSection canAbandon={canAbandon} onAbandon={onAbandon} />);
  return onAbandon;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AbandonGameSection visibility", () => {
  test("shows for the survivor of a deadlocked game", () => {
    renderFor(deadlockedGame(), 1);
    expect(screen.getByText(BTN)).toBeTruthy();
  });

  test("hidden while the game is still playable", () => {
    renderFor(deadlockedGame({ current_turn: "p1", player2_deleted: false }), 1);
    expect(screen.queryByText(BTN)).toBeNull();
  });

  test("hidden from the closed seat's own viewpoint", () => {
    renderFor(deadlockedGame({ current_turn: "p1", player2_deleted: false, player1_deleted: true }), 1);
    expect(screen.queryByText(BTN)).toBeNull();
  });

  test("hidden from a spectator", () => {
    renderFor(deadlockedGame(), 99);
    expect(screen.queryByText(BTN)).toBeNull();
  });

  test("hidden once the game is finished", () => {
    renderFor(deadlockedGame({ status: "finished", win_type: "abandoned" }), 1);
    expect(screen.queryByText(BTN)).toBeNull();
  });

  test("renders nothing at all when canAbandon is false", () => {
    const { toJSON } = render(<AbandonGameSection canAbandon={false} onAbandon={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });
});

describe("AbandonGameSection confirmation", () => {
  test("says it is not a resignation and that nobody scores", () => {
    renderFor(deadlockedGame(), 1);
    expect(screen.getByText(/no winner and no points/i)).toBeTruthy();
  });

  test("confirms through the platform dialog with a destructive button", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onAbandon = renderFor(deadlockedGame(), 1);

    fireEvent.press(screen.getByText(BTN));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Close out this game?");
    expect(message).toMatch(/not a resignation/i);
    expect(message).toMatch(/no winner/i);
    expect(buttons.map((b) => b.style)).toEqual(["cancel", "destructive"]);
    // Nothing fires until the dialog is answered.
    expect(onAbandon).not.toHaveBeenCalled();
  });

  test("cancelling does not call the endpoint", () => {
    autoPressAlertButton("Cancel");
    const onAbandon = renderFor(deadlockedGame(), 1);
    fireEvent.press(screen.getByText(BTN));
    expect(onAbandon).not.toHaveBeenCalled();
  });

  test("confirming calls onAbandon once", async () => {
    autoPressAlertButton("Close Out");
    const onAbandon = jest.fn().mockResolvedValue(undefined);
    renderFor(deadlockedGame(), 1, onAbandon);

    fireEvent.press(screen.getByText(BTN));
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1));
  });

  test("a failing abandon leaves the button usable for a retry", async () => {
    autoPressAlertButton("Close Out");
    // useGame swallows the error into actionError, but guard the rejecting case
    // too: the busy flag must clear either way.
    const onAbandon = jest.fn().mockRejectedValue(new Error("Game is not active."));
    renderFor(deadlockedGame(), 1, onAbandon);

    fireEvent.press(screen.getByText(BTN));
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(BTN)).toBeTruthy());

    fireEvent.press(screen.getByText(BTN));
    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(2));
  });
});
