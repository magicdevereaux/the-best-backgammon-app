import React, { useState } from "react";
import { updateEmail, resendEmailVerification } from "../api/authApi";

/*
 * Change the account's email address, and confirm it (`PATCH /api/auth/me/`
 * plus `POST /api/auth/verify-email/resend/`).
 *
 * Email is required at registration as of ADR-003, so this is no longer the
 * "you forgot to give us one" panel — it is where an address gets corrected
 * after a typo, moved to a new mailbox, or confirmed when the first mail went
 * astray. **Clearing is gone**: the server rejects a blank address, because an
 * account with none can neither recover its password nor be warned before the
 * 48-hour turn clock forfeits a game. Wanting the mail to stop is what the
 * turn-reminder toggle below is for; wanting the address gone entirely means
 * deleting the account.
 *
 * Verification gates exactly one thing — the reminder mail, which the server
 * refuses to send to an unconfirmed address — so the unverified state is stated
 * with its one consequence and a Resend button, never as a wall. Both 200
 * outcomes and the 60-second cool-down 429 are ordinary messages here, not
 * errors; see resendEmailVerification for why the throttle resolves rather than
 * rejects.
 *
 * `initialEmail` / `initialVerified` are the server's values; `onSaved`
 * receives the fresh UserSerializer payload so the page can keep its copy in
 * step. Both pieces of local state are only ever moved by a server response —
 * changing an address resets `email_verified`, and it is the PATCH reply that
 * says so, not an assumption made here.
 */
export default function EmailSettings({
  initialEmail = "",
  initialVerified = false,
  onSaved,
}) {
  const [email, setEmail] = useState(initialEmail || "");
  // The address the server currently holds — distinct from the draft in the
  // input. A half-typed replacement must not relabel the confirmed badge, which
  // still describes the saved one until a PATCH succeeds.
  const [savedEmail, setSavedEmail] = useState(initialEmail || "");
  const [verified, setVerified] = useState(Boolean(initialVerified));
  const [status, setStatus] = useState(null); // null | "saved"
  const [notice, setNotice] = useState(null); // the resend endpoint's own words
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  function reset() {
    setError(null);
    setStatus(null);
    setNotice(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      const updated = await updateEmail(email);
      // The server's answer, not the submission: a changed address comes back
      // unverified, and this is where that is learned.
      setSavedEmail(updated?.email ?? email.trim());
      setVerified(Boolean(updated?.email_verified));
      setStatus("saved");
      if (onSaved) onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    reset();
    setResending(true);
    try {
      const result = await resendEmailVerification();
      setNotice(result.detail);
      // A 429 says nothing about verification state, so only a real 200 is
      // allowed to move the badge — and it may well move it to *confirmed*, if
      // the link was clicked in another tab while this page sat open.
      if (!result.throttled && typeof result.email_verified === "boolean") {
        setVerified(result.email_verified);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  const hasSavedEmail = Boolean((savedEmail || "").trim());

  return (
    <section aria-labelledby="email-heading" style={{ marginTop: "2rem" }}>
      <h2 id="email-heading">Email</h2>
      <p style={{ color: "var(--text-secondary)" }}>
        Used to reset a forgotten password, and to warn you when an online game
        is running out of time. It can be changed but not removed — delete your
        account if you want it gone, or switch off turn reminders below if you
        only want the mail to stop.
      </p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Email address<br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
        </div>
        {error && <p style={{ color: "var(--error)" }}>{error}</p>}
        {status === "saved" && <p>Email address saved.</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save email"}
        </button>
      </form>

      {hasSavedEmail &&
        (verified ? (
          <p style={{ marginTop: "1rem", color: "var(--text-secondary)" }}>
            This address is confirmed.
          </p>
        ) : (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ color: "var(--text-secondary)" }}>
              This address isn't confirmed yet. Everything else works normally —
              the one thing it costs you is turn reminders, which we won't send
              to an unconfirmed address. That reminder is the only warning
              before an opponent can claim a game you've run out of time on, so
              open the link we emailed you, or send another.
            </p>
            <button type="button" onClick={handleResend} disabled={resending}>
              {resending ? "Sending…" : "Resend confirmation email"}
            </button>
          </div>
        ))}

      {notice && <p style={{ marginTop: "0.5rem" }}>{notice}</p>}
    </section>
  );
}
