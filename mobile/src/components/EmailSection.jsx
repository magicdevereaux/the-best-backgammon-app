import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { updateEmail } from "../api/auth";
import { colors } from "../theme";

/*
 * Set, change or clear the account's email address (PATCH /api/auth/me/).
 *
 * This exists because email is *optional* at registration: an account created
 * without one — or created before the field was collected at all — would
 * otherwise have no route to password recovery ever, since the reset endpoint
 * only matches non-blank addresses. Clearing is supported too (send ""), so
 * opting back out is possible.
 *
 * `onUpdated` receives the fresh user payload the PATCH returns (same shape as
 * GET /api/auth/me/), so the caller can keep its cached user in step.
 */
export default function EmailSection({ email, onUpdated }) {
  const [value, setValue] = useState(email || "");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const current = (email || "").trim();
  const next = value.trim();
  const dirty = next !== current;
  const clearing = current !== "" && next === "";

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const user = await updateEmail(next);
      setValue(user?.email ?? next);
      setNotice(next ? "Email address saved." : "Email address removed.");
      if (onUpdated) onUpdated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Email address</Text>
      <Text style={styles.body}>
        {current
          ? "Used only to send you a password reset link. Clear the field and save to remove it."
          : "Optional. Add one so you can reset your password if you forget it — without an address, we have no way to reach your account."}
      </Text>

      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="you@example.com"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Pressable
        onPress={save}
        disabled={!dirty || busy}
        style={[styles.btn, (!dirty || busy) && styles.btnDisabled]}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>
          {busy ? "Saving…" : clearing ? "Remove Email" : "Save Email"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginTop: 18,
  },
  heading: { color: colors.text, fontSize: 16, fontWeight: "800" },
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
  notice: { color: colors.gold, fontSize: 13, marginTop: 10 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
    marginTop: 12,
  },
  btnText: { color: colors.goldText, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },
});
