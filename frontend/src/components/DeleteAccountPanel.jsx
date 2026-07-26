import React, { useState } from "react";
import { deleteAccount } from "../api/authApi";

/*
 * Danger zone: permanent, in-app account deletion.
 *
 * Both app stores require this path to exist for any app with accounts, and
 * both expect it to be deliberate rather than a single stray tap. Three gates,
 * in order:
 *
 *   1. "closed"  — a plain link-ish button; the destructive UI isn't even on
 *                  screen until asked for.
 *   2. "form"    — the user must type their current password. It is also
 *                  re-checked server-side, so this is confirmation, not
 *                  security theatre.
 *   3. "confirm" — an explicit last-chance yes/no spelling out what is lost.
 *
 * On success the parent's `onDeleted` runs (clear auth state + redirect); the
 * tokens themselves are already cleared inside `deleteAccount`.
 */
export default function DeleteAccountPanel({ onDeleted }) {
  const [stage, setStage] = useState("closed"); // closed | form | confirm
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStage("closed");
    setPassword("");
    setError(null);
  }

  function handleContinue(e) {
    e.preventDefault();
    setError(null);
    setStage("confirm");
  }

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (err) {
      // Back to the password step so a mistyped password can be corrected.
      setError(err.message);
      setStage("form");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="danger-zone-heading"
      style={{
        marginTop: "2.5rem",
        border: "1px solid var(--error, #8B1A1A)",
        borderRadius: 8,
        padding: "1rem",
      }}
    >
      <h2 id="danger-zone-heading" style={{ marginTop: 0, color: "var(--error, #8B1A1A)" }}>
        Danger zone
      </h2>

      {stage === "closed" && (
        <>
          <p style={{ color: "var(--text-secondary)" }}>
            Deleting your account is permanent. Your username, login and stats are
            removed. Games you have already played stay in your opponents'
            histories, with your seat no longer linked to an account.
          </p>
          <button type="button" onClick={() => setStage("form")}>
            Delete my account
          </button>
        </>
      )}

      {stage === "form" && (
        <form onSubmit={handleContinue}>
          <p style={{ color: "var(--text-secondary)" }}>
            Confirm your password to continue.
          </p>
          <div style={{ marginBottom: "0.75rem" }}>
            <label>
              Current password<br />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          </div>
          {error && <p style={{ color: "var(--error, #8B1A1A)" }}>{error}</p>}
          <button type="submit" disabled={!password}>
            Continue
          </button>{" "}
          <button type="button" onClick={reset}>
            Cancel
          </button>
        </form>
      )}

      {stage === "confirm" && (
        <>
          <p style={{ fontWeight: "bold" }}>
            Permanently delete your account? This cannot be undone.
          </p>
          {error && <p style={{ color: "var(--error, #8B1A1A)" }}>{error}</p>}
          <button type="button" onClick={handleDelete} disabled={busy}>
            {busy ? "Deleting…" : "Yes, delete my account"}
          </button>{" "}
          <button type="button" onClick={reset} disabled={busy}>
            Cancel
          </button>
        </>
      )}
    </section>
  );
}
