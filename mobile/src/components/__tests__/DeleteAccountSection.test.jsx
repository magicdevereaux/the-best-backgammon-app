import React from "react";
import { Alert } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import DeleteAccountSection from "../DeleteAccountSection";
import { deleteAccount } from "../../api/auth";

/*
 * Covers the mobile danger zone: the in-app account deletion path the app
 * stores require. The API module is mocked; Alert.alert is spied on so the
 * platform confirmation dialog can be inspected and its destructive button
 * invoked without a native runtime.
 *
 * Run with:
 *   cd mobile && CI=true npx jest DeleteAccountSection
 */

jest.mock("../../api/auth", () => ({ deleteAccount: jest.fn() }));

/** Invoke the Alert button matching `label` on the next Alert.alert call. */
function autoPressAlertButton(label) {
  return jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => {
    const button = buttons.find((b) => b.text === label);
    if (button && button.onPress) button.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Open the panel and type a password. */
function openAndType(password = "securepass123") {
  fireEvent.press(screen.getByText("Delete Account"));
  fireEvent.changeText(screen.getByPlaceholderText("Current password"), password);
}

describe("DeleteAccountSection", () => {
  test("hides the password field until deletion is requested", () => {
    render(<DeleteAccountSection onDeleted={jest.fn()} />);

    expect(screen.getByText("Danger zone")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Current password")).toBeNull();

    fireEvent.press(screen.getByText("Delete Account"));
    expect(screen.getByPlaceholderText("Current password")).toBeTruthy();
  });

  test("uses the platform confirmation dialog with a destructive button", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<DeleteAccountSection onDeleted={jest.fn()} />);
    openAndType();

    fireEvent.press(screen.getByText("Permanently Delete My Account"));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Delete account?");
    expect(buttons.map((b) => b.style)).toEqual(["cancel", "destructive"]);
    // Nothing happens until the dialog is answered.
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test("cancelling the dialog does not call the API", () => {
    autoPressAlertButton("Cancel");
    render(<DeleteAccountSection onDeleted={jest.fn()} />);
    openAndType();

    fireEvent.press(screen.getByText("Permanently Delete My Account"));
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test("confirming deletes with the typed password and reports success", async () => {
    autoPressAlertButton("Delete");
    deleteAccount.mockResolvedValue(true);
    const onDeleted = jest.fn();

    render(<DeleteAccountSection onDeleted={onDeleted} />);
    openAndType("securepass123");
    fireEvent.press(screen.getByText("Permanently Delete My Account"));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith("securepass123"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  test("shows the server's error and stays put on a wrong password", async () => {
    autoPressAlertButton("Delete");
    deleteAccount.mockRejectedValue(new Error("Password is incorrect."));
    const onDeleted = jest.fn();

    render(<DeleteAccountSection onDeleted={onDeleted} />);
    openAndType("wrongpass");
    fireEvent.press(screen.getByText("Permanently Delete My Account"));

    expect(await screen.findByText("Password is incorrect.")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Current password").props.value).toBe("");
  });

  test("cancelling the panel collapses it back", () => {
    render(<DeleteAccountSection onDeleted={jest.fn()} />);
    openAndType();

    fireEvent.press(screen.getByText("Cancel"));

    expect(screen.queryByPlaceholderText("Current password")).toBeNull();
    expect(screen.getByText("Delete Account")).toBeTruthy();
  });
});
