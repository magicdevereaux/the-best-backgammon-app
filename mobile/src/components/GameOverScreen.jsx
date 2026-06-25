import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../theme";

const WIN_TYPE_LABEL = {
  normal: "wins!",
  gammon: "wins with a gammon!",
  backgammon: "wins with a backgammon!",
};

const WIN_TYPE_DETAIL = {
  gammon: "Gammon — opponent has borne off nothing.",
  backgammon: "Backgammon — opponent still has a checker on the bar or in your home board.",
};

// Native port of frontend/src/components/GameOverScreen.jsx as a modal overlay.
export default function GameOverScreen({ game, match, onNextGame, onNewMatch, onLobby }) {
  const winnerName = game.winner === "p1" ? game.player1_name : game.player2_name;
  const pts = game.points_value ?? 1;
  const label = WIN_TYPE_LABEL[game.win_type] ?? "wins!";
  const detail = WIN_TYPE_DETAIL[game.win_type];
  const matchActive = match && match.status === "active";
  const matchFinished = match && match.status === "finished";

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onLobby}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {winnerName} {label}
          </Text>

          <Text style={styles.points}>
            {pts === 1 ? "1 point awarded" : `${pts} points awarded`}
          </Text>
          {detail && <Text style={styles.detail}>{detail}</Text>}

          {match && (
            <View style={styles.matchBox}>
              <Text style={styles.matchHeading}>
                Match score (first to {match.target_points})
              </Text>
              <Text style={styles.matchScore}>
                {match.player1_name} {match.player1_score} – {match.player2_score} {match.player2_name}
              </Text>
              {matchFinished && (
                <Text style={styles.matchWin}>
                  {match.winner === "p1" ? match.player1_name : match.player2_name} wins the match!
                </Text>
              )}
            </View>
          )}

          <View style={styles.buttons}>
            {matchActive && (
              <Pressable onPress={onNextGame} style={[styles.btn, styles.primary]}>
                <Text style={styles.primaryText}>Next Game</Text>
              </Pressable>
            )}
            {(!match || matchFinished) && (
              <Pressable onPress={onNewMatch} style={[styles.btn, styles.primary]}>
                <Text style={styles.primaryText}>New Match</Text>
              </Pressable>
            )}
            <Pressable onPress={onLobby} style={[styles.btn, styles.secondary]}>
              <Text style={styles.secondaryText}>Back to Lobby</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.bgRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: "center",
  },
  title: { color: colors.gold, fontSize: 22, fontWeight: "800", textAlign: "center" },
  points: { color: colors.text, fontSize: 16, marginTop: 10, fontWeight: "600" },
  detail: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 6 },
  matchBox: {
    width: "100%",
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    alignItems: "center",
  },
  matchHeading: { color: colors.textMuted, fontSize: 13 },
  matchScore: { color: colors.text, fontSize: 20, fontWeight: "800", marginTop: 4 },
  matchWin: { color: colors.gold, fontSize: 14, fontWeight: "700", marginTop: 8, textAlign: "center" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 22 },
  btn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 7, borderWidth: 1 },
  primary: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  secondary: { backgroundColor: "transparent", borderColor: colors.border },
  primaryText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  secondaryText: { color: colors.text, fontWeight: "600", fontSize: 15 },
});
