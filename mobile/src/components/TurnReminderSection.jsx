import React, { useState } from "react";
import { View, Text, Switch, StyleSheet } from "react-native";
import { updateTurnReminders } from "../api/auth";
import { colors } from "../theme";

/*
 * Opt out of turn-reminder emails (PATCH /api/auth/me/).
 *
 * This control is what makes the preference real. `manage.py
 * send_turn_reminders` mails the player a game is waiting on when their
 * inactivity deadline is close — but the address it uses was collected for
 * password reset, not for game mail, so enrolling every account by default is
 * only defensible if switching it off is one tap from the profile. The reminder
 * footer names this setting by the label below; keep the two in step.
 *
 * `enabled` is the server's value and is always a real boolean — the default is
 * resolved server-side (UserSerializer.to_representation), so it is rendered as
 * given and never re-defaulted here.
 *
 * `email` comes from the same payload and is *not* cosmetic: an account with no
 * address on file cannot be mailed whatever this says, and a toggle that
 * silently does nothing is worse than none. Mirrors
 * frontend/src/components/TurnReminderSettings.jsx — keep the copy in sync.
 */
export default function TurnReminderSection({ enabled, email, onUpdated }) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const hasEmail = Boolean((email || "").trim());

  async function toggle(next) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const user = await updateTurnReminders(next);
      // The server's answer, not the tap: a save that came back the other way
      // must show the other way, and a rejection must move nothing at all
      // rather than leave the switch lying about a preference.
      const saved = user?.turn_reminder_emails;
      setChecked(saved);
      setNotice(saved ? "Turn reminder emails are on." : "Turn reminder emails are off.");
      if (onUpdated) onUpdated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Turn reminders</Text>
      <Text style={styles.body}>
        When it's your turn in an online game and your time to move is running
        out, we'll email you. Switch this off and no warning is sent — your
        opponent can still claim the win the moment your clock expires, so you
        can be forfeited without ever hearing about it.
      </Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Turn reminder emails</Text>
        <Switch
          testID="turn-reminder-switch"
          accessibilityLabel="Turn reminder emails"
          value={!!checked}
          disabled={busy || !hasEmail}
          onValueChange={toggle}
          trackColor={{ true: colors.gold, false: colors.border }}
        />
      </View>

      {!hasEmail ? (
        <Text style={styles.body}>
          No email address is saved on your account, so reminders can't be sent
          no matter what this is set to. Add an address above and save it to
          turn them on.
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: "600", flexShrink: 1, paddingRight: 12 },
  error: { color: colors.danger, fontSize: 13, marginTop: 10 },
  notice: { color: colors.gold, fontSize: 13, marginTop: 10 },
});
