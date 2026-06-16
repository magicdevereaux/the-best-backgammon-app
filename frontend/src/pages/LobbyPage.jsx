import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, fetchLobby, joinGame } from "../api/gameApi";
import { useAuth } from "../context/AuthContext";

export default function LobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openGames, setOpenGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joinName, setJoinName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    fetchLobby()
      .then(setOpenGames)
      .catch(() => setOpenGames([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreateOnline() {
    setActionError(null);
    try {
      const game = await createGame({});
      navigate(`/game/${game.id}`);
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleCreateHotseat() {
    setActionError(null);
    const p1 = user ? user.username : (guestName || "Player 1");
    try {
      const game = await createGame({ player1_name: p1, player2_name: "Player 2" });
      navigate(`/game/${game.id}`);
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleJoin(gameId) {
    setActionError(null);
    try {
      const name = user ? undefined : joinName;
      if (!user && !name) {
        setActionError("Enter your name to join as a guest.");
        return;
      }
      await joinGame(gameId, name);
      navigate(`/game/${gameId}`);
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (loading) return <p>Loading lobby…</p>;

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Backgammon Lobby</h1>

      {actionError && <p style={{ color: "#c0392b" }}>{actionError}</p>}

      <section style={{ marginBottom: "2rem" }}>
        <h2>Start a game</h2>

        {user ? (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button onClick={handleCreateOnline}>
              Create online game (shareable link)
            </button>
            <button onClick={handleCreateHotseat}>
              Hotseat (local 2-player)
            </button>
          </div>
        ) : (
          <div>
            <p style={{ color: "#555" }}>
              <a href="/login">Log in</a> to create an online game, or play hotseat as guest:
            </p>
            <input
              placeholder="Your name (optional)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              style={{ marginRight: "0.5rem" }}
            />
            <button onClick={handleCreateHotseat}>Hotseat</button>
          </div>
        )}
      </section>

      <section>
        <h2>Open games</h2>
        {openGames.length === 0 ? (
          <p>No open games right now.</p>
        ) : (
          <>
            {!user && (
              <div style={{ marginBottom: "0.75rem" }}>
                <input
                  placeholder="Your name to join as guest"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                />
              </div>
            )}
            <ul style={{ listStyle: "none", padding: 0 }}>
              {openGames.map((g) => (
                <li key={g.id} style={{ marginBottom: "0.5rem" }}>
                  <strong>Game #{g.id}</strong> — {g.player1_name} is waiting
                  <button
                    onClick={() => handleJoin(g.id)}
                    style={{ marginLeft: "1rem" }}
                  >
                    Join
                  </button>
                  <a
                    href={`/game/${g.id}`}
                    style={{ marginLeft: "0.75rem", fontSize: "0.85rem" }}
                  >
                    Spectate / share link
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
