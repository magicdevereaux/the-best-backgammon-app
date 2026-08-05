import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { confirmPasswordReset } from "../api/authApi";
import { isMobileBrowser, resetPasswordAppUrl } from "../utils/appLink";

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
 *
 * On a phone the page also offers a hand-off into the native app
 * (`backgammon://reset-password/{uid}/{token}` — see ../utils/appLink), and
 * *where* it sits is the one real correctness question on this page. The
 * uid+token pair is a single-use credential: the moment `confirmPasswordReset`
 * succeeds, the token stops verifying, because Django's default token generator
 * hashes the current password into the token. So the hand-off has to be offered
 * **before** the form is submitted — above it, where it is the first thing read
 * — and must disappear once the reset lands. Offering it afterwards would ship
 * the user into the app holding a link the app can only fail to use, and the
 * failure would look like the app's fault. (VerifyEmailPage is the mirror image:
 * confirmation is idempotent, so its hand-off is safe to show *after* the POST.)
 *
 * It is an addition, never a redirect or a gate — the form below it is fully
 * functional on its own, and it has to be, because a custom-scheme navigation
 * on a device without the app installed fails silently and unrecoverably.
 */
export default function ResetPasswordPage() {
  const { uid, token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Set the instant the reset succeeds, purely to retract the app hand-off. The
  // navigate() below normally unmounts this page a tick later and makes the
  // point moot — but "normally" is doing too much work to hang a dead
  // credential's visibility on, and this costs one boolean.
  const [done, setDone] = useState(false);
  // Read once per mount; the user-agent cannot change under a mounted page.
  const [isMobile] = useState(isMobileBrowser);

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
      // The link in the address bar is spent from here on — retract the app
      // hand-off before anything else.
      setDone(true);
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
      {isMobile && !done && (
        <div style={{ marginBottom: "1.25rem" }}>
          <a
            href={resetPasswordAppUrl(uid, token)}
            style={{
              display: "inline-block",
              padding: "0.6rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: "var(--ivory)",
              textDecoration: "none",
            }}
          >
            Open in the app
          </a>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
            Or just set it here — this page works on its own.
          </p>
        </div>
      )}
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
