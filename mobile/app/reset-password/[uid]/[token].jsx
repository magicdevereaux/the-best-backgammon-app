import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { confirmPasswordReset } from "../../../src/api/auth";
import { colors } from "../../../src/theme";

/*
 * The in-app landing screen for a password-reset link. Mirrors the web client's
 * ResetPasswordPage, and like it the path is fixed by the server:
 * `build_password_reset_url` mails
 * `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`, so this file lives at
 * exactly `reset-password/[uid]/[token]` and expo-router derives the route.
 *
 * **How anyone gets here.** Same honest answer as verify-email: today it is the
 * custom scheme (`backgammon://reset-password/<uid>/<token>`) or a hand-off from
 * the web client. Tapping the link in a mail app does *not* open the app — mail
 * clients don't follow custom schemes and the mailed URL is an `https://` web
 * one anyway. Universal links / App Links would change that; they need a real
 * domain and signing credentials that don't exist here yet. This screen is what
 * they will point at.
 *
 * The uid+token pair *is* the credential — no login to get here, which is the
 * whole point for someone who cannot log in. Both are read from the URL and
 * posted back untouched.
 *
 * Three outcomes, and they are deliberately not the same shape:
 *
 *   - **Mismatch** is caught here, before the network. Two boxes exist precisely
 *     because a typo in a password you cannot see would otherwise lock you out
 *     of the account you were rescuing, and the server can't catch that — it
 *     only ever sees one string.
 *   - **A weak password** is the server's `AUTH_PASSWORD_VALIDATORS` talking. The
 *     link is still good, so the form stays up and only the message changes.
 *   - **A dead link** ends the screen. Re-typing cannot help, so the form is
 *     taken away rather than left as an affordance that can only fail; the exit
 *     is asking for a fresh link. `confirmPasswordReset` tags its Error with
 *     `.field` so this branch doesn't depend on the server's wording.
 *
 * On success the server blacklists every refresh token on the account, so this
 * device's session (if it had one) is already dead. The success copy says that
 * outright: a silent "please log in again" after a successful action reads as a
 * bug, and this one is a security guarantee. The AuthContext is left alone on
 * purpose — it owns the in-memory user, and its stored access token simply stops
 * refreshing; what this screen owes the user is the explanation and a way to
 * sign in, not a surprise logout mid-sentence.
 *
 * Success is a screen, not an immediate redirect, for that reason: bouncing
 * straight to /login would throw the explanation away at the one moment it is
 * needed. The button is the redirect, and it `replace`s so Back can't return to
 * a spent link.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { uid, token } = useLocalSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  // "form" | "done" | "dead-link"
  const [state, setState] = useState("form");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (password !== confirm) {
      // Purely local: the server only ever receives one of the two.
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const data = await confirmPasswordReset(uid, token, password);
      setMessage(data?.detail || "Your password has been reset. You can now log in.");
      setState("done");
    } catch (err) {
      // A dead link is terminal; a rejected password is not. Branch on the tag
      // the API wrapper attaches, never on the sentence.
      if (err?.field === "token") {
        setMessage(err.message);
        setState("dead-link");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (state === "done") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.h1}>Password changed</Text>
          <Text style={styles.notice}>{message}</Text>
          <Text style={styles.help}>
            Every device that was signed in to this account has been signed out,
            including this one — that's deliberate, so a reset locks out anyone
            who had your old password. Sign in again with the new one.
          </Text>
          <Pressable
            onPress={() => router.replace("/login")}
            style={styles.primaryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Go to sign in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "dead-link") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.h1}>This link has expired</Text>
          <Text style={styles.error}>{message}</Text>
          <Text style={styles.help}>
            Reset links are single-use and time-limited. Nothing has changed on
            your account — ask for a fresh link and try again.
          </Text>
          <Pressable
            onPress={() => router.replace("/login")}
            style={styles.primaryBtn}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Request a new link</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={styles.content}>
        <Text style={styles.h1}>Choose a new password</Text>
        <Text style={styles.help}>
          Setting a new password signs you out everywhere, so you'll need to sign
          in again with it straight afterwards.
        </Text>

        <TextInput
          placeholder="New password (min 8 chars)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          style={styles.input}
        />
        <TextInput
          placeholder="Confirm new password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
          style={styles.input}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          onPress={handleSubmit}
          disabled={busy}
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.goldText} />
          ) : (
            <Text style={styles.primaryBtnText}>Set new password</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace("/login")}>
          <Text style={styles.switch}>Back to sign in</Text>
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
  error: { color: colors.danger, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  notice: { color: colors.gold, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  primaryBtn: { backgroundColor: colors.gold, borderRadius: 6, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: colors.goldText, fontWeight: "700", fontSize: 15 },
  switch: { color: colors.gold, textAlign: "center", marginTop: 8, fontSize: 14 },
});
