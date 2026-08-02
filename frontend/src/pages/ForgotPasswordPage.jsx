import React, { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../api/authApi";

/*
 * "Forgot password?" — asks the server to mail a reset link.
 *
 * The one rule this screen has to hold: a hit and a miss must be
 * indistinguishable. The backend already returns a byte-identical 200 either
 * way, as an anti-enumeration measure, and a UI that branched on the outcome
 * would hand back the membership oracle the flat response exists to prevent.
 * So the success state is a single fixed string that never depends on the
 * response body, and there is no "no account with that address" path at all.
 */
const SENT_MESSAGE =
  "If an account with that email address exists, we've sent a password reset link to it. " +
  "Check your inbox — the link is only good once.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      // Only a malformed address or a transport failure lands here — never
      // "that account doesn't exist", which the server does not report.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 360 }}>
      <h2>Reset your password</h2>
      {sent ? (
        <>
          <p>{SENT_MESSAGE}</p>
          <p style={{ marginTop: "1rem" }}>
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      ) : (
        <>
          <p style={{ color: "var(--text-secondary)" }}>
            Enter the email address on your account and we'll send you a link to
            set a new password.
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
            <button type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p style={{ marginTop: "1rem" }}>
            <Link to="/login">Back to log in</Link>
          </p>
        </>
      )}
    </div>
  );
}
