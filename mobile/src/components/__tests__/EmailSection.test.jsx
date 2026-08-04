import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import EmailSection from "../EmailSection";
import { updateEmail, resendEmailVerification } from "../../api/auth";
import { colors } from "../../theme";

/*
 * Changing the account email, and reporting honestly whether it is confirmed.
 *
 * Email is required at registration as of ADR-003, so two old behaviours are
 * gone and are asserted gone: there is no remove path (the server 400s a blank
 * address), and "optional" is no longer the story the copy tells.
 *
 * Run with:
 *   cd mobile && CI=true npx jest EmailSection
 */

jest.mock("../../api/auth", () => ({
  updateEmail: jest.fn(),
  resendEmailVerification: jest.fn(),
}));

// The 429 cool-down and the 400 both arrive as an Error carrying `.status`
// (api/client.js tags it); the component branches on that, not on the wording.
function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("EmailSection", () => {
  test("prefills the current address and disables Save until it changes", () => {
    render(<EmailSection email="a@example.com" emailVerified onUpdated={jest.fn()} />);

    expect(screen.getByDisplayValue("a@example.com")).toBeTruthy();

    fireEvent.press(screen.getByText("Save Email"));
    expect(updateEmail).not.toHaveBeenCalled();
  });

  test("explains the gap when an older account has no address at all", () => {
    render(<EmailSection email="" onUpdated={jest.fn()} />);
    expect(screen.getByText(/reset your password/i)).toBeTruthy();
    expect(screen.getByText(/no email address/i)).toBeTruthy();
  });

  test("saves a new address and reports the fresh user upward", async () => {
    const updated = { id: 1, username: "alice", email: "new@example.com", email_verified: false };
    updateEmail.mockResolvedValue(updated);
    const onUpdated = jest.fn();

    render(<EmailSection email="" onUpdated={onUpdated} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "new@example.com");
    fireEvent.press(screen.getByText("Save Email"));

    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith("new@example.com"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(await screen.findByText("Email address saved.")).toBeTruthy();
  });

  test("offers no remove path — blanking the field cannot be saved", async () => {
    // The server rejects a blank address now, so an affordance that could only
    // ever produce a 400 was removed rather than left to fail politely.
    render(<EmailSection email="a@example.com" emailVerified onUpdated={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "");

    expect(screen.queryByText("Remove Email")).toBeNull();
    fireEvent.press(screen.getByText("Save Email"));
    expect(updateEmail).not.toHaveBeenCalled();
  });

  test("shows the server's validation error and keeps what was typed", async () => {
    updateEmail.mockRejectedValue(new Error("Enter a valid email address."));
    const onUpdated = jest.fn();

    render(<EmailSection email="" onUpdated={onUpdated} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "nope");
    fireEvent.press(screen.getByText("Save Email"));

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("nope")).toBeTruthy();
  });

  describe("verification state", () => {
    test("a confirmed address says so and offers no resend", () => {
      render(<EmailSection email="a@example.com" emailVerified onUpdated={jest.fn()} />);

      expect(screen.getByText("Confirmed.")).toBeTruthy();
      expect(screen.queryByText("Resend confirmation")).toBeNull();
    });

    test("an unconfirmed address names the consequence and points at the browser", () => {
      render(<EmailSection email="a@example.com" emailVerified={false} onUpdated={jest.fn()} />);

      expect(screen.getByText("Not confirmed yet.")).toBeTruthy();
      // The only thing verification gates: turn-reminder mail, i.e. the warning
      // before a forfeit on the 48-hour clock.
      expect(screen.getByText(/turn reminders/i)).toBeTruthy();
      expect(screen.getByText(/48-hour clock/i)).toBeTruthy();
      // No mobile deep link exists; the copy must not imply the app catches it.
      expect(screen.getByText(/in your browser, not in the app/i)).toBeTruthy();
      expect(screen.getByText("Resend confirmation")).toBeTruthy();
    });

    test("an account with no address gets no resend button", () => {
      render(<EmailSection email="" emailVerified={false} onUpdated={jest.fn()} />);
      expect(screen.queryByText("Resend confirmation")).toBeNull();
    });

    test("saving a new address drops back to unconfirmed, per the server", async () => {
      updateEmail.mockResolvedValue({ email: "new@example.com", email_verified: false });

      render(<EmailSection email="old@example.com" emailVerified onUpdated={jest.fn()} />);
      fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "new@example.com");
      fireEvent.press(screen.getByText("Save Email"));

      expect(await screen.findByText("Not confirmed yet.")).toBeTruthy();
      expect(screen.getByText("Resend confirmation")).toBeTruthy();
    });
  });

  describe("resend", () => {
    test("sends and shows the server's confirmation notice", async () => {
      resendEmailVerification.mockResolvedValue({
        detail: "Confirmation email sent.",
        email_verified: false,
      });

      render(<EmailSection email="a@example.com" emailVerified={false} onUpdated={jest.fn()} />);
      fireEvent.press(screen.getByText("Resend confirmation"));

      await waitFor(() => expect(resendEmailVerification).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("Confirmation email sent.")).toBeTruthy();
      // Still unconfirmed, so the button stays available.
      expect(screen.getByText("Resend confirmation")).toBeTruthy();
    });

    test("an already-confirmed 200 corrects the stale badge instead of erroring", async () => {
      resendEmailVerification.mockResolvedValue({
        detail: "Your email address is already confirmed.",
        email_verified: true,
      });

      render(<EmailSection email="a@example.com" emailVerified={false} onUpdated={jest.fn()} />);
      fireEvent.press(screen.getByText("Resend confirmation"));

      expect(await screen.findByText("Your email address is already confirmed.")).toBeTruthy();
      expect(screen.getByText("Confirmed.")).toBeTruthy();
      expect(screen.queryByText("Resend confirmation")).toBeNull();
    });

    test("the cool-down 429 reads as a notice, not a failure", async () => {
      const msg = "A confirmation email was just sent. Please wait a minute before asking again.";
      resendEmailVerification.mockRejectedValue(apiError(msg, 429));

      render(<EmailSection email="a@example.com" emailVerified={false} onUpdated={jest.fn()} />);
      fireEvent.press(screen.getByText("Resend confirmation"));

      const shown = await screen.findByText(msg);
      // Rendered in the notice colour, not the danger colour: nothing went wrong,
      // a mail is already on its way.
      expect(shown.props.style.color).toBe(colors.gold);
      expect(shown.props.style.color).not.toBe(colors.danger);
      expect(screen.getByText("Not confirmed yet.")).toBeTruthy();
    });

    test("any other refusal is a real error", async () => {
      resendEmailVerification.mockRejectedValue(
        apiError("Your account has no email address.", 400)
      );

      render(<EmailSection email="a@example.com" emailVerified={false} onUpdated={jest.fn()} />);
      fireEvent.press(screen.getByText("Resend confirmation"));

      expect(await screen.findByText("Your account has no email address.")).toBeTruthy();
    });
  });
});
