import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/context/AuthContext";
import { login, register, requestPasswordReset } from "../src/api/auth";
import { colors } from "../src/theme";

const TITLES = {
  login: "Welcome back",
  register: "Create account",
  reset: "Reset password",
};

export default function LoginScreen() {
  const router = useRouter();
  const { updateUser } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "register" | "reset"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  function switchTo(next) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      const user = mode === "login"
        ? await login(username.trim(), password)
        : await register(username.trim(), password, email);
      updateUser(user);
      router.replace("/");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // The server's reply is byte-identical whether or not an account holds the
  // address (anti-enumeration). Render it as-is and never branch on a "found"
  // vs "not found" outcome — there is no such distinction to render.
  async function handleReset() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setNotice(await requestPasswordReset(email));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "reset") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.h1}>{TITLES.reset}</Text>
          <Text style={styles.help}>
            Enter the email address on your account and we'll send a reset link.
            The link opens in your browser.
          </Text>

          <TextInput
            placeholder="Email address"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={styles.input}
          />

          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Pressable onPress={handleReset} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]}>
            {busy ? (
              <ActivityIndicator color={colors.goldText} />
            ) : (
              <Text style={styles.primaryBtnText}>Send reset link</Text>
            )}
          </Pressable>

          <Pressable onPress={() => switchTo("login")}>
            <Text style={styles.switch}>Back to log in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.content}>
        <Text style={styles.h1}>{TITLES[mode]}</Text>

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
        {/* Required, and worth being plain about why. The two things an address
            buys are both things you lose *silently* without one: the password
            reset link, and the turn reminder that is the only warning before an
            online game is forfeited on its 48-hour clock. Nothing is deliberately
            left to the server here — `register()` always sends the field, so a
            blank one is refused in the server's own words rather than by a
            client-side rule that could drift from it. Anyone who would rather not
            hand over an address still has "Continue as guest" below, which needs
            no account at all — that, not an address-less account, is the
            guest-friendly path. */}
        {mode === "register" && (
          <>
            <TextInput
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
            />
            <Text style={styles.help}>
              Required. It's how we send you a password reset link, and how we
              warn you when an online game is close to being forfeited on its
              48-hour clock — without it, both happen silently. You can play
              without an account at all: tap "Continue as guest" below.
            </Text>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={handleSubmit} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]}>
          {busy ? (
            <ActivityIndicator color={colors.goldText} />
          ) : (
            <Text style={styles.primaryBtnText}>{mode === "login" ? "Log in" : "Register"}</Text>
          )}
        </Pressable>

        {mode === "login" && (
          <Pressable onPress={() => switchTo("reset")}>
            <Text style={styles.switch}>Forgot password?</Text>
          </Pressable>
        )}

        <Pressable onPress={() => switchTo(mode === "login" ? "register" : "login")}>
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
  help: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: -4 },
  error: { color: colors.danger },
  notice: { color: colors.gold, fontSize: 14, lineHeight: 19 },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  switch: { color: colors.gold, textAlign: "center", marginTop: 8, fontSize: 14 },
  guest: { color: colors.textMuted, textAlign: "center", marginTop: 16, fontSize: 14 },
});
