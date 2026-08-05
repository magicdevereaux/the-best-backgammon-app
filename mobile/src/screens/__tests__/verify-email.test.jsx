import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import VerifyEmailScreen from "../../../app/verify-email/[token]";
import { confirmEmailVerification } from "../../api/auth";

/*
 * The in-app landing screen for an address-confirmation link
 * (app/verify-email/[token].jsx).
 *
 * The screen has no form — it posts on mount — so every test here is about what
 * gets *rendered* for each of the three outcomes, plus the one behaviour that is
 * easy to regress: it must post exactly once.
 *
 * expo-router is stubbed rather than driven. These are route components, but
 * nothing under test depends on real navigation: the params are the only input
 * and `router.replace` is the only output, so a two-function stub is the whole
 * contract. `useLocalSearchParams` (not `useGlobal…`) is what the screen calls,
 * because it wants this route's own token.
 *
 * Run with:
 *   cd mobile && CI=true npx jest verify-email
 */

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockParams = { token: "tok-123" };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock("../../api/auth", () => ({
  confirmEmailVerification: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { token: "tok-123" };
});

describe("VerifyEmailScreen", () => {
  test("posts the token from the route on mount and shows a pending state first", async () => {
    // Never resolves: the render under test is the one before the answer lands.
    confirmEmailVerification.mockReturnValue(new Promise(() => {}));

    render(<VerifyEmailScreen />);

    expect(confirmEmailVerification).toHaveBeenCalledWith("tok-123");
    expect(screen.getByText(/checking your link/i)).toBeTruthy();
  });

  test("posts once, not once per render", async () => {
    // The server is idempotent so a repeat wouldn't corrupt anything — but it
    // would flash the outcome twice, and a remounting screen is the normal case
    // on a deep link.
    confirmEmailVerification.mockResolvedValue({ detail: "Your email address is confirmed." });

    const { rerender } = render(<VerifyEmailScreen />);
    rerender(<VerifyEmailScreen />);
    rerender(<VerifyEmailScreen />);

    await waitFor(() => expect(screen.getByText("Your email address is confirmed.")).toBeTruthy());
    expect(confirmEmailVerification).toHaveBeenCalledTimes(1);
  });

  test("success shows the server's detail and names what verification actually buys", async () => {
    confirmEmailVerification.mockResolvedValue({
      detail: "Your email address is confirmed.",
      email: "a@example.com",
      email_verified: true,
    });

    render(<VerifyEmailScreen />);

    expect(await screen.findByText("Your email address is confirmed.")).toBeTruthy();
    // The single consequence of confirming: reminder mail can reach you, which
    // is the only warning before a forfeit on the 48-hour clock.
    expect(screen.getByText(/turn reminders/i)).toBeTruthy();
    expect(screen.getByText(/48-hour clock/i)).toBeTruthy();
  });

  test("failure shows the server's wording and points at Resend rather than dead-ending", async () => {
    confirmEmailVerification.mockRejectedValue(
      new Error("This verification link is invalid or has expired.")
    );

    render(<VerifyEmailScreen />);

    expect(
      await screen.findByText("This verification link is invalid or has expired.")
    ).toBeTruthy();
    // Nothing is gated on verification, and the copy has to say so — otherwise a
    // dead link reads as a locked account.
    expect(screen.getByText(/nothing is locked/i)).toBeTruthy();
    expect(screen.getByText(/resend confirmation/i)).toBeTruthy();
    expect(screen.queryByText(/checking your link/i)).toBeNull();
  });

  test("both outcomes route to the profile, where Resend lives", async () => {
    confirmEmailVerification.mockRejectedValue(new Error("This verification link is invalid or has expired."));

    render(<VerifyEmailScreen />);
    fireEvent.press(await screen.findByText("Go to your profile"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/profile");
  });

  test("offers a way back to the lobby in every state", () => {
    confirmEmailVerification.mockReturnValue(new Promise(() => {}));

    render(<VerifyEmailScreen />);
    fireEvent.press(screen.getByText("Back to the lobby"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/");
  });

  test("a missing token is still posted — the server owns the verdict", async () => {
    // A truncated link produces an undefined param. The wrapper normalises it to
    // "" and the server's "invalid or has expired" is the answer shown, rather
    // than a client-side guess that could drift from the real rule.
    mockParams = {};
    confirmEmailVerification.mockRejectedValue(
      new Error("This verification link is invalid or has expired.")
    );

    render(<VerifyEmailScreen />);

    expect(confirmEmailVerification).toHaveBeenCalledWith(undefined);
    expect(
      await screen.findByText("This verification link is invalid or has expired.")
    ).toBeTruthy();
  });
});
