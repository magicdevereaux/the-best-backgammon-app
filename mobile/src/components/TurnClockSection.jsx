import React, { useState } from "react";
import { View, Text, Pressable, Alert, StyleSheet } from "react-native";
import { canClaimTimeout } from "../game/gating";
import { useTurnClock, formatDuration } from "../game/useTurnClock";
import { colors } from "../theme";

/*
 * The inactivity clock, shown in both directions.
 *
 * A player must never lose to a clock they were never shown, so this renders
 * for whichever side of it the viewer is on:
 *
 *   1. YOU are on the clock  → a warning with the time you have left to move,
 *                              escalating to danger styling as it runs down.
 *   2. THEY are on the clock → how long until you can claim…
 *   3. …and once it elapses  → the claim control.
 *
 * Visibility is entirely the server's call: `turn_deadline` is null whenever a
 * claim is impossible in principle (game not active, a closed/deleted seat,
 * either seat a guest, no clock recorded), and a null deadline renders nothing.
 * The eligibility rule is never re-derived here — see canClaimTimeout in
 * src/game/gating.js, and docs/decisions/adr-002-inactivity-forfeit.md.
 *
 * The countdown is extrapolated locally at 1s (useTurnClock), not driven by the
 * ~3.5s poll; the poll only reconciles the deadline — and the `server_now`
 * anchor behind `clockOffset`.
 *
 * It ticks against the *server's* clock, not this device's: `clockOffset`
 * (useGame, from the `server_now` on every payload) is added to `Date.now()`
 * before any comparison. A phone hours fast would otherwise show the claim
 * control early and then eat a 400 on every press, and one hours slow would
 * promise a player time they did not have. If the two clocks still disagree
 * grossly, say so — see SKEW_NOTICE_MS.
 *
 * Unlike the abandon control next door, a claim SCORES — a real winner, a
 * single game at the current cube value, into the match. So it confirms through
 * a platform Alert first, and the copy says plainly that it ends the game.
 *
 * Errors are the screen's job: `onClaimTimeout` routes through useGame, which
 * puts the server's 400/403 message in `actionError` below the board. A 400
 * "too early" is genuinely reachable here — this device's clock can sit ahead
 * of the server's — so it must surface rather than be swallowed.
 */

// Below this much time left, the "it's your move" notice turns into a warning.
// Shared with frontend/src/components/TurnClock.jsx — keep the two equal so a
// player gets the same warning whichever client they opened. A flat threshold
// rather than a fraction, because the client is never told how long the deadline
// was to begin with; and an hour rather than minutes, because the deadline ships
// at a 48-hour default.
const URGENT_MS = 60 * 60 * 1000; // 1 hour

// Past this much disagreement between this device's clock and the server's,
// tell the player. The countdown is already corrected, so nothing is *wrong* —
// but the numbers here will not match their own clock, and an unexplained
// mismatch reads as a bug. Below five minutes it isn't worth a line of text.
// Shared with frontend/src/components/TurnClock.jsx.
const SKEW_NOTICE_MS = 5 * 60 * 1000;

export default function TurnClockSection({ game, viewerSeat, clockOffset = 0, onClaimTimeout }) {
  const [busy, setBusy] = useState(false);
  const { now, msRemaining } = useTurnClock(game?.turn_deadline, clockOffset);

  // No clock, or one that is none of this viewer's business.
  if (msRemaining == null) return null;
  const waitingSeat = game?.turn_waiting_seat;
  if (waitingSeat !== "p1" && waitingSeat !== "p2") return null;

  const onMyClock = viewerSeat === waitingSeat;
  const claimable = canClaimTimeout(game, viewerSeat, now);
  const theirClock =
    (viewerSeat === "p1" || viewerSeat === "p2") && !onMyClock;

  // A spectator holds neither seat: no clock of their own to be warned about
  // and no standing to claim.
  if (!onMyClock && !theirClock) return null;

  const opponentSeat = viewerSeat === "p1" ? "p2" : "p1";
  const opponentName =
    (opponentSeat === "p1" ? game.player1_name : game.player2_name) || "Your opponent";
  const idleName =
    (waitingSeat === "p1" ? game.player1_name : game.player2_name) || "Your opponent";
  const remaining = formatDuration(msRemaining);

  // Only when the two clocks are grossly apart. Says which way, so a player can
  // recognise their own device as the odd one out, and says that the number
  // above it is the one that counts.
  const offset = Number.isFinite(clockOffset) ? clockOffset : 0;
  const skewNotice =
    Math.abs(offset) >= SKEW_NOTICE_MS ? (
      <Text style={styles.skew}>
        {`Heads up: this device's clock is ${formatDuration(Math.abs(offset))} ${
          offset < 0 ? "ahead of" : "behind"
        } the server's. The time above follows the server, which is what decides the game.`}
      </Text>
    ) : null;

  async function performClaim() {
    setBusy(true);
    try {
      await onClaimTimeout();
    } catch {
      // The screen owns error display (useGame puts the server's message in
      // actionError). Swallowing here only guards against an unhandled
      // rejection escaping the Alert callback and leaving the button stuck.
    } finally {
      setBusy(false);
    }
  }

  function confirmClaim() {
    Alert.alert(
      "Claim a win on time?",
      `${idleName} has run out of time to move. Claiming ends the game now and ` +
        "awards you a single game at the current stakes, scored into the match. " +
        "It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Claim Win", style: "destructive", onPress: performClaim },
      ]
    );
  }

  // ── 1. You are the one on the clock ───────────────────────────────────────
  if (onMyClock) {
    const urgent = msRemaining <= URGENT_MS;
    const expired = msRemaining === 0;
    return (
      <View style={[styles.card, urgent && styles.cardUrgent]}>
        <Text style={[styles.heading, urgent && styles.headingUrgent]}>
          {expired
            ? "You are out of time"
            : urgent
              ? `${remaining} left to move`
              : `It's your move — ${remaining} left`}
        </Text>
        <Text style={styles.body}>
          {expired
            ? `${opponentName} can claim this game at any moment. Move now — you keep playing until they do.`
            : `Play a turn before the clock runs out, or ${opponentName} can claim the win.`}
        </Text>
        {skewNotice}
      </View>
    );
  }

  // ── 2. The claim is live ──────────────────────────────────────────────────
  if (claimable) {
    return (
      <View style={[styles.card, styles.cardUrgent]}>
        <Text style={[styles.heading, styles.headingUrgent]}>
          {`${idleName} ran out of time`}
        </Text>
        <Text style={styles.body}>
          You can claim the win. The game ends now and you're awarded a single
          game at the current stakes, scored into the match as normal.
        </Text>
        <Pressable
          onPress={confirmClaim}
          disabled={busy}
          style={[styles.outlineBtn, busy && styles.btnDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.outlineBtnText}>
            {busy ? "Claiming…" : "Claim Win on Time"}
          </Text>
        </Pressable>
        {skewNotice}
      </View>
    );
  }

  // ── 3. Their clock is still running ───────────────────────────────────────
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{`Waiting on ${idleName} — ${remaining}`}</Text>
      <Text style={styles.body}>
        {`If ${idleName} hasn't moved by then, you'll be able to claim the win.`}
      </Text>
      {skewNotice}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  cardUrgent: { borderColor: colors.danger },
  heading: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  headingUrgent: { color: colors.danger },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  skew: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 8, fontStyle: "italic" },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
    marginTop: 12,
  },
  outlineBtnText: { color: colors.danger, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },
});
