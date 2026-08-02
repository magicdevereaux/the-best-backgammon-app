import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import EmailSection from "../EmailSection";
import { updateEmail } from "../../api/auth";

/*
 * Setting, changing and clearing the account email — the only route to password
 * recovery for an account registered without one.
 *
 * Run with:
 *   cd mobile && CI=true npx jest EmailSection
 */

jest.mock("../../api/auth", () => ({ updateEmail: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("EmailSection", () => {
  test("prefills the current address and disables Save until it changes", () => {
    render(<EmailSection email="a@example.com" onUpdated={jest.fn()} />);

    expect(screen.getByDisplayValue("a@example.com")).toBeTruthy();

    fireEvent.press(screen.getByText("Save Email"));
    expect(updateEmail).not.toHaveBeenCalled();
  });

  test("explains the consequence when no address is set", () => {
    render(<EmailSection email="" onUpdated={jest.fn()} />);
    expect(screen.getByText(/reset your password/i)).toBeTruthy();
  });

  test("saves a new address and reports the fresh user upward", async () => {
    const updated = { id: 1, username: "alice", email: "new@example.com" };
    updateEmail.mockResolvedValue(updated);
    const onUpdated = jest.fn();

    render(<EmailSection email="" onUpdated={onUpdated} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "new@example.com");
    fireEvent.press(screen.getByText("Save Email"));

    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith("new@example.com"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(await screen.findByText("Email address saved.")).toBeTruthy();
  });

  test("clearing the field offers Remove and PATCHes an empty string", async () => {
    updateEmail.mockResolvedValue({ id: 1, username: "alice", email: "" });

    render(<EmailSection email="a@example.com" onUpdated={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "");

    const btn = screen.getByText("Remove Email");
    fireEvent.press(btn);

    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith(""));
    expect(await screen.findByText("Email address removed.")).toBeTruthy();
  });

  test("shows the server's validation error and keeps what was typed", async () => {
    updateEmail.mockRejectedValue(new Error("Enter a valid email address."));
    const onUpdated = jest.fn();

    render(<EmailSection email="" onUpdated={onUpdated} />);
    fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "nope");
    fireEvent.press(screen.getByText("Save Email"));

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("nope")).toBeTruthy();
  });
});
