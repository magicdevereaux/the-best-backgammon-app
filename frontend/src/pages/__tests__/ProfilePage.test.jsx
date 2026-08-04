import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ProfilePage from "../ProfilePage";
import { AuthProvider } from "../../context/AuthContext";
import * as authApi from "../../api/authApi";

/*
 * Covers the profile page's danger zone: the in-app account deletion path the
 * app stores require. The real DeleteAccountPanel is rendered (only the API
 * module is mocked) so the three-stage flow is exercised end to end.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=ProfilePage
 */

jest.mock("../../api/authApi");

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const STATS = {
  username: "alice",
  total_games: 3, wins: 2, losses: 1, win_percentage: 66.7,
  total_gammons: 1, total_backgammons: 0, gammon_rate: 50.0,
  total_points_won: 4, total_points_lost: 1,
};

async function renderProfile(overrides = {}) {
  authApi.fetchMe.mockResolvedValue({ ...STATS, ...overrides });
  render(
    <MemoryRouter>
      <AuthProvider>
        <ProfilePage />
      </AuthProvider>
    </MemoryRouter>
  );
  // AuthProvider resolves fetchMe -> user, then the page loads its stats.
  await screen.findByRole("heading", { name: "alice" });
}

/** Walk the panel from closed -> password typed -> final confirmation. */
async function openConfirmation(password = "securepass123") {
  await userEvent.click(screen.getByRole("button", { name: /delete my account/i }));
  await userEvent.type(screen.getByLabelText(/current password/i), password);
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProfilePage", () => {
  test("renders lifetime stats", async () => {
    await renderProfile();
    expect(screen.getByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText("Danger zone")).toBeInTheDocument();
  });
});

/*
 * The email panel. Email is required at registration as of ADR-003, so this is
 * where a typo gets fixed, a mailbox gets moved, or an address that never got
 * confirmed gets a fresh link. It is *not* where an address gets removed — the
 * server rejects a blank one — and confirmation gates exactly one thing, the
 * turn-reminder mail, so the unverified state has to read as a consequence
 * rather than a wall.
 */
