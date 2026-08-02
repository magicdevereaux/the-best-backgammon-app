import React, { useState } from "react";
import { View, Text, Pressable, Alert, StyleSheet } from "react-native";
import { colors } from "../theme";

/*
 * The escape hatch from a game deadlocked by a closed seat.
 *
 * When the player who owes the next action has deleted their account, the
 * server refuses that seat to everyone — including the survivor, who would
 * otherwise get to play both sides — so the game can never reach an end. This
 * closes it out.
 *
 * It is deliberately NOT a resign button and the copy has to say so: there is
 * no winner, no points change hands, and the match score is left exactly as it
 * was. Two gates, mirroring DeleteAccountSection's idiom for a final action:
 * the control only renders when the caller says it applies (`canAbandon`, from
 * computeGating — see src/game/gating.js), and the platform Alert with a
 * `destructive` button confirms it.
 *
 * Errors are the screen's job: `onAbandon` routes through useGame, which puts
 * the server's 400/403 message in `actionError` below the board.
 */
export default function AbandonGameSection({ canAbandon, onAbandon }) {
  const [busy, setBusy] = useState(false);

  if (!canAbandon) return null;

  async function performAbandon() {
    setBusy(true);
    try {
      await onAbandon();
    } catch {
      // The screen owns error display (useGame puts the server's message in
      // actionError). Swallowing here only guards against an unhandled
      // rejection escaping the Alert callback and leaving the button stuck.
    } finally {
      setBusy(false);
    }
  }

  function confirmAbandon() {
    Alert.alert(
      "Close out this game?",
      "This game can never be finished, so it ends here with no winner. " +
        "Nobody scores, the match score is left as it is, and neither record " +
        "changes — this is not a resignation. It can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Close Out", style: "destructive", onPress: performAbandon },
      ]
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.body}>
        Nothing can move this game forward. You can close it out — the game (and
        the match, if there is one) ends with no winner and no points for either
        player.
      </Text>
      <Pressable
        onPress={confirmAbandon}
        disabled={busy}
        style={[styles.outlineBtn, busy && styles.btnDisabled]}
        accessibilityRole="button"
      >
        <Text style={styles.outlineBtnText}>
          {busy ? "Closing out…" : "Close Out This Game"}
        </Text>
      </Pressable>
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
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
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
