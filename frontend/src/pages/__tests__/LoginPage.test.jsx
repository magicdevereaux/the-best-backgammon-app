import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import LoginPage from "../LoginPage";
import RegisterPage from "../RegisterPage";
import { AuthProvider } from "../../context/AuthContext";
import * as authApi from "../../api/authApi";

/*
 * Component tests for the login/register screens. We mock the authApi module
 * so no network happens, and render inside a router + AuthProvider so the
 * page's useAuth()/useNavigate() calls resolve.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=LoginPage
 */

jest.mock("../../api/authApi");

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

function renderPage(ui) {
  // fetchMe is called by AuthProvider on mount; keep it a no-op resolving null.
  authApi.fetchMe.mockResolvedValue(null);
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("LoginPage", () => {
  test("submits typed credentials and navigates home on success", async () => {
    authApi.login.mockResolvedValue({ username: "alice", wins: 2, losses: 1 });
    renderPage(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.type(screen.getByLabelText(/password/i), "securepass123");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(authApi.login).toHaveBeenCalledWith("alice", "securepass123"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });

  test("shows the error message and does not navigate on failure", async () => {
    authApi.login.mockRejectedValue(new Error("Invalid username or password."));
    renderPage(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("offers a route into the password reset flow", async () => {
    renderPage(<LoginPage />);
    const link = screen.getByRole("link", { name: /forgot your password/i });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });
});

/*
 * Registration, post-ADR-003: the email field is required. It used to be
 * optional, and the tests below used to prove a blank one still registered —
 * that is now the opposite of the contract, since an account with no address
 * can neither recover its password nor be warned before the 48-hour turn clock
 * forfeits a game.
 */
describe("RegisterPage", () => {
  async function fillAndSubmit({
    username = "bob",
    password = "securepass123",
    email = "bob@example.com",
  } = {}) {
    await userEvent.type(screen.getByLabelText(/username/i), username);
    await userEvent.type(screen.getByLabelText(/^password/i), password);
    if (email) await userEvent.type(screen.getByLabelText(/email/i), email);
    await userEvent.click(screen.getByRole("button", { name: /register/i }));
  }

  test("the email field is required", async () => {
    renderPage(<RegisterPage />);
    expect(screen.getByLabelText(/email/i)).toBeRequired();
    // The old label advertised the field as optional; it must not any more.
    expect(screen.queryByLabelText(/optional/i)).not.toBeInTheDocument();
  });

  test("explains what the address is for — recovery and the turn clock", async () => {
    renderPage(<RegisterPage />);
    expect(screen.getByText(/reset a forgotten password/i)).toBeInTheDocument();
    expect(screen.getByText(/running out of time/i)).toBeInTheDocument();
  });

  test("passes the address through and navigates home on success", async () => {
    authApi.register.mockResolvedValue({ username: "bob", wins: 0, losses: 0 });
    renderPage(<RegisterPage />);

    await fillAndSubmit();

    await waitFor(() =>
      expect(authApi.register).toHaveBeenCalledWith("bob", "securepass123", "bob@example.com")
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });

  test("surfaces the server's missing-email error", async () => {
    // The browser's own `required` catches this first in a real browser, but
    // the server is authoritative and its wording has to land somewhere.
    authApi.register.mockRejectedValue(new Error("This field is required."));
    renderPage(<RegisterPage />);

    await fillAndSubmit({ email: "" });

    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("surfaces the server's email validation error", async () => {
    authApi.register.mockRejectedValue(new Error("Enter a valid email address."));
    renderPage(<RegisterPage />);

    await fillAndSubmit();

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("surfaces a duplicate-username error from the server", async () => {
    authApi.register.mockRejectedValue(new Error("Username already taken."));
    renderPage(<RegisterPage />);

    await fillAndSubmit({ username: "alice" });

    expect(await screen.findByText("Username already taken.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