describe("ProfilePage email settings", () => {
  const resendButton = () =>
    screen.getByRole("button", { name: /resend confirmation email/i });

  test("shows the account's current address", async () => {
    await renderProfile({ email: "alice@example.com" });
    expect(screen.getByLabelText(/email address/i)).toHaveValue("alice@example.com");
  });

  test("starts empty for a legacy account that never set one", async () => {
    await renderProfile(); // STATS has no email key at all
    expect(screen.getByLabelText(/email address/i)).toHaveValue("");
  });

  test("offers no way to clear the address — the field is required", async () => {
    await renderProfile({ email: "alice@example.com" });
    expect(screen.getByLabelText(/email address/i)).toBeRequired();
    expect(screen.getByText(/changed but not removed/i)).toBeInTheDocument();
  });

  test("PATCHes a newly typed address and confirms it saved", async () => {
    authApi.updateEmail.mockResolvedValue({ ...STATS, email: "alice@example.com" });
    await renderProfile();

    await userEvent.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save email/i }));

    await waitFor(() =>
      expect(authApi.updateEmail).toHaveBeenCalledWith("alice@example.com")
    );
    expect(await screen.findByText(/email address saved/i)).toBeInTheDocument();
  });

  test("surfaces the server's rejection of a blank address", async () => {
    authApi.updateEmail.mockRejectedValue(new Error("This field may not be blank."));
    await renderProfile({ email: "alice@example.com" });

    await userEvent.clear(screen.getByLabelText(/email address/i));
    await userEvent.click(screen.getByRole("button", { name: /save email/i }));

    expect(await screen.findByText("This field may not be blank.")).toBeInTheDocument();
    expect(screen.queryByText(/email address saved/i)).not.toBeInTheDocument();
  });

  test("surfaces the server's validation error and keeps what was typed", async () => {
    authApi.updateEmail.mockRejectedValue(new Error("Enter a valid email address."));
    await renderProfile();

    await userEvent.type(screen.getByLabelText(/email address/i), "not-an-address");
    await userEvent.click(screen.getByRole("button", { name: /save email/i }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue("not-an-address");
    expect(screen.queryByText(/email address saved/i)).not.toBeInTheDocument();
  });

  test("says so when the address is confirmed, and offers no resend", async () => {
    await renderProfile({ email: "alice@example.com", email_verified: true });
    expect(screen.getByText(/this address is confirmed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resend confirmation email/i })
    ).not.toBeInTheDocument();
  });

  test("names the one consequence when it is not confirmed", async () => {
    await renderProfile({ email: "alice@example.com", email_verified: false });
    expect(screen.getByText(/isn't confirmed yet/i)).toBeInTheDocument();
    // The cost is stated, and it is only the reminder mail.
    expect(screen.getByText(/won't send\s+to an unconfirmed address/i)).toBeInTheDocument();
    expect(resendButton()).toBeEnabled();
  });

  test("shows neither state when there is no address on file at all", async () => {
    await renderProfile(); // STATS has no email key
    expect(screen.queryByText(/isn't confirmed yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this address is confirmed/i)).not.toBeInTheDocument();
  });

  test("resend reports the server's confirmation as an ordinary message", async () => {
    authApi.resendEmailVerification.mockResolvedValue({
      detail: "Confirmation email sent.",
      email_verified: false,
      throttled: false,
    });
    await renderProfile({ email: "alice@example.com", email_verified: false });

    await userEvent.click(resendButton());

    await waitFor(() => expect(authApi.resendEmailVerification).toHaveBeenCalled());
    expect(await screen.findByText("Confirmation email sent.")).toBeInTheDocument();
    // Still unverified: sending is not confirming.
    expect(resendButton()).toBeInTheDocument();
  });

  test("renders the 60-second cool-down as a message, not an error", async () => {
    authApi.resendEmailVerification.mockResolvedValue({
      detail: "A confirmation email was just sent. Try again in a minute.",
      throttled: true,
    });
    await renderProfile({ email: "alice@example.com", email_verified: false });

    await userEvent.click(resendButton());

    expect(await screen.findByText(/just sent/i)).toBeInTheDocument();
    // A throttle says nothing about verification, so nothing may move.
    expect(screen.getByText(/isn't confirmed yet/i)).toBeInTheDocument();
  });

  test("believes the server when a resend comes back already confirmed", async () => {
    // The link was clicked in another tab while this page sat open.
    authApi.resendEmailVerification.mockResolvedValue({
      detail: "Your email address is already confirmed.",
      email_verified: true,
      throttled: false,
    });
    await renderProfile({ email: "alice@example.com", email_verified: false });

    await userEvent.click(resendButton());

    expect(await screen.findByText(/already confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/this address is confirmed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /resend confirmation email/i })
    ).not.toBeInTheDocument();
  });

  test("surfaces a genuine resend failure as an error", async () => {
    authApi.resendEmailVerification.mockRejectedValue(
      new Error("Could not send a confirmation email.")
    );
    await renderProfile({ email: "alice@example.com", email_verified: false });

    await userEvent.click(resendButton());

    expect(
      await screen.findByText("Could not send a confirmation email.")
    ).toBeInTheDocument();
    expect(resendButton()).toBeEnabled();
  });

  test("a saved address change drops back to unconfirmed on the server's word", async () => {
    authApi.updateEmail.mockResolvedValue({
      ...STATS, email: "new@example.com", email_verified: false,
    });
    await renderProfile({ email: "alice@example.com", email_verified: true });
    expect(screen.getByText(/this address is confirmed/i)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/email address/i));
    await userEvent.type(screen.getByLabelText(/email address/i), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: /save email/i }));

    expect(await screen.findByText(/isn't confirmed yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/this address is confirmed/i)).not.toBeInTheDocument();
  });
});

/*
 * The turn-reminder opt-out. Addresses are collected for password reset, so the
 * only thing that makes game mail legitimate is a switch the recipient can
 * actually reach — which means this control has to work, explain the cost of
 * switching it off, and never claim a state the server didn't confirm.
 * Behaviour parity with mobile/src/components/__tests__/TurnReminderSection.test.jsx.
 */
describe("ProfilePage turn reminders", () => {
  const reminderBox = () =>
    screen.getByRole("checkbox", { name: /turn reminder emails/i });

  test("renders the saved preference when it is on", async () => {
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: true });
    expect(reminderBox()).toBeChecked();
    expect(screen.getByText(/forfeited without ever hearing about it/i)).toBeInTheDocument();
  });

  test("renders the saved preference when it is off", async () => {
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: false });
    expect(reminderBox()).not.toBeChecked();
  });

  test("switching it off PATCHes false and reflects the response", async () => {
    authApi.updateTurnReminders.mockResolvedValue({
      ...STATS, email: "alice@example.com", email_verified: true, turn_reminder_emails: false,
    });
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: true });

    await userEvent.click(reminderBox());

    await waitFor(() =>
      expect(authApi.updateTurnReminders).toHaveBeenCalledWith(false)
    );
    expect(await screen.findByText(/turn reminder emails are off/i)).toBeInTheDocument();
    expect(reminderBox()).not.toBeChecked();
  });

  test("switching it back on PATCHes true", async () => {
    authApi.updateTurnReminders.mockResolvedValue({
      ...STATS, email: "alice@example.com", email_verified: true, turn_reminder_emails: true,
    });
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: false });

    await userEvent.click(reminderBox());

    await waitFor(() =>
      expect(authApi.updateTurnReminders).toHaveBeenCalledWith(true)
    );
    expect(await screen.findByText(/turn reminder emails are on/i)).toBeInTheDocument();
    expect(reminderBox()).toBeChecked();
  });

  test("shows the server's answer, not the click", async () => {
    // The server is authoritative: if it comes back still enabled, the box has
    // to say enabled rather than the state the user asked for.
    authApi.updateTurnReminders.mockResolvedValue({
      ...STATS, email: "alice@example.com", email_verified: true, turn_reminder_emails: true,
    });
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: true });

    await userEvent.click(reminderBox());

    await waitFor(() => expect(authApi.updateTurnReminders).toHaveBeenCalled());
    expect(reminderBox()).toBeChecked();
  });

  test("surfaces a save error and leaves the setting where it was", async () => {
    authApi.updateTurnReminders.mockRejectedValue(new Error("Could not save your reminder setting."));
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: true });

    await userEvent.click(reminderBox());

    expect(await screen.findByText("Could not save your reminder setting.")).toBeInTheDocument();
    expect(reminderBox()).toBeChecked();
    expect(screen.queryByText(/turn reminder emails are off/i)).not.toBeInTheDocument();
  });

  test("explains that an address is needed when none is on file", async () => {
    await renderProfile({ turn_reminder_emails: true }); // STATS has no email key
    expect(screen.getByText(/no email address is saved on your account/i)).toBeInTheDocument();
    expect(reminderBox()).toBeDisabled();
  });

  test("drops the no-address explanation once an address is confirmed", async () => {
    await renderProfile({ email: "alice@example.com", email_verified: true, turn_reminder_emails: true });
    expect(screen.queryByText(/no email address is saved on your account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reminders are paused/i)).not.toBeInTheDocument();
    expect(reminderBox()).toBeEnabled();
  });

  /*
   * The two blockers are separate states and must read as separate states. An
   * unverified address is the trap: it *looks* like a working one on this
   * screen, so telling the user "no address is saved" would be plainly false,
   * and leaving the box live would tell them reminders are on when the server
   * will not send a single one. Mirrors the same pair of cases in
   * mobile/src/components/__tests__/TurnReminderSection.test.jsx.
   */
  test("explains that an unconfirmed address blocks reminders, and disables the box", async () => {
    await renderProfile({
      email: "alice@example.com", email_verified: false, turn_reminder_emails: true,
    });
    expect(screen.getByText(/reminders are paused/i)).toBeInTheDocument();
    // Not the *other* blocker's copy: there is an address, it just isn't proven.
    expect(screen.queryByText(/no email address is saved on your account/i)).not.toBeInTheDocument();
    expect(reminderBox()).toBeDisabled();
  });

  test("an unconfirmed address is unsendable even with the preference on", async () => {
    // `turn_reminder_emails` is the stored preference and it stays true — the
    // point is that a true preference is not a promise of mail. The server
    // checks both, so the UI must not let this read as "reminders are on".
    await renderProfile({
      email: "alice@example.com", email_verified: false, turn_reminder_emails: true,
    });
    expect(reminderBox()).toBeChecked();
    expect(reminderBox()).toBeDisabled();
  });
});

