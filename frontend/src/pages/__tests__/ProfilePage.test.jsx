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

async function renderProfile() {
  authApi.fetchMe.mockResolvedValue(STATS);
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
