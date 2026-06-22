import React, { useState, useCallback } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useRouter, Link, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { fetchMe } from "../src/api/auth";
import { colors } from "../src/theme";

function StatRow({ label, value, accent }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && styles.rowValueAccent]}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const me = await fetchMe();
      setStats(me);
      if (me) updateUser(me); // keep the lobby's W/L in sync with fresh numbers
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [updateUser]);

  // Refresh stats each time the screen is focused (e.g. after finishing a game).
  useFocusEffect(
    useCallback(() => {
      if (user) load(false);
      else setLoading(false);
    }, [user, load])
  );

  if (user === undefined) {
    return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  if (user === null) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.h1}>Profile</Text>
          <Text style={styles.muted}>You're playing as a guest.</Text>
          <Link href="/login" style={styles.link}>Log in or register to track your stats →</Link>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  if (!stats) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.muted}>Could not load stats.</Text>
          <Pressable onPress={() => load(false)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const winPct = `${stats.win_percentage}%`;
  const gammonRate = `${stats.gammon_rate}%`;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.gold} />}
      >
        <Text style={styles.h1}>{stats.username}</Text>
        <Text style={styles.muted}>Player profile · lifetime stats</Text>

        {/* Headline record */}
        <View style={styles.headline}>
          <View style={styles.headItem}>
            <Text style={styles.headNum}>{stats.wins}</Text>
            <Text style={styles.headLabel}>Wins</Text>
          </View>
          <View style={styles.headItem}>
            <Text style={styles.headNum}>{stats.losses}</Text>
            <Text style={styles.headLabel}>Losses</Text>
          </View>
          <View style={styles.headItem}>
            <Text style={styles.headNum}>{winPct}</Text>
            <Text style={styles.headLabel}>Win rate</Text>
          </View>
        </View>

        <View style={styles.card}>
          <StatRow label="Games played" value={stats.total_games} />
          <StatRow label="Gammons won" value={stats.total_gammons} accent />
          <StatRow label="Backgammons won" value={stats.total_backgammons} accent />
          <StatRow label="Gammon rate (% of wins)" value={gammonRate} />
          <StatRow label="Total points won" value={stats.total_points_won} />
          <StatRow label="Total points lost" value={stats.total_points_lost} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  content: { padding: 16 },
  h1: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  link: { color: colors.gold, fontSize: 15, fontWeight: "600", marginTop: 16 },

  headline: { flexDirection: "row", gap: 10, marginTop: 18 },
  headItem: { flex: 1, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 16, alignItems: "center" },
  headNum: { color: colors.gold, fontSize: 26, fontWeight: "800" },
  headLabel: { color: colors.textMuted, fontSize: 12, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 4, marginTop: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowValueAccent: { color: colors.gold },

  retryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 18, alignSelf: "flex-start", marginTop: 14 },
  retryText: { color: colors.goldText, fontWeight: "700" },
});