describe("ProfilePage danger zone", () => {
  test("does not show the password field until deletion is requested", async () => {
    await renderProfile();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /delete my account/i }));
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  test("requires a second confirmation before calling the API", async () => {
    await renderProfile();
    await openConfirmation();

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(authApi.deleteAccount).not.toHaveBeenCalled();
  });

  test("deletes, logs out and redirects home on success", async () => {
    authApi.deleteAccount.mockResolvedValue(true);
    await renderProfile();
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: /yes, delete my account/i }));

    await waitFor(() =>
      expect(authApi.deleteAccount).toHaveBeenCalledWith("securepass123")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(authApi.logout).toHaveBeenCalled();
  });

  test("surfaces the server's wrong-password error and stays logged in", async () => {
    authApi.deleteAccount.mockRejectedValue(new Error("Password is incorrect."));
    await renderProfile();
    await openConfirmation("wrongpass");

    await userEvent.click(screen.getByRole("button", { name: /yes, delete my account/i }));

    expect(await screen.findByText("Password is incorrect.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // Back on the password step, cleared, ready for another attempt.
    expect(screen.getByLabelText(/current password/i)).toHaveValue("");
  });

  test("cancelling closes the panel without calling the API", async () => {
    await renderProfile();
    await openConfirmation();

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(authApi.deleteAccount).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });
});
