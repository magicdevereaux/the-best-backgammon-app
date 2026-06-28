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
    background: "var(--gold)",
    color: "var(--on-gold)",
    borderColor: "var(--gold-dark)",
  },
  secondary: {
    background: "var(--surface)",
    color: "var(--ivory)",
    borderColor: "var(--border)",
  },
  disabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
};

function Btn({ label, onClick, disabled, variant = "secondary", title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
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
  mustUseMoreDice = false,
}) {
  const canRoll       = game.status === "active" && (!game.dice_values || game.dice_values.length === 0);
  const turnActive    = game.status === "active" && game.dice_values && game.dice_values.length > 0;
  // Backgammon requires using as many dice as legally possible. While more dice
  // could still be played (even via a different move order), block confirmation.
  // The server enforces the same rule — this is the matching UX affordance.
  const blockConfirm = turnActive && mustUseMoreDice;

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
        disabled={!turnActive || blockConfirm}
        title={blockConfirm ? "You must use as many dice as possible before confirming." : undefined}
      />
      {blockConfirm && (
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.8rem" }}>
          You must use as many dice as possible.
        </p>
      )}
      {game.status === "finished" && (
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
          Game over!{" "}
          <strong>{game.winner === "p1" ? game.player1_name : game.player2_name}</strong> wins.
        </p>
      )}
    </div>
  );
}
