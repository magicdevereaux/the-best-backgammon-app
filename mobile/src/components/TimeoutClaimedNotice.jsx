import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { TIMEOUT_CLAIMED_MESSAGE } from "../api/errors";
import { colors } from "../theme";

/*
 * What a player sees when their move lost the race to the opponent's inactivity
 * claim (see api/errors.isTimeoutClaimedError).
 *
 * Deliberately NOT styled as an error — no danger colour, no alarm. The move was
 * legal and, by this device's clock, in time; the only thing that happened is
 * that two requests crossed. So this is an explanation, and it stays true once
 * the game flips to finished a moment later — which is why useGame re-fetches
 * immediately rather than letting the poll catch up under a message that would
 * otherwise read as stale.
 *
 * Mirrored by frontend/src/components/TimeoutClaimedNotice.jsx; the copy itself
 * lives in api/errors.js so the two clients cannot drift.
 */
export default function TimeoutClaimedNotice() {
  return (
    <View style={styles.card} testID="timeout-claimed-notice">
      <Text style={styles.body}>{TIMEOUT_CLAIMED_MESSAGE}</Text>
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
    marginTop: 10,
    marginBottom: 4,
  },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
});
