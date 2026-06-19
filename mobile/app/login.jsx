import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { login, register } from "../src/api/auth";
import { colors } from "../src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const { updateUser } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const user = mode === "login"
        ? await login(username.trim(), password)
        : await register(username.trim(), password);
      updateUser(user);
      router.replace("/");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.content}>
        <Text style={styles.h1}>{mode === "login" ? "Welcome back" : "Create account"}</Text>

        <TextInput
          placeholder="Username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          style={styles.input}
        />
        <TextInput
          placeholder={mode === "register" ? "Password (min 8 chars)" : "Password"}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={handleSubmit} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]}>
          {busy ? (
            <ActivityIndicator color={colors.goldText} />
          ) : (
            <Text style={styles.primaryBtnText}>{mode === "login" ? "Log in" : "Register"}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
          <Text style={styles.switch}>
            {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.replace("/")}>
          <Text style={styles.guest}>Continue as guest</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 12 },
  h1: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 8 },
  input: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, color: colors.text, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  error: { color: colors.danger },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  switch: { color: colors.gold, textAlign: "center", marginTop: 8, fontSize: 14 },
  guest: { color: colors.textMuted, textAlign: "center", marginTop: 16, fontSize: 14 },
});
