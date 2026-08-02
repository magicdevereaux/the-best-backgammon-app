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
        {/* Optional on purpose: an address is the only route to password
            recovery, but requiring one would shut out players who just want to
            play. Say what it buys instead of insisting. */}
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Email (optional)<br />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
            Only used to reset your password. Without one, a forgotten password
            can't be recovered. You can add it later from your profile.
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
