import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import ForgotPasswordPage from "../ForgotPasswordPage";
import { AuthProvider } from "../../context/AuthContext";
import * as authApi from "../../api/authApi";

/*
 * The load-bearing property here is the *absence* of a difference: the backend
 * answers a known and an unknown address with a byte-identical 200 so the
 * endpoint can't be used as a membership oracle, and this screen must not undo
 * that by rendering anything that varies.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=ForgotPassword
 */

jest.mock("../../api/authApi");

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

function renderPage() {
  authApi.fetchMe.mockResolvedValue(null);
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ForgotPasswordPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

/** Submit an address and return the rendered page text afterwards. */
async function submit(email) {
  const { unmount } = renderPage();
  await userEvent.type(screen.getByLabelText(/email address/i), email);
  await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));
  const text = await screen.findByText(/if an account with that email address exists/i);
  const rendered = document.body.textContent;
  unmount();
  return { message: text.textContent, rendered };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ForgotPasswordPage", () => {
  test("posts the typed address to the reset endpoint", async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() =>
      expect(authApi.requestPasswordReset).toHaveBeenCalledWith("alice@example.com")
    );
  });

  test("a hit and a miss render identically — no membership oracle", async () => {
    // The API layer cannot tell these apart either; both resolve with nothing.
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    const hit = await submit("alice@example.com");
    const miss = await submit("nobody@example.com");

    expect(hit.message).toEqual(miss.message);
    expect(hit.rendered).toEqual(miss.rendered);
    expect(hit.message).not.toMatch(/alice/i);
  });

  test("never claims an account was or wasn't found", async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined);
    renderPage();

    await userEvent.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await screen.findByText(/if an account with that email address exists/i);
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we sent you|sent to your/i)).not.toBeInTheDocument();
    // The form is gone, so there is nothing left to compare timings on-screen.
    expect(screen.queryByRole("button", { name: /send reset link/i })).not.toBeInTheDocument();
  });

  test("shows the server's error when the address is malformed", async () => {
    authApi.requestPasswordReset.mockRejectedValue(new Error("Enter a valid email address."));
    renderPage();

    await userEvent.type(screen.getByLabelText(/email address/i), "alice@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    // Still on the form so it can be corrected — and still saying nothing about
    // whether any account exists.
    expect(screen.getByRole("button", { name: /send reset link/i })).toBeInTheDocument();
  });

  test("links back to log in", async () => {
    renderPage();
    expect(screen.getByRole("link", { name: /back to log in/i })).toHaveAttribute("href", "/login");
  });
});
