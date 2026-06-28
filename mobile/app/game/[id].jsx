import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, ActivityIndicator, StyleSheet,
  Pressable, TextInput, Share, RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import Board from "../../src/components/Board";
import Dice from "../../src/components/Dice";
import GameControls from "../../src/components/GameControls";
import GameOverScreen from "../../src/components/GameOverScreen";
import MatchScore from "../../src/components/MatchScore";
import { useGame } from "../../src/game/useGame";
import { computeGating } from "../../src/game/gating";
import { useSeatInfo, recordOnlineSeat } from "../../src/game/seatRegistry";
import { useAuth } from "../../src/context/AuthContext";
import { joinGame } from "../../src/api/games";
import { fetchMatch, nextGame } from "../../src/api/matches";
import { friendlyJoinError } from "../../src/api/errors";
import { colors } from "../../src/theme";

export default function GameScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const {
    game, loading, error, actionError,
    rollDice, stagedBoard, stagedDice,
    pendingMoves, legalMoves, mustUseMoreDice, stageMove,
    resetTurn, undoMove, confirmTurn,
    reload, refresh, refreshing,
  } = useGame(id);

  const [match, setMatch] = useState(null);
  const [guestJoinName, setGuestJoinName] = useState("");
  const [joinError, setJoinError] = useState(null);
  const seatInfo = useSeatInfo(id);

  // Pull match info (scores, target) whenever the game belongs to a match, and
  // re-pull when the game's status changes (e.g. it just finished → new scores).
  useEffect(() => {
    if (!game?.match) { setMatch(null); return; }
    fetchMatch(game.match).then(setMatch).catch(() => {});
  }, [game?.match, game?.status]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }
  if (error) {
    return <View style={styles.center}><Text style={styles.error}>Error: {error}</Text></View>;
  }
  if (!game) {
    return <View style={styles.center}><Text style={styles.muted}>Game not found.</Text></View>;
  }

  async function handleShare() {
    const url = Linking.createURL(`/game/${game.id}`);
    try {
      await Share.share({
        message: `Join my backgammon game! Open this link: ${url}\n\nOr enter game code ${game.id} in the app.`,
      });
    } catch {}
  }

  async function handleJoin() {
    setJoinError(null);
    const name = user ? undefined : guestJoinName.trim();
    if (!user && !name) { setJoinError("Enter your name to join."); return; }
    try {
      await joinGame(game.id, name);
      recordOnlineSeat(game.id, "p2"); // the joiner always takes seat p2
      reload();
    } catch (err) {
      setJoinError(friendlyJoinError(err));
    }
  }

  async function handleNextGame() {
    try { const g = await nextGame(game.match); router.replace(`/game/${g.id}`); }
    catch (err) { console.error(err); }
  }

  // ── Waiting for an opponent (online game) ────────────────────────────────
  if (game.status === "waiting") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <Stack.Screen options={{ title: `Game #${game.id}` }} />
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
        >
          <Text style={styles.title}>Game #{game.id}</Text>
          <Text style={styles.turn}>{game.player1_name} is waiting for an opponent…</Text>

          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>Game code</Text>
            <Text style={styles.code}>{game.id}</Text>
          </View>

          <Pressable onPress={handleShare} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Share invite link</Text>
          </Pressable>

          <Text style={[styles.muted, { marginTop: 18, marginBottom: 6 }]}>
            On this device, join as the second player:
          </Text>
          {!user && (
            <TextInput
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              value={guestJoinName}
              onChangeText={setGuestJoinName}
              style={styles.input}
            />
          )}
          <Pressable onPress={handleJoin} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>
              {user ? `Join as ${user.username}` : "Join game"}
            </Text>
          </Pressable>
          {joinError && <Text style={styles.error}>{joinError}</Text>}

          <Text style={[styles.muted, { marginTop: 18 }]}>
            Pull down to refresh while you wait.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Active / finished game ────────────────────────────────────────────────
  const turnName = game.current_turn === "p1" ? game.player1_name : game.player2_name;
  const rolledDice = game.dice_values || [];

  // Turn-ownership gating (see src/game/gating.js). Combines the seat user FKs
  // with the device-local seat registry so online-vs-guest games gate correctly.
  const { gated, canInteract, spectating, waitingForOpponent } = computeGating({
    game,
    userId: user?.id,
    seatInfo,
  });

  const turnActive = canInteract && rolledDice.length > 0;
  const canRoll = canInteract && rolledDice.length === 0;
  const hasPendingMoves = pendingMoves.length > 0;
  const hasLegalMoves = legalMoves.length > 0;
  const mustPass = turnActive && !hasPendingMoves && !hasLegalMoves;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <Stack.Screen options={{ title: `Game #${game.id}` }} />

      {game.status === "finished" && (
        <GameOverScreen
          game={game}
          match={match}
          onNextGame={handleNextGame}
          onNewMatch={() => router.replace("/")}
          onLobby={() => router.replace("/")}
        />
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
      >
        {match && <MatchScore match={match} />}

        <Text style={styles.title}>{game.player1_name} vs {game.player2_name}</Text>

        {game.status === "active" && (
          waitingForOpponent ? (
            <View style={styles.waitRow}>
              <ActivityIndicator color={colors.textMuted} size="small" />
              <Text style={styles.turn}>Waiting for {turnName}…</Text>
            </View>
          ) : spectating ? (
            <Text style={styles.turn}>Spectating · {turnName}'s turn</Text>
          ) : gated ? (
            <Text style={styles.turnMine}>Your turn</Text>
          ) : (
            <Text style={styles.turn}>{turnName}'s turn</Text>
          )
        )}
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
          interactive={canInteract}
        />

        <Dice rolled={rolledDice} remaining={stagedDice} canRoll={canRoll} onRoll={rollDice} />

        {mustPass && (
          <Text style={styles.passHint}>No legal moves for this roll — tap “Pass Turn”.</Text>
        )}
        {turnActive && mustUseMoreDice && (
          <Text style={styles.passHint}>You must use as many dice as possible before confirming.</Text>
        )}

        {canInteract && (
          <GameControls
            turnActive={turnActive}
            hasPendingMoves={hasPendingMoves}
            hasLegalMoves={hasLegalMoves}
            mustUseMoreDice={mustUseMoreDice}
            onUndo={undoMove}
            onResetTurn={resetTurn}
            onConfirmTurn={confirmTurn}
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
  turnMine: { color: colors.gold, fontSize: 14, fontWeight: "700", marginTop: 2, marginBottom: 12 },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2, marginBottom: 12 },
  finished: { color: colors.gold, fontSize: 15, fontWeight: "700", marginTop: 2, marginBottom: 12 },
  passHint: { color: colors.textMuted, fontSize: 13, fontStyle: "italic", marginTop: 2 },
  error: { color: colors.danger, marginTop: 10 },
  muted: { color: colors.textMuted, fontSize: 13 },

  codeBox: {
    backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center",
    alignSelf: "flex-start", marginTop: 14, marginBottom: 14,
  },
  codeLabel: { color: colors.textMuted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  code: { color: colors.gold, fontSize: 32, fontWeight: "800", letterSpacing: 2, marginTop: 2 },

  input: {
    backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, color: colors.text,
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 18, alignSelf: "flex-start" },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  secondaryBtn: {
    backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
    borderRadius: 6, paddingVertical: 11, paddingHorizontal: 18, alignSelf: "flex-start",
  },
  secondaryBtnText: { color: colors.text, fontWeight: "600", fontSize: 15 },
});
