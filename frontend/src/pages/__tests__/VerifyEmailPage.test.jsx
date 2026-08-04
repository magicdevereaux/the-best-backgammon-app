import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import App from "../../App";
import VerifyEmailPage from "../VerifyEmailPage";
import { AuthProvider } from "../../context/AuthContext";
import * as authApi from "../../api/authApi";

/*
 * The landing page for the confirmation link. Like ResetPasswordPage, its route
 * shape is dictated by the server — the mail links to
 * `{FRONTEND_BASE_URL}/verify-email/{token}` — so the routing test at the bottom
 * guards an integration point, not a preference.
 *
 * The through-line of the rest: verification gates exactly one thing, the
 * reminder mail. So even a dead link must not read as a lockout, and the page
 * has to leave a route to Resend rather than a dead end.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=VerifyEmail
 */

jest.mock("../../api/authApi");

const LINK = "/verify-email/tok-abc";

function renderPage(path = LINK) {
  authApi.fetchMe.mockResolvedValue(null);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("VerifyEmailPage", () => {
  test("posts the token from the URL, unprompted", async () => {
    authApi.confirmEmailVerification.mockResolvedValue({
      detail: "Your email address is confirmed.",
      email: "alice@example.com",
      email_verified: true,
    });
    renderPage();

    await waitFor(() =>
      expect(authApi.confirmEmailVerification).toHaveBeenCalledWith("tok-abc")
    );
  });

  test("shows a pending state while the request is in flight", async () => {
    let resolve;
    authApi.confirmEmailVerification.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    renderPage();

    expect(screen.getByText(/checking your link/i)).toBeInTheDocument();

    resolve({ detail: "Your email address is confirmed.", email_verified: true });
    expect(await screen.findByText("Your email address is confirmed.")).toBeInTheDocument();
  });

  test("renders the server's success wording and says what it unlocked", async () => {
    authApi.confirmEmailVerification.mockResolvedValue({
      detail: "Your email address is confirmed.",
      email: "alice@example.com",
      email_verified: true,
    });
    renderPage();

    expect(await screen.findByText("Your email address is confirmed.")).toBeInTheDocument();
    expect(screen.getByText(/turn reminders can now reach you/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the lobby/i })).toHaveAttribute("href", "/");
  });

  test("a token used twice still reads as success — the server is idempotent", async () => {
    // Mail clients prefetch links and people re-open tabs. A second POST is a
    // 200 as well, so the page must not turn a good confirmation into a scare.
    authApi.confirmEmailVerification.mockResolvedValue({
      detail: "Your email address is confirmed.",
      email: "alice@example.com",
      email_verified: true,
    });
    renderPage();

    expect(await screen.findByText("Your email address is confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /go to your profile/i })).not.toBeInTheDocument();
  });

  test("surfaces a dead or expired link and routes to Resend", async () => {
    authApi.confirmEmailVerification.mockRejectedValue(
      new Error("This verification link is invalid or has expired.")
    );
    renderPage("/verify-email/stale");

    await waitFor(() =>
      expect(authApi.confirmEmailVerification).toHaveBeenCalledWith("stale")
    );
    expect(
      await screen.findByText("This verification link is invalid or has expired.")
    ).toBeInTheDocument();
    // Resend lives on the profile, so a dead link has somewhere to go.
    expect(screen.getByRole("link", { name: /go to your profile/i })).toHaveAttribute(
      "href",
      "/profile"
    );
  });

  test("a failure is never presented as a lockout", async () => {
    authApi.confirmEmailVerification.mockRejectedValue(
      new Error("This verification link is invalid or has expired.")
    );
    renderPage("/verify-email/stale");

    expect(await screen.findByText(/nothing is locked/i)).toBeInTheDocument();
    expect(screen.getByText(/costs you is turn reminders/i)).toBeInTheDocument();
  });
});

describe("the emailed link's route", () => {
  test("App mounts the verify screen at /verify-email/:token", async () => {
    authApi.fetchMe.mockResolvedValue(null);
    authApi.confirmEmailVerification.mockResolvedValue({
      detail: "Your email address is confirmed.",
      email_verified: true,
    });
    // App supplies its own BrowserRouter, so drive it through history.
    window.history.pushState({}, "", LINK);
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /confirm your email/i })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(authApi.confirmEmailVerification).toHaveBeenCalledWith("tok-abc")
    );
  });
});
