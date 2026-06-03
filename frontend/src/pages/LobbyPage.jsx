import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGames, createGame } from "../api/gameApi";

export default function LobbyPage() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchGames()
      .then(setGames)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    const game = await createGame({ player1_name: "Player 1", player2_name: "Player 2" });
    navigate(`/game/${game.id}`);
  }

  if (loading) return <p>Loading games…</p>;

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Backgammon Lobby</h1>
      <button onClick={handleCreate}>New Game</button>

      <ul style={{ marginTop: "1rem" }}>
        {games.map((g) => (
          <li key={g.id}>
            <a href={`/game/${g.id}`}>Game #{g.id}</a> — {g.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
