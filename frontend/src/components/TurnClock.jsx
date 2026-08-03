import React, { useEffect, useState } from "react";
import ClaimTimeoutPanel from "./ClaimTimeoutPanel";
import { canClaimTimeout } from "../utils/seats";

/*
 * The inactivity clock, shown in both directions.
 *
 * The forfeit itself is pull-based — nothing sweeps in the background, the
 * opponent claims it (docs/decisions/adr-002-inactivity-forfeit.md). That makes
 * the *display* the humane half of the feature: a player must never lose to a
 * clock they were never shown, so the seat on the clock gets the same countdown
 * as the seat waiting on it, plus the consequence spelled out.
 *
 * The countdown is extrapolated locally from `turn_deadline` on a 1s interval —
 * it does not ride the ~3.5s poll, which would make it stutter and lag. Polling
 * only reconciles: when the idle player finally moves, the fresh payload carries
 * a new deadline (or none) and this re-derives from that.
 *
 * It ticks against the *server's* clock, not this browser's: `clockOffset`
 * (useGame, from the `server_now` on every payload) is added to `Date.now()`
 * before any comparison. A browser hours fast would otherwise show the claim
 * control early and then eat a 400 on every press, and one hours slow would
 * promise a player time they did not have. If the two clocks still disagree
 * grossly, say so — see SKEW_NOTICE_MS.
 *
 * Everything here hangs off `turn_deadline` being non-null. The server nulls it
 * whenever a claim is impossible in principle — game not active, a closed seat,
 * a guest seat, no clock recorded — so a null deadline means render nothing, and
 * no eligibility rule is re-derived on this side.
 */

const TICK_MS = 1000;

// Under this much time left, the warning to the player on the clock goes loud.
// Shared with mobile/src/components/TurnClockSection.jsx — keep the two equal so
// a player gets the same warning whichever client they opened. A flat threshold
// rather than a fraction of the deadline, because the client is never told how
// long the deadline was to begin with; and an hour rather than minutes, because
// the deadline ships at a 48-hour default.
const URGENT_MS = 60 * 60 * 1000; // 1 hour

// Past this much disagreement between this browser's clock and the server's,
// tell the player. The countdown is already corrected, so nothing is *wrong* —
// but the numbers here will not match their own clock or their calendar, and an
// unexplained mismatch reads as a bug. Below five minutes it isn't worth a line
// of text. Shared with mobile/src/components/TurnClockSection.jsx.
const SKEW_NOTICE_MS = 5 * 60 * 1000;

const S = {
  info:   { margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--text-secondary)" },
  warn:   { margin: "0.5rem 0", fontSize: "0.85rem", fontWeight: 600, color: "var(--gold)" },
  urgent: { margin: "0.5rem 0", fontSize: "0.95rem", fontWeight: 700, color: "var(--error)" },
  skew:   { margin: "0.25rem 0 0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" },
};

// Coarse at the top, precise at the bottom: nobody needs seconds two days out,
// and everybody needs them in the last minute.
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export default function TurnClock({ game, clockOffset = 0, onClaimTimeout }) {
  const deadline = game?.turn_deadline ?? null;
  const [deviceNow, setDeviceNow] = useState(() => Date.now());

  // One interval, restarted whenever the server hands down a new deadline (and
  // never started at all when there is none). Cleared on unmount. It samples
  // the raw device clock; the correction is applied below, so a fresh offset
  // takes effect on the next render without disturbing the tick.
  useEffect(() => {
    if (!deadline) return undefined;
    setDeviceNow(Date.now());
    const id = setInterval(() => setDeviceNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;

  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;

  // Everything below reads "now" as the server sees it. A garbage offset would
  // be worse than none, so anything non-finite falls back to the device clock.
  const offset = Number.isFinite(clockOffset) ? clockOffset : 0;
  const now = deviceNow + offset;

  const waiting = game.turn_waiting_seat;
  if (waiting !== "p1" && waiting !== "p2") return null;

  // Whose seat is this browser? The server's own answer. A bystander (no seat)
  // has nothing to be warned about and nothing to claim, so they see no clock.
  const viewerSeat = game.viewer_seat ?? null;
  if (viewerSeat !== "p1" && viewerSeat !== "p2") return null;

  const waitingName = waiting === "p1" ? game.player1_name : game.player2_name;
  const otherName = waiting === "p1" ? game.player2_name : game.player1_name;
  const remaining = at - now;

  // Only when the two clocks are grossly apart. Says which way, so a player can
  // recognise their own device as the odd one out, and says that the number
  // above is the one that counts.
  const skew =
    Math.abs(offset) >= SKEW_NOTICE_MS ? (
      <p style={S.skew} data-testid="clock-skew-notice">
        Heads up: this device's clock is {formatRemaining(Math.abs(offset))}{" "}
        {offset < 0 ? "ahead of" : "behind"} the server's. The time above follows
        the server, which is what decides the game.
      </p>
    ) : null;

  if (viewerSeat === waiting) {
    // You are the one on the clock. Say so, say what happens, and get loud as it
    // closes in. `data-urgent` carries that state somewhere assertable — the
    // inline CSS variables these styles use don't survive jsdom.
    const urgent = remaining <= URGENT_MS;
    return (
      <>
        {remaining > 0 ? (
          <p style={urgent ? S.urgent : S.warn} data-urgent={String(urgent)}>
            You're on the clock — {formatRemaining(remaining)} left to move. If
            it runs out, {otherName} can claim the win.
          </p>
        ) : (
          <p style={S.urgent} data-urgent="true">
            Your time is up — {otherName} can claim the win at any moment. Move
            now to stay in the game.
          </p>
        )}
        {skew}
      </>
    );
  }

  // You are waiting on them. Nothing expires on its own, so this is an offer,
  // never a countdown to something happening *to* you.
  return (
    <>
      {canClaimTimeout(game, viewerSeat, now) ? (
        <ClaimTimeoutPanel opponentName={waitingName} onClaim={onClaimTimeout} />
      ) : (
        <p style={S.info}>
          Waiting on {waitingName} — {formatRemaining(remaining)} until you can
          claim the win on time.
        </p>
      )}
      {skew}
    </>
  );
}
