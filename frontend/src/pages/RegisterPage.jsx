import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { register } from "../api/authApi";
import { useAuth } from "../context/AuthContext";

export default function RegisterPage() {
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await register(username, password, email);
      updateUser(user);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 360 }}>
      <h2>Create account</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Username<br />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Password (min 8 chars)<br />
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
        {/* Required as of ADR-003. It used to be optional, on the theory that
            insisting would shut out players who just want to play — but an
            account with no address can never recover a forgotten password, and
            can be forfeited on the 48-hour turn clock without ever being told.
            Both of those cost the player the account or the game, so the field
            asks once at the only moment it is cheap to answer. Verifying it is
            still optional: everything works unverified except the reminder mail
            itself, so nothing here waits on the confirmation link. */}
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Email<br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
            Used to reset a forgotten password, and to warn you when an online
            game is running out of time — that reminder is the only notice you
            get before an opponent can claim the win. We'll send a link to
            confirm the address; you can play straight away either way.
          </p>
        </div>
        {error && <p style={{ color: "var(--error)" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Register"}
        </button>
      </form>
      <p style={{ marginTop: "1rem" }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
