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
});

describe("RegisterPage", () => {
  test("registers and navigates home on success", async () => {
    authApi.register.mockResolvedValue({ username: "bob", wins: 0, losses: 0 });
    renderPage(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/username/i), "bob");
    await userEvent.type(screen.getByLabelText(/password/i), "securepass123");
    await userEvent.click(screen.getByRole("button", { name: /register/i }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith("bob", "securepass123"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });

  test("surfaces a duplicate-username error from the server", async () => {
    authApi.register.mockRejectedValue(new Error("Username already taken."));
    renderPage(<RegisterPage />);

    await userEvent.type(screen.getByLabelText(/username/i), "alice");
    await userEvent.type(screen.getByLabelText(/password/i), "securepass123");
    await userEvent.click(screen.getByRole("button", { name: /register/i }));

    expect(await screen.findByText("Username already taken.")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
