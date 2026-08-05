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

/*
 * The user-agent is mocked rather than inherited — jsdom's ambient one is
 * neither a phone nor a browser anybody uses. An own property shadows the
 * Navigator prototype getter; `delete` restores it.
 */
function setUserAgent(ua) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0";

afterEach(() => {
  delete window.navigator.userAgent;
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

describe("the hand-off into the app", () => {
  test("offers the app link on a phone, carrying uid and token", async () => {
    setUserAgent(IPHONE_UA);
    renderPage();

    expect(screen.getByRole("link", { name: /open in the app/i })).toHaveAttribute(
      "href",
      "backgammon://reset-password/MQ/abc-def"
    );
  });

  test("does not offer it on a desktop browser, where the scheme dies silently", async () => {
    setUserAgent(DESKTOP_UA);
    renderPage();

    expect(screen.getByRole("button", { name: /set new password/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open in the app/i })).not.toBeInTheDocument();
  });

  test("the hand-off is offered before submission, not after", async () => {
    // The one real correctness trap on this page. The uid+token pair is
    // single-use — Django hashes the current password into the token — so the
    // link is live only until the reset lands. Handing a spent credential to
    // the app would fail there and look like the app's fault.
    setUserAgent(IPHONE_UA);
    authApi.confirmPasswordReset.mockResolvedValue({ detail: "ok" });
    renderPage();

    expect(screen.getByRole("link", { name: /open in the app/i })).toBeInTheDocument();

    await fillAndSubmit("securepass123");

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("link", { name: /open in the app/i })).not.toBeInTheDocument();
  });

  test("a failed attempt keeps the link — that token is still good", async () => {
    // A validator rejection doesn't change the password, so the credential in
    // the address bar still verifies and the app can still take over.
    setUserAgent(IPHONE_UA);
    authApi.confirmPasswordReset.mockRejectedValue(new Error("This password is too common."));
    renderPage();

    await fillAndSubmit("password123");

    expect(await screen.findByText("This password is too common.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in the app/i })).toBeInTheDocument();
  });

  test("the browser flow still completes with the link on screen", async () => {
    setUserAgent(IPHONE_UA);
    authApi.confirmPasswordReset.mockResolvedValue({ detail: "ok" });
    renderPage();

    await fillAndSubmit("securepass123");

    await waitFor(() =>
      expect(authApi.confirmPasswordReset).toHaveBeenCalledWith("MQ", "abc-def", "securepass123")
    );
    expect(mockNavigate).toHaveBeenCalledWith("/login");
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
