import React from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Board from "../../src/components/Board";
import Dice from "../../src/components/Dice";
import GameControls from "../../src/components/GameControls";
import { useGame } from "../../src/game/useGame";
import { colors } from "../../src/theme";

export default function GameScreen() {
  const { id } = useLocalSearchParams();
  const {
    game, loading, error, actionError,
    rollDice, stagedBoard, stagedDice,
    pendingMoves, legalMoves, stageMove,
    resetTurn, confirmTurn,
  } = useGame(id);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Error: {error}</Text>
      </View>
    );
  }
  if (!game) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Game not found.</Text>
      </View>
    );
  }

  const turnName = game.current_turn === "p1" ? game.player1_name : game.player2_name;
  // Dice consumed so far this turn (rolled count minus what remains staged).
  const usedCount = Math.max(0, (game.dice_values?.length || 0) - stagedDice.length);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <Stack.Screen options={{ title: `Game #${game.id}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {game.player1_name} vs {game.player2_name}
        </Text>

        {game.status === "active" && <Text style={styles.turn}>{turnName}'s turn</Text>}
        {game.status === "waiting" && <Text style={styles.turn}>Waiting for an opponent…</Text>}
        {game.status === "finished" && (
          <Text style={styles.finished}>
            Game over — {game.winner === "p1" ? game.player1_name : game.player2_name} wins!
          </Text>
        )}

        <Board
          boardState={stagedBoard}
          currentPlayer={game.current_turn}
          legalMoves={legalMoves}
          onMove={stageMove}
          interactive={game.status === "active"}
        />

        <Dice diceValues={stagedDice.length ? stagedDice : game.dice_values} usedCount={usedCount} />

        {game.status === "active" && (
          <GameControls
            game={game}
            onRollDice={rollDice}
            onResetTurn={resetTurn}
            onConfirmTurn={confirmTurn}
            hasPendingMoves={pendingMoves.length > 0}
          />
        )}

        {actionError && <Text style={styles.error}>{actionError}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: { padding: 12 },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  turn: { color: colors.textMuted, fontSize: 14, marginTop: 2, marginBottom: 12 },
  finished: { color: colors.gold, fontSize: 15, fontWeight: "700", marginTop: 2, marginBottom: 12 },
  error: { color: colors.danger, marginTop: 10 },
  muted: { color: colors.textMuted },
});
