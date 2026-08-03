import React from "react";
import { TIMEOUT_CLAIMED_MESSAGE } from "../api/errors";

/*
 * What a player sees when their move lost the race to the opponent's inactivity
 * claim (see api/errors.isTimeoutClaimedError).
 *
 * Deliberately NOT styled as an error. The move was legal and, by this device's
 * clock, in time; the only thing that happened is that two requests crossed. So
 * this is an explanation, in the ordinary secondary text colour, and it stays
 * true once the game flips to finished a moment later — which is why useGame
 * re-fetches immediately rather than letting the poll catch up under a message
 * that would otherwise read as stale.
 *
 * Mirrored by mobile/src/components/TimeoutClaimedNotice.jsx; the copy itself
 * lives in api/errors.js so the two clients cannot drift.
 */
export default function TimeoutClaimedNotice() {
  return (
    <p
      role="status"
      data-testid="timeout-claimed-notice"
      style={{
        margin: "0.5rem 0",
        fontSize: "0.85rem",
        color: "var(--text-secondary)",
      }}
    >
      {TIMEOUT_CLAIMED_MESSAGE}
    </p>
  );
}
