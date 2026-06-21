import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";

// Compact match score banner shown above the board during a match.
// Ported from frontend/src/components/MatchScore.jsx.
export default function MatchScore({ match }) {
  if (!match) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        Match (first to {match.target_points}):{" "}
        <Text style={styles.name}>{match.player1_name} </Text>
        <Text style={styles.score}>{match.player1_score}</Text>
        <Text style={styles.dash}> – </Text>
        <Text style={styles.score}>{match.player2_score}</Text>
        <Text style={styles.name}> {match.player2_name}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  label: { color: colors.textMuted, fontSize: 13 },
  name: { color: colors.text },
  score: { color: colors.gold, fontWeight: "700", fontSize: 14 },
  dash: { color: colors.textMuted },
});
