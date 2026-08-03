import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

// One tick a second. The countdown is extrapolated locally from the server's
// `turn_deadline`; the ~3.5s poll only *reconciles* the deadline, it is not the
// tick source (see docs/decisions/adr-002-inactivity-forfeit.md).
const TICK_MS = 1000;

// Milliseconds since the epoch for a Date / number / ISO string, or null.
function toMillis(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A live clock for an inactivity deadline.
 *
 * Returns `{ now, msRemaining, expired }`, where `now` is this device's wall
 * clock as of the last tick — feed it straight to canClaimTimeout so the button
 * and the countdown can never disagree about what time it is. `msRemaining` is
 * null when there is no deadline (the server sends `turn_deadline: null`
 * whenever a claim is impossible in principle, so that is the whole "show
 * nothing" signal).
 *
 * Lifecycle, matching useGame's poller: the interval is torn down on unmount
 * AND whenever the app leaves the foreground, so nothing ticks in the
 * background. On resume the value is recomputed from the wall clock rather than
 * assuming the missed ticks accrued — the elapsed time is real whether or not
 * anyone was counting. The interval also stops once the deadline passes, since
 * `msRemaining` is pinned at 0 from then on and re-rendering every second would
 * buy nothing.
 */
export function useTurnClock(deadline) {
  const deadlineMs = useMemo(() => toMillis(deadline), [deadline]);
  const [now, setNow] = useState(() => Date.now());

  // Read inside the interval so the callback never closes over a stale value.
  const deadlineRef = useRef(deadlineMs);
  deadlineRef.current = deadlineMs;

  useEffect(() => {
    if (deadlineMs == null) return undefined;

    let interval = null;
    const stop = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const start = () => {
      // Resync to the wall clock first: this runs on mount, on any deadline
      // change, and on every foreground resume.
      const current = Date.now();
      setNow(current);
      if (deadlineRef.current != null && current >= deadlineRef.current) return;
      if (interval != null) return;
      interval = setInterval(() => {
        const t = Date.now();
        setNow(t);
        if (deadlineRef.current != null && t >= deadlineRef.current) stop();
      }, TICK_MS);
    };

    // AppState.currentState is "unknown" on a cold start on Android; treat
    // anything that isn't an explicit background state as foreground.
    const state = AppState.currentState;
    if (state !== "background" && state !== "inactive") start();

    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else stop();
    });

    return () => {
      stop();
      sub?.remove?.();
    };
  }, [deadlineMs]);

  if (deadlineMs == null) return { now, msRemaining: null, expired: false };
  const msRemaining = Math.max(0, deadlineMs - now);
  return { now, msRemaining, expired: msRemaining === 0 };
}

/**
 * A short, human duration for a countdown: "2d 3h", "5h 12m", "4:31", "18s".
 * Coarse at the top end (nobody watches a 24-hour clock tick) and precise at
 * the bottom, where it matters that you can see the seconds go.
 */
export function formatDuration(ms) {
  if (ms == null) return "";
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${seconds}s`;
}
