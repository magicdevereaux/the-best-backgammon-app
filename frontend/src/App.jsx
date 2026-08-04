import React from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import GamePage from "./pages/GamePage";
import LobbyPage from "./pages/LobbyPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <nav style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", background: "var(--surface)", display: "flex", gap: "1rem", alignItems: "center" }}>
      <Link to="/">Lobby</Link>
      <span style={{ flex: 1 }} />
      {user === undefined ? null : user ? (
        <>
          <Link to="/profile" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>
            {user.username} — {user.wins}W / {user.losses}L
          </Link>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <>
          <Link to="/login">Log in</Link>
          <Link to="/register">Register</Link>
        </>
      )}
    </nav>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          {/* Exact shape of the emailed link: FRONTEND_BASE_URL + this path. */}
          <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
          {/* Likewise fixed by the server: the confirmation mail links to
              FRONTEND_BASE_URL + this path. Unauthenticated — the token is the
              credential, and the mail is often read on a logged-out device. */}
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
