import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, TextInput } from "react-native";
import { useRouter, Link, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { fetchGames, createGame } from "../src/api/games";
import { colors } from "../src/theme";

export default function LobbyScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestName, setGuestName] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchGames()
      .then((g) => setGames(Array.isArray(g) ? g : []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Reload whenever the lobby regains focus (e.g. returning from a game).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleNewHotseat() {
    setError(null);
    const p1 = user ? user.username : (guestName.trim() || "Player 1");
    try {
      const game = await createGame({ player1_name: p1, player2_name: "Player 2" });
      router.push(`/game/${game.id}`);
    } catch (e) {
      setError(e.message);
    }
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
              <Text style={styles.userText}>{user.username}</Text>
              <Pressable onPress={logout}>
                <Text style={styles.link}>Log out</Text>
              </Pressable>
            </>
          ) : (
            <Link href="/login" style={styles.link}>
              Log in / Register
            </Link>
          )}
        </View>

        <Text style={styles.h1}>Start a game</Text>

        {!user && (
          <TextInput
            placeholder="Your name (optional)"
            placeholderTextColor={colors.textMuted}
            value={guestName}
            onChangeText={setGuestName}
            style={styles.input}
          />
        )}

        <Pressable onPress={handleNewHotseat} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>New hotseat game</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={[styles.h1, { marginTop: 28 }]}>Your games</Text>
        {loading ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: 16 }} />
        ) : games.length === 0 ? (
          <Text style={styles.muted}>No games yet. Start one above.</Text>
        ) : (
          games.map((g) => (
            <Pressable key={g.id} onPress={() => router.push(`/game/${g.id}`)} style={styles.gameRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.gameTitle}>
                  Game #{g.id} — {g.player1_name} vs {g.player2_name || "…"}
                </Text>
                <Text style={styles.muted}>
                  {g.status === "finished"
                    ? `Finished · winner ${g.winner === "p1" ? g.player1_name : g.player2_name}`
                    : g.status === "waiting"
                    ? "Waiting for opponent"
                    : `${g.current_turn === "p1" ? g.player1_name : g.player2_name}'s turn`}
                </Text>
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
  content: { padding: 16 },
  authRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 14, minHeight: 24 },
  userText: { color: colors.textMuted, fontSize: 14 },
  link: { color: colors.gold, fontSize: 14, fontWeight: "600" },
  h1: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 16, marginBottom: 10 },
  input: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger, marginTop: 10 },
  muted: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  gameRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, marginBottom: 8 },
  gameTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  chevron: { color: colors.textMuted, fontSize: 24, marginLeft: 8 },
});
