import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, fetchLobby, joinGame } from "../api/gameApi";
import { createMatch } from "../api/matchApi";
import { useAuth } from "../context/AuthContext";

export default function LobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [openGames, setOpenGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joinName, setJoinName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [actionError, setActionError] = useState(null);

  // Match creation state
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [matchPoints, setMatchPoints] = useState(5);
  const [matchP2Name, setMatchP2Name] = useState("");

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

  async function handleCreateMatch() {
    setActionError(null);
    const p1 = user ? user.username : (guestName || "Player 1");
    const p2 = matchP2Name || "Player 2";
    try {
      const match = await createMatch({
        target_points: matchPoints,
        player1_name: p1,
        player2_name: p2,
      });
      navigate(`/game/${match.current_game_id}`);
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

      {actionError && <p style={{ color: "var(--error)" }}>{actionError}</p>}

      <section style={{ marginBottom: "2rem" }}>
        <h2>Start a game</h2>

        {!user && (
          <div style={{ marginBottom: "0.75rem" }}>
            <input
              placeholder="Your name (optional)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              style={{ marginRight: "0.5rem" }}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {user && (
            <button onClick={handleCreateOnline}>
              Create online game (shareable link)
            </button>
          )}
          <button onClick={handleCreateHotseat}>
            Single game — hotseat
          </button>
          <button onClick={() => setShowMatchForm((v) => !v)}>
            {showMatchForm ? "Cancel match" : "Match (first to N points)"}
          </button>
        </div>

        {showMatchForm && (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "1rem",
              maxWidth: 340,
              background: "var(--surface)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>New match</h3>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Match length:{" "}
              <select
                value={matchPoints}
                onChange={(e) => setMatchPoints(Number(e.target.value))}
              >
                <option value={3}>First to 3</option>
                <option value={5}>First to 5</option>
                <option value={7}>First to 7</option>
                <option value={9}>First to 9</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              Player 2 name:{" "}
              <input
                placeholder="Player 2"
                value={matchP2Name}
                onChange={(e) => setMatchP2Name(e.target.value)}
              />
            </label>
            <button onClick={handleCreateMatch}>Start match</button>
          </div>
        )}

        {!user && (
          <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
            <a href="/login">Log in</a> to create online games.
          </p>
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
