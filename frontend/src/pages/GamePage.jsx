import React from "react";
import { useParams } from "react-router-dom";
import Board from "../components/Board";
import Dice from "../components/Dice";
import GameControls from "../components/GameControls";
import { useGame } from "../hooks/useGame";

export default function GamePage() {
  const { id } = useParams();
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
  } = useGame(id);

  if (loading) return <p>Loading game…</p>;
  if (error) return <p>Error: {error}</p>;
  if (!game) return <p>Game not found.</p>;

  return (
    <div style={{ padding: "1rem" }}>
      <h2>Game #{game.id}</h2>
      <p>
        {game.player1_name} vs {game.player2_name} — Turn:{" "}
        {game.current_turn === "p1" ? game.player1_name : game.player2_name}
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
