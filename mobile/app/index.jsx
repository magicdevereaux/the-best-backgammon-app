import React, { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, TextInput } from "react-native";
import { useRouter, Link, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { fetchGames, fetchLobby, createGame, joinGame } from "../src/api/games";
import { createMatch } from "../src/api/matches";
import { colors } from "../src/theme";

const MATCH_LENGTHS = [3, 5, 7, 9];

export default function LobbyScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [games, setGames] = useState([]);
  const [openGames, setOpenGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [guestName, setGuestName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [matchPoints, setMatchPoints] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, open] = await Promise.all([fetchGames(), fetchLobby()]);
      setGames(Array.isArray(mine) ? mine : []);
      setOpenGames(Array.isArray(open) ? open : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const guestNameOrDefault = () => (user ? user.username : guestName.trim() || "Player 1");

  function requireGuestName() {
    if (user) return true;
    if (!guestName.trim()) {
      setError("Enter your name first (top of Start a game).");
      return false;
    }
    return true;
  }

  async function handleNewHotseat() {
    setError(null);
    try {
      const game = await createGame({ player1_name: guestNameOrDefault(), player2_name: "Player 2" });
      router.push(`/game/${game.id}`);
    } catch (e) { setError(e.message); }
  }

  async function handleCreateOnline() {
    setError(null);
    try {
      const game = await createGame({}); // server fills player1 from the logged-in user; waits for an opponent
      router.push(`/game/${game.id}`);
    } catch (e) { setError(e.message); }
  }

  async function handleCreateMatch() {
    setError(null);
    try {
      const match = await createMatch({
        target_points: matchPoints,
        player1_name: guestNameOrDefault(),
        player2_name: "Player 2",
      });
      router.push(`/game/${match.current_game_id}`);
    } catch (e) { setError(e.message); }
  }

  async function handleJoinGame(gameId) {
    setError(null);
    if (!requireGuestName()) return;
    const name = user ? undefined : guestName.trim();
    try {
      await joinGame(gameId, name);
      router.push(`/game/${gameId}`);
    } catch (e) { setError(e.message); }
  }

  async function handleJoinByCode() {
    setError(null);
    const code = joinCode.trim();
    if (!code) { setError("Enter a game code."); return; }
    if (!requireGuestName()) return;
    const name = user ? undefined : guestName.trim();
    // Best-effort join (a game already in progress will reject the join, but we
    // still open it so participants/spectators can view it).
    try { await joinGame(code, name); } catch { /* open anyway */ }
    router.push(`/game/${code}`);
  }

  function statusLine(g) {
    if (g.status === "finished") return `Finished · winner ${g.winner === "p1" ? g.player1_name : g.player2_name}`;
    if (g.status === "waiting") return "Waiting for opponent";
    return `${g.current_turn === "p1" ? g.player1_name : g.player2_name}'s turn`;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Auth row */}
        <View style={styles.authRow}>
          {user === undefined ? (
            <ActivityIndicator color={colors.gold} />
          ) : user ? (
            <>
              <Pressable onPress={() => router.push("/profile")}>
                <Text style={styles.userText}>
                  {user.username} · {user.wins}W/{user.losses}L
                </Text>
              </Pressable>
              <Pressable onPress={logout}><Text style={styles.link}>Log out</Text></Pressable>
            </>
          ) : (
            <Link href="/login" style={styles.link}>Log in / Register</Link>
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {/* ── Start a game ─────────────────────────────────────────────── */}
        <Text style={styles.h1}>Start a game</Text>

        {!user && (
          <TextInput
            placeholder="Your name (used for guest games)"
            placeholderTextColor={colors.textMuted}
            value={guestName}
            onChangeText={setGuestName}
            style={styles.input}
          />
        )}

        <Pressable onPress={handleNewHotseat} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>New hotseat game</Text>
        </Pressable>

        {user && (
          <Pressable onPress={handleCreateOnline} style={[styles.secondaryBtn, { marginTop: 10 }]}>
            <Text style={styles.secondaryBtnText}>Create online game (shareable)</Text>
          </Pressable>
        )}

        {/* Match creation */}
        <Text style={styles.h2}>Match — first to N points</Text>
        <View style={styles.chipRow}>
          {MATCH_LENGTHS.map((n) => {
            const active = matchPoints === n;
            return (
              <Pressable
                key={n}
                onPress={() => setMatchPoints(n)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={handleCreateMatch} style={[styles.secondaryBtn, { marginTop: 10 }]}>
          <Text style={styles.secondaryBtnText}>Start match to {matchPoints}</Text>
        </Pressable>

        {/* ── Join a game ──────────────────────────────────────────────── */}
        <Text style={styles.h1}>Join a game</Text>
        <View style={styles.joinRow}>
          <TextInput
            placeholder="Game code"
            placeholderTextColor={colors.textMuted}
            value={joinCode}
            onChangeText={setJoinCode}
            keyboardType="number-pad"
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
          />
          <Pressable onPress={handleJoinByCode} style={styles.joinBtn}>
            <Text style={styles.primaryBtnText}>Join</Text>
          </Pressable>
        </View>

        <Text style={styles.h2}>Open games</Text>
        {loading ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: 8 }} />
        ) : openGames.length === 0 ? (
          <Text style={styles.muted}>No open games right now.</Text>
        ) : (
          openGames.map((g) => (
            <View key={g.id} style={styles.gameRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.gameTitle}>Game #{g.id}</Text>
                <Text style={styles.muted}>{g.player1_name} is waiting</Text>
              </View>
              <Pressable onPress={() => handleJoinGame(g.id)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Join</Text>
              </Pressable>
            </View>
          ))
        )}

        {/* ── Your games ───────────────────────────────────────────────── */}
        <Text style={styles.h1}>Your games</Text>
        {loading ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: 8 }} />
        ) : games.length === 0 ? (
          <Text style={styles.muted}>No games yet. Start one above.</Text>
        ) : (
          games.map((g) => (
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}`)} style={styles.gameRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.gameTitle}>
                  Game #{g.id} — {g.player1_name} vs {g.player2_name || "…"}
                </Text>
                <Text style={styles.muted}>{statusLine(g)}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  authRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 14, minHeight: 24 },
  userText: { color: colors.textMuted, fontSize: 14 },
  link: { color: colors.gold, fontSize: 14, fontWeight: "600" },
  h1: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  h2: { color: colors.textMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  secondaryBtn: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: colors.text, fontWeight: "600", fontSize: 15 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: { width: 48, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, alignItems: "center" },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  chipText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  chipTextActive: { color: colors.goldText },
  joinRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  joinBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 11, paddingHorizontal: 18 },
  error: { color: colors.danger, marginTop: 10 },
  muted: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  gameRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  gameTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  smallBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14, marginLeft: 8 },
  smallBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 14 },
  chevron: { color: colors.textMuted, fontSize: 24, marginLeft: 8 },
});
