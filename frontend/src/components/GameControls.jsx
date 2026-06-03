import React from "react";

export default function GameControls({ game, onRollDice }) {
  const canRoll =
    game.status === "active" &&
    (!game.dice_values || game.dice_values.length === 0);

  return (
    <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
      <button onClick={onRollDice} disabled={!canRoll}>
        Roll Dice
      </button>

      {game.status === "finished" && (
        <p>
          Game over! Winner:{" "}
          {game.winner === "p1" ? game.player1_name : game.player2_name}
        </p>
      )}
    </div>
  );
}
