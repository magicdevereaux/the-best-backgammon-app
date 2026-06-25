import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Board from "../components/Board";
import Dice from "../components/Dice";
import GameControls from "../components/GameControls";
import GameOverScreen from "../components/GameOverScreen";
import MatchScore from "../components/MatchScore";
import { useGame } from "../hooks/useGame";
import { useAuth } from "../context/AuthContext";
import { joinGame, createGame } from "../api/gameApi";
import { fetchMatch, nextGame } from "../api/matchApi";

const T = {
  page:    { minHeight: "100vh", background: "var(--bg)", color: "var(--ivory)", fontFamily: "system-ui, sans-serif", padding: "1.25rem" },
  heading: { margin: "0 0 0.25rem", fontWeight: 700, fontSize: "1.1rem", color: "var(--ivory)" },
  sub:     { margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--text-secondary)" },
  err:     { color: "var(--error)", fontSize: "0.85rem", marginTop: "0.5rem" },
  input:   { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ivory)", borderRadius: 5, padding: "0.45rem 0.7rem", fontSize: "0.85rem" },
  joinBtn: { padding: "0.5rem 1rem", background: "var(--gold)", color: "var(--on-gold)", border: "none", borderRadius: 5, fontWeight: 600, cursor: "pointer" },
};

export default function GamePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    game, loading, error, actionError,
    rollDice, stagedBoard, stagedDice,
    pendingMoves, legalMoves,
    stageMove, resetTurn, confirmTurn, reload,
  } = useGame(id);

  const [guestJoinName, setGuestJoinName] = useState("");
  const [joinError, setJoinError] = useState(null);
  const [match, setMatch] = useState(null);

  useEffect(() => {
    if (!game?.match) return;
    fetchMatch(game.match).then(setMatch).catch(() => {});
  }, [game?.match, game?.status]);

  if (loading) return <div style={T.page}><p style={{ color: "var(--text-secondary)" }}>Loading game…</p></div>;
  if (error)   return <div style={T.page}><p style={T.err}>Error: {error}</p></div>;
  if (!game)   return <div style={T.page}><p style={T.err}>Game not found.</p></div>;

  async function handleJoin() {
    setJoinError(null);
    const name = user ? undefined : guestJoinName;
    if (!user && !name) { setJoinError("Enter your name to join."); return; }
    try { await joinGame(id, name); reload(); }
    catch (err) { setJoinError(err.message); }
  }

  async function handleNextGame() {
    try { const g = await nextGame(game.match); navigate(`/game/${g.id}`); }
    catch (err) { console.error(err); }
  }

  async function handleRematch() {
    try {
      const g = await createGame({ player1_name: game.player1_name, player2_name: game.player2_name });
      navigate(`/game/${g.id}`);
    } catch (err) { console.error(err); }
  }

  if (game.status === "waiting") {
    return (
      <div style={T.page}>
        <h2 style={T.heading}>Game #{game.id}</h2>
        <p style={T.sub}>{game.player1_name} is waiting for an opponent.</p>
        <p style={{ ...T.sub, marginBottom: "1rem" }}>
          Share this link:{" "}
          <span style={{ color: "var(--gold)", fontFamily: "monospace" }}>{window.location.href}</span>
        </p>
        {!user && (
          <input
            style={{ ...T.input, marginRight: "0.5rem" }}
            placeholder="Your name"
            value={guestJoinName}
            onChange={(e) => setGuestJoinName(e.target.value)}
          />
        )}
        <button style={T.joinBtn} onClick={handleJoin}>
          {user ? `Join as ${user.username}` : "Join game"}
        </button>
        {joinError && <p style={T.err}>{joinError}</p>}
      </div>
    );
  }

  const turnName = game.current_turn === "p1" ? game.player1_name : game.player2_name;

  return (
    <div style={T.page}>
      {game.status === "finished" && (
        <GameOverScreen
          game={game}
          match={match}
          onNextGame={handleNextGame}
          onNewMatch={() => navigate("/")}
          onLobby={() => navigate("/")}
        />
      )}

      {match && <MatchScore match={match} />}

      <h2 style={T.heading}>{game.player1_name} vs {game.player2_name}</h2>
      {game.status === "active" && (
        <p style={T.sub}>{turnName}'s turn</p>
      )}

      <div style={{ overflowX: "auto" }}>
        <Board
          boardState={stagedBoard}
          currentPlayer={game.current_turn}
          legalMoves={legalMoves}
          onMove={stageMove}
        />
      </div>

      <Dice diceValues={stagedDice} />

      <GameControls
        game={game}
        onRollDice={rollDice}
        onResetTurn={resetTurn}
        onConfirmTurn={confirmTurn}
        hasPendingMoves={pendingMoves.length > 0}
      />

      {actionError && <p style={T.err}>{actionError}</p>}
    </div>
  );
}
