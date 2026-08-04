import React, { useState } from "react";
import { updateTurnReminders } from "../api/authApi";

/*
 * Opt out of turn-reminder emails (`PATCH /api/auth/me/`).
 *
 * This control is what makes the preference real. `manage.py
 * send_turn_reminders` mails the player a game is waiting on when their
 * inactivity deadline is close — but the address it uses was collected for
 * password reset, not for game mail, so enrolling every account by default is
 * only defensible if switching it off takes one click from the profile. The
 * reminder footer names this setting by the label below; keep the two in step.
 *
 * `enabled` is the server's value and is always a real boolean — the default is
 * resolved server-side (UserSerializer.to_representation), so it is rendered as
 * given and never re-defaulted here.
 *
 * `email` and `emailVerified` come from the same payload and are *not*
 * cosmetic: they are the two conditions `send_turn_reminders` checks before it
 * will mail anyone, so either one missing means this switch cannot do what it
 * says whatever it is set to — and a toggle that silently does nothing is worse
 * than none. Both therefore disable it, with copy naming the actual blocker.
 *
 * Verification is the newer of the two (ADR-003) and the easier one to render
 * dishonestly: an unverified address *looks* like a working one on this screen,
 * so a switch left enabled over it would read as "reminders on" to the one user
 * who most needs to know they are off. Mirrors
 * mobile/src/components/TurnReminderSection.jsx — keep the copy in sync.
 */
export default function TurnReminderSettings({
  enabled,
  email = "",
  emailVerified = false,
  onSaved,
}) {
  const [checked, setChecked] = useState(enabled);
  const [status, setStatus] = useState(null); // null | "on" | "off"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const hasEmail = Boolean((email || "").trim());
  // The server's two preconditions for sending, mirrored. Kept as one name so
  // the disable rule and the explanation below cannot drift apart.
  const deliverable = hasEmail && Boolean(emailVerified);

  async function handleChange(e) {
    const next = e.target.checked;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const updated = await updateTurnReminders(next);
      // The server's answer, not the click: a save that came back the other way
      // must show the other way. On a rejection nothing moves at all, so the
      // box stays where it was rather than lying about a preference.
      const saved = updated.turn_reminder_emails;
      setChecked(saved);
      setStatus(saved ? "on" : "off");
      if (onSaved) onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="reminders-heading" style={{ marginTop: "2rem" }}>
      <h2 id="reminders-heading">Turn reminders</h2>
      <p style={{ color: "var(--text-secondary)" }}>
        When it's your turn in an online game and your time to move is running
        out, we'll email you. Switch this off and no warning is sent — your
        opponent can still claim the win the moment your clock expires, so you
        can be forfeited without ever hearing about it.
      </p>
      <div style={{ marginBottom: "0.75rem" }}>
        <label>
          <input
            type="checkbox"
            checked={!!checked}
            disabled={busy || !deliverable}
            onChange={handleChange}
          />{" "}
          Turn reminder emails
        </label>
      </div>
      {!hasEmail && (
        <p style={{ color: "var(--text-secondary)" }}>
          No email address is saved on your account, so reminders can't be sent
          no matter what this is set to. Add an address above and save it to
          turn them on.
        </p>
      )}
      {/* Deliberately not a re-run of EmailSettings' "this address isn't
          confirmed yet" sentence, which sits a few inches up the same page.
          Repeating it would read as a stutter, and it buries what this section
          is actually telling you — that reminders are off right now. Lead with
          the consequence and point at the fix. */}
      {hasEmail && !emailVerified && (
        <p style={{ color: "var(--text-secondary)" }}>
          Reminders are paused until your email address is confirmed. Open the
          link we emailed you — or send another from the email section above —
          and this switches on by itself.
        </p>
      )}
      {error && <p style={{ color: "var(--error)" }}>{error}</p>}
      {status === "on" && <p>Turn reminder emails are on.</p>}
      {status === "off" && <p>Turn reminder emails are off.</p>}
      {busy && <p>Saving…</p>}
    </section>
  );
}
