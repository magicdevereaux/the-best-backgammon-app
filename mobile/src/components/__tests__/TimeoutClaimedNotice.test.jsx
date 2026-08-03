import React from "react";
import { render, screen } from "@testing-library/react-native";
import TimeoutClaimedNotice from "../TimeoutClaimedNotice";
import { TIMEOUT_CLAIMED_MESSAGE, isTimeoutClaimedError } from "../../api/errors";

/*
 * The claim-vs-move race, as the player who lost it sees it.
 *
 * Mirrored by frontend/src/components/__tests__/TimeoutClaimedNotice.test.jsx —
 * both clients must tell the same story about the same 400.
 *
 * Run with:
 *   cd mobile && CI=true npx jest TimeoutClaimedNotice
 */

describe("TimeoutClaimedNotice", () => {
  test("explains what happened, in the copy both clients share", () => {
    render(<TimeoutClaimedNotice />);
    expect(screen.getByText(TIMEOUT_CLAIMED_MESSAGE)).toBeTruthy();
  });

  test("says the game is over and that the two requests crossed", () => {
    render(<TimeoutClaimedNotice />);
    expect(screen.getByText(/claimed the win on time/i)).toBeTruthy();
    expect(screen.getByText(/crossed in transit/i)).toBeTruthy();
    expect(screen.getByText(/already over/i)).toBeTruthy();
  });

  test("blames nobody — no 'you were too slow', no error framing", () => {
    render(<TimeoutClaimedNotice />);
    expect(screen.getByTestId("timeout-claimed-notice")).toBeTruthy();
    expect(TIMEOUT_CLAIMED_MESSAGE).not.toMatch(/error|failed|invalid|too slow|your fault/i);
  });
});

describe("isTimeoutClaimedError", () => {
  test("recognises the server's refusal however it is worded", () => {
    for (const message of [
      "Your opponent claimed a timeout win before this move arrived.",
      "This game was already claimed on time.",
      "The opponent claimed the win — the turn deadline had passed.",
      "Forfeit already claimed; the clock had run out.",
    ]) {
      expect(isTimeoutClaimedError(new Error(message))).toBe(true);
    }
  });

  test("leaves every ordinary refusal alone", () => {
    for (const message of [
      "Game is not active.",
      "Illegal move.",
      "It is not your turn.",
      "You must use as many dice as possible.",
      "A double has already been offered.",
      "API error: 500",
      "Network request failed",
    ]) {
      expect(isTimeoutClaimedError(new Error(message))).toBe(false);
    }
  });

  test("survives a missing or malformed error object", () => {
    expect(isTimeoutClaimedError(null)).toBe(false);
    expect(isTimeoutClaimedError(undefined)).toBe(false);
    expect(isTimeoutClaimedError({})).toBe(false);
  });
});
