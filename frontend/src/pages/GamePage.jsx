import React from "react";
import { useParams } from "react-router-dom";
import Board from "../components/Board";
import Dice from "../components/Dice";
import GameControls from "../components/GameControls";
import { useGame } from "../hooks/useGame";

export default function GamePage() {
  const { id } = useParams();
  const { game, loading, error, actionError, rollDice, moveChecker } = useGame(id);

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
        boardState={game.board_state}
        currentPlayer={game.current_turn}
        onMove={moveChecker}
      />

      <Dice diceValues={game.dice_values} />

      <GameControls
        game={game}
        onRollDice={rollDice}
      />

      {actionError && <p style={{ color: "#c0392b" }}>{actionError}</p>}
    </div>
  );
}
