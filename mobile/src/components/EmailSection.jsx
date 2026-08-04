import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { updateEmail, resendEmailVerification } from "../api/auth";
import { colors } from "../theme";

/*
 * Change the account's email address, and report honestly whether it has been
 * confirmed (PATCH /api/auth/me/, POST /api/auth/verify-email/resend/).
 *
 * Email is **required at registration** as of ADR-003, so this is no longer the
 * only route to password recovery for an address-less account — it is the change
 * form, plus the one place the app admits an address is unconfirmed. Two things
 * follow from that requirement and both are load-bearing here:
 *
 *   - **There is no remove control.** The server rejects a blank address now, so
 *     a "Remove Email" button could only ever produce a 400. It was removed
 *     rather than left to fail politely; an affordance that cannot succeed is a
 *     worse lie than no affordance.
 *   - **Accounts predating the requirement can still have no address**, so the
 *     empty case is a real state and still gets its own copy. It is a gap to
 *     fill, not an option to weigh.
 *
 * Verification gates *nothing* about playing — an unconfirmed account is a fully
 * working account. It gates exactly one thing, turn-reminder mail, which the
 * server refuses to send to an unconfirmed address. That is the consequence
 * worth naming, because it is invisible: the player would simply never be warned
 * before losing a game on its 48-hour clock.
 *
 * The confirmation link opens the **web** client — there is no mobile deep link,
 * same as password reset — so the copy says "in your browser" rather than
 * implying the app will catch it.
 *
 * `emailVerified` is the payload's read-only `email_verified`. It seeds local
 * state rather than being read straight through, because two actions here change
 * it before the parent refetches: saving a *different* address makes the account
 * unconfirmed again, and a resend can come back saying it was already confirmed
 * (someone finished it in a browser meanwhile). Both answers come from the
 * server's response, never from what was clicked.
 *
 * `onUpdated` receives the fresh user payload the PATCH returns (same shape as
 * GET /api/auth/me/), so the caller can keep its cached user in step.
 */
export default function EmailSection({ email, emailVerified, onUpdated }) {
  const [value, setValue] = useState(email || "");
  const [verified, setVerified] = useState(Boolean(emailVerified));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const current = (email || "").trim();
  const next = value.trim();
  // Saving needs a changed *and* non-empty value: blanking is a 400 now, so the
  // button simply never offers it.
  const canSave = next !== "" && next !== current;

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const user = await updateEmail(next);
      setValue(user?.email ?? next);
      setVerified(Boolean(user?.email_verified));
      setNotice("Email address saved.");
      if (onUpdated) onUpdated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const res = await resendEmailVerification();
      // Two different 200s land here. `email_verified: true` means the address
      // was already confirmed and this badge was stale — take the server's word
      // and stop nagging.
      setVerified(Boolean(res?.email_verified));
      setNotice(res?.detail || "Confirmation email sent.");
    } catch (err) {
      // The 60-second cool-down is not a failure: it means a confirmation mail
      // is already on its way, which is exactly what was asked for. Show the
      // server's sentence as a notice. Anything else (a 400 for an account with
      // no address, a network fault) is a real error.
      if (err?.status === 429) setNotice(err.message);
      else setError(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Email address</Text>

      {!current ? (
        <Text style={styles.body}>
          Your account has no email address. Add one so you can reset your
          password if you forget it, and so we can warn you before an online
          game is forfeited on its 48-hour clock.
        </Text>
      ) : verified ? (
        <Text style={styles.body}>
          <Text style={styles.confirmed}>Confirmed.</Text> Used for password
          reset links and turn reminders. Saving a different address here will
          need confirming again.
        </Text>
      ) : (
        <Text style={styles.body}>
          <Text style={styles.unconfirmed}>Not confirmed yet.</Text> Your
          account works normally and nothing about playing is affected — but we
          won't send turn reminders to an unconfirmed address, so you'd get no
          warning before a game is forfeited on its 48-hour clock. Check your
          inbox for the confirmation link; it opens in your browser, not in the
          app.
        </Text>
      )}

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

      <View style={styles.btnRow}>
        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.btn, (!canSave || busy) && styles.btnDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>{busy ? "Saving…" : "Save Email"}</Text>
        </Pressable>

        {current && !verified ? (
          <Pressable
            onPress={resend}
            disabled={resending}
            style={[styles.secondaryBtn, resending && styles.btnDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>
              {resending ? "Sending…" : "Resend confirmation"}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  confirmed: { color: colors.gold, fontWeight: "700" },
  unconfirmed: { color: colors.danger, fontWeight: "700" },
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
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
  },
  btnText: { color: colors.goldText, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
  },
  secondaryBtnText: { color: colors.text, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },
});
