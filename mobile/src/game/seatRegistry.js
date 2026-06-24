import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

// Device-local record of which seat(s) this device controls for a given game.
//
// Why this exists: turn-ownership gating in the game screen can detect a
// logged-in-vs-logged-in online game from the seat user FKs alone. But when the
// opponent joined as a *guest* (`player2_user` is null), the payload looks the
// same as a hotseat game. So at the moment this device *creates* or *joins* a
// game we know which seat it owns and whether the game is online, and we record
// it here. The game screen consults this to gate correctly.
//
// Stored compactly in SecureStore (already a dependency) so gating survives an
// app restart:
//   "p1" | "p2" | "p1p2"  → online (gated); the seat(s) this device controls
//   "local"               → hotseat / single-device (not gated, controls both)

const KEY = "bg_seats";
const MAX_ENTRIES = 40;

let cache = {};
let hydrated = false;
const listeners = new Set();

function notify() {
  listeners.forEach((l) => l());
}

function persist() {
  const ids = Object.keys(cache);
  if (ids.length > MAX_ENTRIES) {
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete cache[id];
  }
  SecureStore.setItemAsync(KEY, JSON.stringify(cache)).catch(() => {});
}

// Load persisted seats once. In-memory writes made before hydration win over
// stored values (merge), so recording a seat then navigating can't be clobbered
// by a slow read.
export async function hydrateSeats() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const stored = raw ? JSON.parse(raw) : {};
    cache = { ...stored, ...cache };
  } catch {
    // keep whatever is in memory
  }
  notify();
}

// Record that this device controls `seat` ("p1" | "p2") in an online game.
export function recordOnlineSeat(gameId, seat) {
  const id = String(gameId);
  const cur = cache[id];
  if (cur && cur !== "local" && cur !== seat) {
    cache[id] = "p1p2"; // device somehow owns both seats
  } else {
    cache[id] = seat;
  }
  persist();
  notify();
}

// Record that this game is a single-device (hotseat) game — not gated.
export function recordLocalGame(gameId) {
  cache[String(gameId)] = "local";
  persist();
  notify();
}

// Returns { online: boolean, seats: string[] } or null if unknown.
export function getSeatInfo(gameId) {
  const code = cache[String(gameId)];
  if (!code) return null;
  if (code === "local") return { online: false, seats: ["p1", "p2"] };
  if (code === "p1p2") return { online: true, seats: ["p1", "p2"] };
  return { online: true, seats: [code] };
}

// For tests.
export function __resetSeatsForTest() {
  cache = {};
  hydrated = false;
  listeners.clear();
}

// Subscribe a React component to seat changes; returns the current seat info.
export function useSeatInfo(gameId) {
  const [, force] = useState(0);
  useEffect(() => {
    let mounted = true;
    const rerender = () => { if (mounted) force((n) => n + 1); };
    hydrateSeats().then(rerender);
    listeners.add(rerender);
    return () => {
      mounted = false;
      listeners.delete(rerender);
    };
  }, []);
  return getSeatInfo(gameId);
}
