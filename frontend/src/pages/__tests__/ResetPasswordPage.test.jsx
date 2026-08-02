import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import App from "../../App";
import ResetPasswordPage from "../ResetPasswordPage";
import { AuthProvider } from "../../context/AuthContext";
import * as authApi from "../../api/authApi";

/*
 * The landing page for the emailed link. Its route shape is fixed by the
 * server — build_password_reset_url mails
 * `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}` — so the routing test here
 * is guarding an integration point, not a preference.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=ResetPassword
 */

jest.mock("../../api/authApi");

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const LINK = "/reset-password/MQ/abc-def";

function renderPage(path = LINK) {
  authApi.fetchMe.mockResolvedValue(null);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function fillAndSubmit(password, confirm = password) {
  await userEvent.type(screen.getByLabelText(/^new password/i), password);
  await userEvent.type(screen.getByLabelText(/confirm new password/i), confirm);
  await userEvent.click(screen.getByRole("button", { name: /set new password/i }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ResetPasswordPage", () => {
  test("posts the uid and token from the URL with the new password", async () => {
    authApi.confirmPasswordReset.mockResolvedValue({ detail: "ok" });
    renderPage();

    await fillAndSubmit("securepass123");

    await waitFor(() =>
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith("MQ", "abc-def", "securepass123")
    );
  });

  test("sends the user to log in on success — every session was just revoked", async () => {
    authApi.confirmPasswordReset.mockResolvedValue({ detail: "ok" });
    renderPage();

    await fillAndSubmit("securepass123");

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login"));
  });

  test("surfaces an AUTH_PASSWORD_VALIDATORS rejection and stays put", async () => {
    authApi.confirmPasswordReset.mockRejectedValue(new Error("This password is too common."));
    renderPage();

    await fillAndSubmit("password123");

    expect(await screen.findByText("This password is too common.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /set new password/i })).toBeInTheDocument();
  });

  test("surfaces a bad or expired link", async () => {
    authApi.confirmPasswordReset.mockRejectedValue(
      new Error("This password reset link is invalid or has expired.")
    );
    renderPage("/reset-password/MQ/tampered");

    await fillAndSubmit("securepass123");

    await waitFor(() =>
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith("MQ", "tampered", "securepass123")
    );
    expect(
      await screen.findByText("This password reset link is invalid or has expired.")
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // A dead link is worth another go from the start.
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password"
    );
  });

  test("rejects a mismatched confirmation without calling the API", async () => {
    renderPage();

    await fillAndSubmit("securepass123", "securepass124");

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument();
    expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
  });
});

describe("the emailed link's route", () => {
  test("App mounts the reset screen at /reset-password/:uid/:token", async () => {
    authApi.fetchMe.mockResolvedValue(null);
    // App supplies its own BrowserRouter, so drive it through history instead of
    // a MemoryRouter.
    window.history.pushState({}, "", LINK);
    render(<App />);

    expect(await screen.findByRole("heading", { name: /choose a new password/i })).toBeInTheDocument();
  });
});
