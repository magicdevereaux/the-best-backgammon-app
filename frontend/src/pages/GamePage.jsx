import React, { useState } from "react";
import { useParams } from "react-router-dom";
import Board from "../components/Board";
import Dice from "../components/Dice";
import GameControls from "../components/GameControls";
import { useGame } from "../hooks/useGame";
import { useAuth } from "../context/AuthContext";
import { joinGame } from "../api/gameApi";

export default function GamePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const {
    game,
    loading,
    error,
    actionError,
    rollDice,
    stagedBoard,
    stagedDice,
    pendingMoves,
    legalMoves,
    stageMove,
    resetTurn,
    confirmTurn,
    reload,
  } = useGame(id);

  const [guestJoinName, setGuestJoinName] = useState("");
  const [joinError, setJoinError] = useState(null);

  if (loading) return <p>Loading game…</p>;
  if (error) return <p>Error: {error}</p>;
  if (!game) return <p>Game not found.</p>;

  async function handleJoin() {
    setJoinError(null);
    const name = user ? undefined : guestJoinName;
    if (!user && !name) {
      setJoinError("Enter your name to join.");
      return;
    }
    try {
      await joinGame(id, name);
      reload();
    } catch (err) {
      setJoinError(err.message);
    }
  }

  if (game.status === "waiting") {
    return (
      <div style={{ padding: "1rem" }}>
        <h2>Game #{game.id}</h2>
        <p>{game.player1_name} is waiting for an opponent.</p>
        <p>
          Share this link to invite someone:{" "}
          <strong>{window.location.href}</strong>
        </p>
        {!user && (
          <input
            placeholder="Your name"
            value={guestJoinName}
            onChange={(e) => setGuestJoinName(e.target.value)}
            style={{ marginRight: "0.5rem" }}
          />
        )}
        <button onClick={handleJoin}>
          {user ? `Join as ${user.username}` : "Join game"}
        </button>
        {joinError && <p style={{ color: "#c0392b" }}>{joinError}</p>}
      </div>
    );
  }

  return (
    <div style={{ padding: "1rem" }}>
      <h2>Game #{game.id}</h2>
      <p>
        {game.player1_name} vs {game.player2_name}
        {game.status === "active" && (
          <> — Turn: {game.current_turn === "p1" ? game.player1_name : game.player2_name}</>
        )}
      </p>

      <Board
        boardState={stagedBoard}
        currentPlayer={game.current_turn}
        legalMoves={legalMoves}
        onMove={stageMove}
      />

      <Dice diceValues={stagedDice} />

      <GameControls
        game={game}
        onRollDice={rollDice}
        onResetTurn={resetTurn}
        onConfirmTurn={confirmTurn}
        hasPendingMoves={pendingMoves.length > 0}
      />

      {actionError && <p style={{ color: "#c0392b" }}>{actionError}</p>}
    </div>
  );
}
