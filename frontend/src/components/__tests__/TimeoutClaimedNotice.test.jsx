import React from "react";
import { render, screen } from "@testing-library/react";
import TimeoutClaimedNotice from "../TimeoutClaimedNotice";
import { TIMEOUT_CLAIMED_MESSAGE, isTimeoutClaimedError } from "../../api/errors";

/*
 * The claim-vs-move race, as the player who lost it sees it.
 *
 * Mirrored by mobile/src/components/__tests__/TimeoutClaimedNotice.test.jsx —
 * both clients must tell the same story about the same 400.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=TimeoutClaimedNotice
 */

describe("TimeoutClaimedNotice", () => {
  test("explains what happened, in the copy both clients share", () => {
    render(<TimeoutClaimedNotice />);
    expect(screen.getByTestId("timeout-claimed-notice")).toHaveTextContent(
      TIMEOUT_CLAIMED_MESSAGE
    );
  });

  test("says the game is over and that the two requests crossed", () => {
    render(<TimeoutClaimedNotice />);
    const notice = screen.getByTestId("timeout-claimed-notice");
    expect(notice).toHaveTextContent(/claimed the win on time/i);
    expect(notice).toHaveTextContent(/crossed in transit/i);
    expect(notice).toHaveTextContent(/already over/i);
  });

  test("blames nobody — no 'you were too slow', no error framing", () => {
    render(<TimeoutClaimedNotice />);
    const notice = screen.getByTestId("timeout-claimed-notice");
    expect(notice).toHaveAttribute("role", "status"); // not "alert"
    expect(notice.textContent).not.toMatch(/error|failed|invalid|too slow|your fault/i);
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
