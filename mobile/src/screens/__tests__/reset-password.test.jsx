import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import ResetPasswordScreen from "../../../app/reset-password/[uid]/[token]";
import { confirmPasswordReset } from "../../api/auth";

/*
 * The in-app landing screen for a password-reset link
 * (app/reset-password/[uid]/[token].jsx).
 *
 * Three refusals matter and they are three different shapes, which is most of
 * what these tests pin down: a mismatch never reaches the network, a rejected
 * password leaves the form standing, and a dead link takes the form away. The
 * last one branches on `err.field`, not on the sentence, so the test supplies the
 * tag the API wrapper attaches.
 *
 * The fourth thing pinned here is the success copy. The server revokes every
 * refresh token on a successful reset, so the user genuinely is signed out
 * everywhere — an outcome that reads as a bug unless the screen says it was
 * meant.
 *
 * Run with:
 *   cd mobile && CI=true npx jest reset-password
 */

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockParams = { uid: "MQ", token: "tok-123" };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock("../../api/auth", () => ({
  confirmPasswordReset: jest.fn(),
}));

// The wrapper tags a 400 with `.field` so the UI can tell "this link is dead"
// (terminal) from "pick a better password" (retryable) without reading wording.
function apiError(message, field) {
  const err = new Error(message);
  err.field = field;
  return err;
}

function fillIn(password, confirm = password) {
  fireEvent.changeText(screen.getByPlaceholderText("New password (min 8 chars)"), password);
  fireEvent.changeText(screen.getByPlaceholderText("Confirm new password"), confirm);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { uid: "MQ", token: "tok-123" };
});

describe("ResetPasswordScreen", () => {
  test("warns up front that setting a new password signs you out everywhere", () => {
    render(<ResetPasswordScreen />);
    expect(screen.getByText(/signs you out everywhere/i)).toBeTruthy();
    expect(screen.getByText("Set new password")).toBeTruthy();
  });

  test("posts the route's uid and token with the typed password", async () => {
    confirmPasswordReset.mockResolvedValue({ detail: "Your password has been reset." });

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    await waitFor(() =>
      expect(confirmPasswordReset).toHaveBeenCalledWith("MQ", "tok-123", "newsecurepass")
    );
  });

  test("a mismatch is caught here and never reaches the network", async () => {
    // The server only ever sees one of the two strings, so it cannot catch this
    // — and a typo in a password you can't see would lock you out of the account
    // you were in the middle of rescuing.
    render(<ResetPasswordScreen />);
    fillIn("newsecurepass", "newsecurepasx");
    fireEvent.press(screen.getByText("Set new password"));

    expect(await screen.findByText("The two passwords don't match.")).toBeTruthy();
    expect(confirmPasswordReset).not.toHaveBeenCalled();
    // Form still up: this is a typo, not a dead end.
    expect(screen.getByText("Set new password")).toBeTruthy();
  });

  test("a weak password shows the server's rule and leaves the form standing", async () => {
    const msg = "This password is too short. It must contain at least 8 characters.";
    confirmPasswordReset.mockRejectedValue(apiError(msg, "new_password"));

    render(<ResetPasswordScreen />);
    fillIn("short");
    fireEvent.press(screen.getByText("Set new password"));

    expect(await screen.findByText(msg)).toBeTruthy();
    // The link is still good, so re-submitting is a real option and the button
    // must still be there.
    expect(screen.getByText("Set new password")).toBeTruthy();
    // Both boxes keep what was typed — retyping a rejected password from
    // scratch is punishment for the server's rule, not the user's mistake.
    expect(screen.getAllByDisplayValue("short")).toHaveLength(2);
  });

  test("a dead link ends the screen instead of leaving a form that cannot succeed", async () => {
    const msg = "This password reset link is invalid or has expired.";
    confirmPasswordReset.mockRejectedValue(apiError(msg, "token"));

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    expect(await screen.findByText(msg)).toBeTruthy();
    expect(screen.queryByText("Set new password")).toBeNull();
    expect(screen.getByText(/nothing has changed on\s+your account/i)).toBeTruthy();

    fireEvent.press(screen.getByText("Request a new link"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/login");
  });

  test("an untagged failure is treated as retryable, not as a dead link", async () => {
    // A transport fault or a 500 carries no `.field`. Wiping the form on those
    // would throw away a perfectly good link.
    confirmPasswordReset.mockRejectedValue(new Error("Network request failed"));

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    expect(await screen.findByText("Network request failed")).toBeTruthy();
    expect(screen.getByText("Set new password")).toBeTruthy();
  });

  test("success explains the revoked sessions rather than letting them look like a bug", async () => {
    confirmPasswordReset.mockResolvedValue({
      detail: "Your password has been reset. You can now log in.",
    });

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    expect(
      await screen.findByText("Your password has been reset. You can now log in.")
    ).toBeTruthy();
    expect(screen.getByText(/signed out/i)).toBeTruthy();
    expect(screen.getByText(/that's deliberate/i)).toBeTruthy();
    // The password box is gone — there is nothing left to type.
    expect(screen.queryByPlaceholderText("New password (min 8 chars)")).toBeNull();
  });

  test("success sends the user to sign in, replacing so Back can't reach a spent link", async () => {
    confirmPasswordReset.mockResolvedValue({ detail: "Your password has been reset." });

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    fireEvent.press(await screen.findByText("Go to sign in"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/login");
  });

  test("falls back to its own success copy when the server sends no detail", async () => {
    confirmPasswordReset.mockResolvedValue({});

    render(<ResetPasswordScreen />);
    fillIn("newsecurepass");
    fireEvent.press(screen.getByText("Set new password"));

    expect(
      await screen.findByText("Your password has been reset. You can now log in.")
    ).toBeTruthy();
  });
});
