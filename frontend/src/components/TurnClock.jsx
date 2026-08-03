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

const S = {
  info:   { margin: "0.5rem 0", fontSize: "0.85rem", color: "var(--text-secondary)" },
  warn:   { margin: "0.5rem 0", fontSize: "0.85rem", fontWeight: 600, color: "var(--gold)" },
  urgent: { margin: "0.5rem 0", fontSize: "0.95rem", fontWeight: 700, color: "var(--error)" },
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

export default function TurnClock({ game, onClaimTimeout }) {
  const deadline = game?.turn_deadline ?? null;
  const [now, setNow] = useState(() => Date.now());

  // One interval, restarted whenever the server hands down a new deadline (and
  // never started at all when there is none). Cleared on unmount.
  useEffect(() => {
    if (!deadline) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;

  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return null;

  const waiting = game.turn_waiting_seat;
  if (waiting !== "p1" && waiting !== "p2") return null;

  // Whose seat is this browser? The server's own answer. A bystander (no seat)
  // has nothing to be warned about and nothing to claim, so they see no clock.
  const viewerSeat = game.viewer_seat ?? null;
  if (viewerSeat !== "p1" && viewerSeat !== "p2") return null;

  const waitingName = waiting === "p1" ? game.player1_name : game.player2_name;
  const otherName = waiting === "p1" ? game.player2_name : game.player1_name;
  const remaining = at - now;

  if (viewerSeat === waiting) {
    // You are the one on the clock. Say so, say what happens, and get loud as it
    // closes in. `data-urgent` carries that state somewhere assertable — the
    // inline CSS variables these styles use don't survive jsdom.
    const urgent = remaining <= URGENT_MS;
    return remaining > 0 ? (
      <p style={urgent ? S.urgent : S.warn} data-urgent={String(urgent)}>
        You're on the clock — {formatRemaining(remaining)} left to move. If it
        runs out, {otherName} can claim the win.
      </p>
    ) : (
      <p style={S.urgent} data-urgent="true">
        Your time is up — {otherName} can claim the win at any moment. Move now
        to stay in the game.
      </p>
    );
  }

  // You are waiting on them. Nothing expires on its own, so this is an offer,
  // never a countdown to something happening *to* you.
  return canClaimTimeout(game, viewerSeat, now) ? (
    <ClaimTimeoutPanel opponentName={waitingName} onClaim={onClaimTimeout} />
  ) : (
    <p style={S.info}>
      Waiting on {waitingName} — {formatRemaining(remaining)} until you can claim
      the win on time.
    </p>
  );
}
