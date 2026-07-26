import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { deleteAccount } from "../api/auth";
import { colors } from "../theme";

/*
 * Danger zone: permanent, in-app account deletion.
 *
 * App Store guideline 5.1.1(v) and Play's data-safety policy both require an
 * account-bearing app to offer deletion from inside the app, and both expect
 * it to be deliberate. Three gates, in order:
 *
 *   1. collapsed  — the destructive UI is not on screen until asked for.
 *   2. password   — the current password must be typed. It is re-checked
 *                   server-side, so this is real confirmation, not theatre.
 *   3. Alert      — the *platform* confirmation dialog with a `destructive`
 *                   button, which is the native idiom reviewers look for.
 *
 * `deleteAccount` clears SecureStore itself on success; `onDeleted` then drops
 * the in-memory auth state and navigates away.
 */
export default function DeleteAccountSection({ onDeleted }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setOpen(false);
    setPassword("");
    setError(null);
  }

  async function performDelete() {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (err) {
      // Stay on the password step, cleared, so a typo can be corrected.
      setError(err.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and stats. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ]
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Danger zone</Text>

      {!open ? (
        <>
          <Text style={styles.body}>
            Deleting your account is permanent. Your login and stats are removed.
            Games you have already played stay in your opponents' histories, with
            your seat no longer linked to an account.
          </Text>
          <Pressable
            onPress={() => setOpen(true)}
            style={styles.outlineBtn}
            accessibilityRole="button"
          >
            <Text style={styles.outlineBtnText}>Delete Account</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.body}>Confirm your password to continue.</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Current password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            onPress={confirmDelete}
            disabled={!password || busy}
            style={[styles.dangerBtn, (!password || busy) && styles.btnDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.dangerBtnText}>
              {busy ? "Deleting…" : "Permanently Delete My Account"}
            </Text>
          </Pressable>
          <Pressable onPress={close} disabled={busy} style={styles.cancelBtn} accessibilityRole="button">
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
  },
  heading: { color: colors.danger, fontSize: 16, fontWeight: "800" },
  body: { color: colors.textMuted, fontSize: 13, marginTop: 8, lineHeight: 18 },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 10 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
    marginTop: 12,
  },
  outlineBtnText: { color: colors.danger, fontWeight: "700" },
  dangerBtn: {
    backgroundColor: colors.danger,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  dangerBtnText: { color: colors.ivory, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },
  cancelBtn: { paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { color: colors.textMuted, fontWeight: "600" },
});
