import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme";

function Btn({ label, onPress, disabled, variant = "secondary" }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        variant === "primary" ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, variant === "primary" ? styles.labelPrimary : styles.labelSecondary]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Staging controls for the current turn. Rolling now happens by tapping the
 * dice (see Dice's "Tap to roll" state), so this row focuses on the staged
 * moves: undo the last one, reset the whole turn, or commit.
 *
 * When the roll produced no legal moves at all, the primary button becomes
 * "Pass Turn" — committing zero moves, which the backend treats as an explicit
 * turn pass.
 */
export default function GameControls({
  turnActive,
  hasPendingMoves = false,
  hasLegalMoves = true,
  onUndo,
  onResetTurn,
  onConfirmTurn,
}) {
  const mustPass = turnActive && !hasPendingMoves && !hasLegalMoves;
  const confirmLabel = mustPass ? "Pass Turn" : "Confirm Turn";

  return (
    <View style={styles.row}>
      <Btn label="Undo" onPress={onUndo} disabled={!hasPendingMoves} />
      <Btn label="Reset Turn" onPress={onResetTurn} disabled={!hasPendingMoves} />
      <Btn
        label={confirmLabel}
        onPress={onConfirmTurn}
        disabled={!turnActive}
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14, alignItems: "center" },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1 },
  primary: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  secondary: { backgroundColor: colors.bgRaised, borderColor: colors.border },
  disabled: { opacity: 0.35 },
  label: { fontSize: 14, fontWeight: "600", letterSpacing: 0.3 },
  labelPrimary: { color: colors.goldText },
  labelSecondary: { color: colors.text },
});
