import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { confirmPasswordReset } from "../api/authApi";

/*
 * The landing page for the emailed reset link. The route shape is fixed by the
 * server: `build_password_reset_url` mails
 * `{FRONTEND_BASE_URL}/reset-password/{uid}/{token}`, so this must stay mounted
 * at exactly `/reset-password/:uid/:token`.
 *
 * The uid+token pair *is* the credential — no login required to get here. Both
 * are read straight from the URL and posted back untouched; a bad uid and a bad
 * token are deliberately indistinguishable in the server's reply, so there is
 * one "this link is no good" outcome rather than two.
 *
 * Success blacklists every outstanding refresh token for the account, so there
 * is no session to walk away with: the only next step is logging in again.
 */
export default function ResetPasswordPage() {
  const { uid, token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(uid, token, password);
      // Every session for this account was just revoked; log in with the new
      // password.
      navigate("/login");
    } catch (err) {
      // Either "this password reset link is invalid or has expired" or an
      // AUTH_PASSWORD_VALIDATORS rejection — both are the server's own wording.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 360 }}>
      <h2>Choose a new password</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            New password (min 8 chars)<br />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Confirm new password<br />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        </div>
        {error && <p style={{ color: "var(--error)" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Set new password"}
        </button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        <Link to="/forgot-password">Request a new link</Link>
      </p>
    </div>
  );
}
