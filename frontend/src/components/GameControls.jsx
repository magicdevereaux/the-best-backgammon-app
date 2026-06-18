import React from "react";

const btn = {
  base: {
    padding: "0.55rem 1.1rem",
    borderRadius: 6,
    fontSize: "0.85rem",
    fontWeight: 600,
    fontFamily: "system-ui, sans-serif",
    letterSpacing: "0.03em",
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "opacity 0.15s, filter 0.15s",
  },
  primary: {
    background: "#C8952A",
    color: "#1A0A02",
    borderColor: "#A07020",
  },
  secondary: {
    background: "#2A3A2E",
    color: "#A0C0A8",
    borderColor: "#3A5040",
  },
  disabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
};

function Btn({ label, onClick, disabled, variant = "secondary" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btn.base,
        ...(variant === "primary" ? btn.primary : btn.secondary),
        ...(disabled ? btn.disabled : {}),
      }}
    >
      {label}
    </button>
  );
}

export default function GameControls({
  game,
  onRollDice,
  onResetTurn,
  onConfirmTurn,
  hasPendingMoves = false,
}) {
  const canRoll       = game.status === "active" && (!game.dice_values || game.dice_values.length === 0);
  const turnActive    = game.status === "active" && game.dice_values && game.dice_values.length > 0;

  return (
    <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
      <Btn
        label="Roll Dice"
        onClick={onRollDice}
        disabled={!canRoll}
        variant="primary"
      />
      <Btn
        label="Reset Turn"
        onClick={onResetTurn}
        disabled={!turnActive || !hasPendingMoves}
      />
      <Btn
        label="Confirm Turn"
        onClick={onConfirmTurn}
        disabled={!turnActive}
      />
      {game.status === "finished" && (
        <p style={{ margin: 0, color: "#A0C0A8", fontSize: "0.85rem" }}>
          Game over!{" "}
          <strong>{game.winner === "p1" ? game.player1_name : game.player2_name}</strong> wins.
        </p>
      )}
    </div>
  );
}
