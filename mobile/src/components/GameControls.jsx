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

export default function GameControls({ game, onRollDice, onResetTurn, onConfirmTurn, hasPendingMoves = false }) {
  const canRoll = game.status === "active" && (!game.dice_values || game.dice_values.length === 0);
  const turnActive = game.status === "active" && game.dice_values && game.dice_values.length > 0;

  return (
    <View style={styles.row}>
      <Btn label="Roll Dice" onPress={onRollDice} disabled={!canRoll} variant="primary" />
      <Btn label="Reset Turn" onPress={onResetTurn} disabled={!turnActive || !hasPendingMoves} />
      <Btn label="Confirm Turn" onPress={onConfirmTurn} disabled={!turnActive} />
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
