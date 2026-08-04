import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import TurnReminderSection from "../TurnReminderSection";
import { updateTurnReminders } from "../../api/auth";

/*
 * The turn-reminder opt-out. Addresses are collected for password reset, so the
 * only thing that makes game mail legitimate is a switch the recipient can
 * actually reach — which means this control has to work, explain the cost of
 * switching it off, and never claim a state the server didn't confirm.
 * Behaviour parity with frontend/src/pages/__tests__/ProfilePage.test.jsx.
 *
 * Run with:
 *   cd mobile && CI=true npx jest TurnReminderSection
 */

jest.mock("../../api/auth", () => ({ updateTurnReminders: jest.fn() }));

const EMAIL = "a@example.com";
const sw = () => screen.getByTestId("turn-reminder-switch");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TurnReminderSection", () => {
  test("renders the saved preference when it is on", () => {
    render(<TurnReminderSection enabled={true} email={EMAIL} emailVerified onUpdated={jest.fn()} />);
    expect(sw().props.value).toBe(true);
    expect(screen.getByText(/forfeited without ever hearing about it/i)).toBeTruthy();
  });

  test("renders the saved preference when it is off", () => {
    render(<TurnReminderSection enabled={false} email={EMAIL} emailVerified onUpdated={jest.fn()} />);
    expect(sw().props.value).toBe(false);
  });

  test("switching it off PATCHes false and reflects the response", async () => {
    const updated = { id: 1, username: "alice", email: EMAIL, turn_reminder_emails: false };
    updateTurnReminders.mockResolvedValue(updated);
    const onUpdated = jest.fn();

    render(<TurnReminderSection enabled={true} email={EMAIL} emailVerified onUpdated={onUpdated} />);
    fireEvent(sw(), "valueChange", false);

    await waitFor(() => expect(updateTurnReminders).toHaveBeenCalledWith(false));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(await screen.findByText("Turn reminder emails are off.")).toBeTruthy();
    expect(sw().props.value).toBe(false);
  });

  test("switching it back on PATCHes true", async () => {
    updateTurnReminders.mockResolvedValue({
      id: 1, username: "alice", email: EMAIL, turn_reminder_emails: true,
    });

    render(<TurnReminderSection enabled={false} email={EMAIL} emailVerified onUpdated={jest.fn()} />);
    fireEvent(sw(), "valueChange", true);

    await waitFor(() => expect(updateTurnReminders).toHaveBeenCalledWith(true));
    expect(await screen.findByText("Turn reminder emails are on.")).toBeTruthy();
    expect(sw().props.value).toBe(true);
  });

  test("shows the server's answer, not the tap", async () => {
    // The server is authoritative: if it comes back still enabled, the switch
    // has to say enabled rather than the state the user asked for.
    updateTurnReminders.mockResolvedValue({
      id: 1, username: "alice", email: EMAIL, turn_reminder_emails: true,
    });

    render(<TurnReminderSection enabled={true} email={EMAIL} emailVerified onUpdated={jest.fn()} />);
    fireEvent(sw(), "valueChange", false);

    await waitFor(() => expect(updateTurnReminders).toHaveBeenCalled());
    await waitFor(() => expect(sw().props.value).toBe(true));
  });

  test("surfaces a save error and leaves the setting where it was", async () => {
    updateTurnReminders.mockRejectedValue(new Error("Could not save your reminder setting."));
    const onUpdated = jest.fn();

    render(<TurnReminderSection enabled={true} email={EMAIL} emailVerified onUpdated={onUpdated} />);
    fireEvent(sw(), "valueChange", false);

    expect(await screen.findByText("Could not save your reminder setting.")).toBeTruthy();
    expect(sw().props.value).toBe(true);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.queryByText("Turn reminder emails are off.")).toBeNull();
  });

  test("explains that an address is needed when none is on file", () => {
    render(<TurnReminderSection enabled={true} email="" onUpdated={jest.fn()} />);
    expect(screen.getByText(/No email address is saved on your account/i)).toBeTruthy();
    expect(sw().props.disabled).toBe(true);
  });

  test("drops the no-address explanation once an address is confirmed", () => {
    render(<TurnReminderSection enabled={true} email={EMAIL} emailVerified onUpdated={jest.fn()} />);
    expect(screen.queryByText(/No email address is saved on your account/i)).toBeNull();
    expect(screen.queryByText(/reminders are paused/i)).toBeNull();
    expect(sw().props.disabled).toBe(false);
  });

  /*
   * The two blockers are separate states and must read as separate states. An
   * unverified address is the trap: it *looks* like a working one on this
   * screen, so telling the user "no address is saved" would be plainly false
   * and leaving the switch live would tell them reminders are on when the
   * server will not send a single one. Mirrors the same pair of cases in
   * frontend/src/pages/__tests__/ProfilePage.test.jsx.
   */
  test("explains that an unconfirmed address blocks reminders, and disables the switch", () => {
    render(
      <TurnReminderSection
        enabled={true}
        email={EMAIL}
        emailVerified={false}
        onUpdated={jest.fn()}
      />
    );
    expect(screen.getByText(/reminders are paused/i)).toBeTruthy();
    // Not the *other* blocker's copy: there is an address, it just isn't proven.
    expect(screen.queryByText(/No email address is saved on your account/i)).toBeNull();
    expect(sw().props.disabled).toBe(true);
  });

  test("an unconfirmed address is treated as unsendable even with the preference on", () => {
    // `enabled` is the stored preference and it stays true — the point is that
    // a true preference is not a promise of mail. The server checks both, so
    // the UI must not let this one read as "reminders are on".
    render(
      <TurnReminderSection
        enabled={true}
        email={EMAIL}
        emailVerified={false}
        onUpdated={jest.fn()}
      />
    );
    expect(sw().props.value).toBe(true);
    expect(sw().props.disabled).toBe(true);
  });
});
