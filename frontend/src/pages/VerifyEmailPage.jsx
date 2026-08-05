import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { confirmEmailVerification } from "../api/authApi";
import { isMobileBrowser, verifyEmailAppUrl } from "../utils/appLink";

/*
 * The landing page for the emailed confirmation link. The route shape is fixed
 * by the server, which mails `{FRONTEND_BASE_URL}/verify-email/{token}`, so this
 * must stay mounted at exactly `/verify-email/:token` — same integration
 * contract as ResetPasswordPage, and just as unforgiving if it drifts.
 *
 * The token *is* the credential, so no login is required to get here and the
 * page asks for nothing: it posts on mount and reports the outcome. There is no
 * form to submit because there is nothing left for the user to supply, and
 * making them press a button to confirm that yes, they did click the link they
 * just clicked, would only add a way to fail.
 *
 * The effect guards against a second POST. React 18's StrictMode double-invokes
 * effects in development, and the server is idempotent so a repeat is harmless
 * — but it would flash the outcome twice, and the guard is one line.
 *
 * Nothing here is a gate. An unconfirmed address costs the account exactly one
 * thing: turn-reminder emails, which the server refuses to send to an
 * unconfirmed address. So even the failure branch is a nudge to the profile,
 * where Resend lives, and never a dead end or a demand to try again before
 * playing.
 *
 * On a phone the page also offers a hand-off into the native app
 * (`backgammon://verify-email/{token}` — see ../utils/appLink). It sits in the
 * *success* branch, after the POST has already landed, and that ordering is
 * safe here for a reason that does not generalise: confirmation is idempotent
 * server-side, so the token surviving into a second consumer costs nothing. The
 * app re-confirming an address this page just confirmed is a 200 either way.
 * (ResetPasswordPage has the opposite constraint and offers its hand-off
 * *before* submitting — changing the password kills the token.)
 *
 * It is an addition, never a redirect: the browser flow above it is already
 * complete by the time the link renders, so a visitor who taps nothing has lost
 * nothing.
 */
export default function VerifyEmailPage() {
  const { token } = useParams();
  // "pending" | "confirmed" | "failed"
  const [state, setState] = useState("pending");
  const [message, setMessage] = useState(null);
  // Read once per mount rather than per render — the user-agent cannot change
  // under a mounted page, and this keeps the branch below out of render-loop
  // territory.
  const [showAppLink] = useState(isMobileBrowser);

  useEffect(() => {
    let cancelled = false;
    confirmEmailVerification(token)
      .then((data) => {
        if (cancelled) return;
        setState("confirmed");
        setMessage(data?.detail || "Your email address is confirmed.");
      })
      .catch((err) => {
        if (cancelled) return;
        setState("failed");
        // The server's own wording: "This verification link is invalid or has
        // expired." A link is only ever dead one way as far as the user cares.
        setMessage(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div style={{ padding: "2rem", maxWidth: 420 }}>
      <h2>Confirm your email</h2>

      {state === "pending" && <p>Checking your link…</p>}

      {state === "confirmed" && (
        <>
          <p>{message}</p>
          <p style={{ color: "var(--text-secondary)" }}>
            Turn reminders can now reach you, so you'll get a warning before an
            online game runs out of time.
          </p>
          {showAppLink && (
            <p style={{ marginTop: "1rem" }}>
              <a
                href={verifyEmailAppUrl(token)}
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
            </p>
          )}
          <p style={{ marginTop: "1rem" }}>
            <Link to="/">Back to the lobby</Link>
          </p>
        </>
      )}

      {state === "failed" && (
        <>
          <p style={{ color: "var(--error)" }}>{message}</p>
          <p style={{ color: "var(--text-secondary)" }}>
            Nothing is locked — your account works exactly as before. The one
            thing an unconfirmed address costs you is turn reminders, the only
            warning you get before an opponent can claim a game you've run out
            of time on. Send yourself a fresh link from your profile.
          </p>
          <p style={{ marginTop: "1rem" }}>
            <Link to="/profile">Go to your profile</Link>
          </p>
        </>
      )}
    </div>
  );
}
