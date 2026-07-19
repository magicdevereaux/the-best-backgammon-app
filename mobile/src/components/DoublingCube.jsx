import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme";

/**
 * Doubling cube display and controls (native port of the web DoublingCube).
 *
 * Position mirrors a physical cube: centered (no owner) or on the owner's
 * side — p1 left, p2 right. The Double button shows only when this device may
 * act for the current player AND doubling is legal (canOfferDouble from
 * useGame; the server re-validates). The Accept/Drop prompt shows only when
 * this device may answer for the responder seat (canRespond, gating-aware).
 */
export default function DoublingCube({
  game,
  canOfferDouble = false,
  canRespond = false,
  onOfferDouble,
  onRespondToDouble,
}) {
  if (!game) return null;
  const value = game.cube_value ?? 1;
  const owner = game.cube_owner;
  const pending = game.double_offered_by;

  const ownerName =
    owner === "p1" ? game.player1_name : owner === "p2" ? game.player2_name : null;
  const offererName = pending === "p1" ? game.player1_name : game.player2_name;
  const align =
    owner === "p1" ? "flex-start" : owner === "p2" ? "flex-end" : "center";

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, { justifyContent: align }]}>
        <View style={styles.cube} testID="cube-value">
          <Text style={styles.cubeText}>{value}</Text>
        </View>
        <Text style={styles.ownerLabel}>
          {ownerName ? `Cube: ${ownerName}` : "Cube: centered"}
          {game.crawford_game ? " · Crawford — no doubling" : ""}
        </Text>
        {canOfferDouble && game.status === "active" && (
          <Pressable onPress={onOfferDouble} style={styles.doubleBtn}>
            <Text style={styles.doubleBtnText}>Double to {value * 2}</Text>
          </Pressable>
        )}
      </View>

      {pending && game.status === "active" && (
        <View style={styles.prompt}>
          <Text style={styles.promptText}>
            {offererName} offers to double to {value * 2}.
          </Text>
          {canRespond ? (
            <View style={styles.promptButtons}>
              <Pressable onPress={() => onRespondToDouble(true)} style={styles.accept}>
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
              <Pressable onPress={() => onRespondToDouble(false)} style={styles.drop}>
                <Text style={styles.dropText}>
                  Drop ({value} pt{value === 1 ? "" : "s"})
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.waiting}>Waiting for their answer…</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  cube: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.goldDark,
    alignItems: "center",
    justifyContent: "center",
  },
  cubeText: { color: "#222", fontWeight: "800", fontSize: 17 },
  ownerLabel: { color: colors.textMuted, fontSize: 13 },
  doubleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  doubleBtnText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  prompt: {
    marginTop: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.goldDark,
    gap: 8,
  },
  promptText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  promptButtons: { flexDirection: "row", gap: 10 },
  accept: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  acceptText: { color: colors.goldText, fontWeight: "700", fontSize: 14 },
  drop: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropText: { color: colors.danger, fontWeight: "700", fontSize: 14 },
  waiting: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
});
