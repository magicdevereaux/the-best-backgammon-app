import React, { useState } from "react";
import { updateEmail } from "../api/authApi";

/*
 * Set, change or clear the account's email address (`PATCH /api/auth/me/`).
 *
 * This exists because email is optional at registration: an account created
 * without one — or created before the field existed — would otherwise have no
 * route to password recovery at all, permanently. Clearing is supported too
 * (submit an empty field), so opting back out stays possible.
 *
 * `initialEmail` is the server's value; `onSaved` receives the fresh
 * UserSerializer payload so the page can keep its copy in step.
 */
export default function EmailSettings({ initialEmail = "", onSaved }) {
  const [email, setEmail] = useState(initialEmail || "");
  const [status, setStatus] = useState(null); // null | "saved" | "cleared"
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const updated = await updateEmail(email);
      setStatus(email.trim() ? "saved" : "cleared");
      if (onSaved) onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="email-heading" style={{ marginTop: "2rem" }}>
      <h2 id="email-heading">Email</h2>
      <p style={{ color: "var(--text-secondary)" }}>
        Used only to reset your password. Leave it empty to remove it — you just
        won't be able to recover a forgotten password.
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
            />
          </label>
        </div>
        {error && <p style={{ color: "var(--error)" }}>{error}</p>}
        {status === "saved" && <p>Email address saved.</p>}
        {status === "cleared" && <p>Email address removed.</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save email"}
        </button>
      </form>
    </section>
  );
}
