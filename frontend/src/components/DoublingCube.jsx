import React from "react";

const S = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    margin: "0.75rem 0",
    flexWrap: "wrap",
  },
  cube: {
    width: 44,
    height: 44,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "1.15rem",
    background: "var(--ivory)",
    color: "#222",
    border: "2px solid var(--gold-dark)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
  },
  ownerLabel: { color: "var(--text-secondary)", fontSize: "0.85rem" },
  doubleBtn: {
    padding: "0.5rem 1rem",
    borderRadius: 6,
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: "pointer",
    background: "var(--surface)",
    color: "var(--gold)",
    border: "1px solid var(--gold-dark)",
  },
  prompt: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.6rem 0.9rem",
    borderRadius: 8,
    background: "var(--surface-raised)",
    border: "1px solid var(--gold-dark)",
    flexWrap: "wrap",
  },
  promptText: { fontWeight: 600, color: "var(--ivory)", fontSize: "0.9rem" },
  accept: {
    padding: "0.45rem 0.9rem",
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
    background: "var(--gold)",
    color: "var(--on-gold)",
    border: "1px solid var(--gold-dark)",
  },
  drop: {
    padding: "0.45rem 0.9rem",
    borderRadius: 6,
    fontWeight: 700,
    cursor: "pointer",
    background: "var(--surface)",
    color: "var(--error)",
    border: "1px solid var(--border)",
  },
  crawford: { color: "var(--text-secondary)", fontSize: "0.8rem", fontStyle: "italic" },
};

/**
 * Doubling cube display and controls.
 *
 * Position mirrors a physical cube: centered (no owner), or on the owner's
 * side — p1 left, p2 right. The Double button appears only when doubling is
 * legal (canOfferDouble comes from useGame; the server re-validates). When a
 * double is pending, the opponent gets an Accept / Drop prompt — the web
 * client is ungated, so in hotseat the same device answers.
 */
export default function DoublingCube({ game, canOfferDouble, onOfferDouble, onRespondToDouble }) {
  if (!game) return null;
  const value = game.cube_value ?? 1;
  const owner = game.cube_owner;
  const pending = game.double_offered_by;

  const ownerName =
    owner === "p1" ? game.player1_name : owner === "p2" ? game.player2_name : null;
  const offererName =
    pending === "p1" ? game.player1_name : game.player2_name;

  const justify =
    owner === "p1" ? "flex-start" : owner === "p2" ? "flex-end" : "center";

  return (
    <div>
      <div style={{ ...S.row, justifyContent: justify }}>
        <div style={S.cube} title="Doubling cube" data-testid="cube-value">
          {value}
        </div>
        <span style={S.ownerLabel}>
          {ownerName ? `Cube: ${ownerName}` : "Cube: centered"}
          {game.crawford_game ? " · Crawford game — no doubling" : ""}
        </span>
        {canOfferDouble && game.status === "active" && (
          <button style={S.doubleBtn} onClick={onOfferDouble}>
            Double to {value * 2}
          </button>
        )}
      </div>

      {pending && game.status === "active" && (
        <div style={S.prompt}>
          <span style={S.promptText}>
            {offererName} offers to double to {value * 2}.
          </span>
          <button style={S.accept} onClick={() => onRespondToDouble(true)}>
            Accept
          </button>
          <button style={S.drop} onClick={() => onRespondToDouble(false)}>
            Drop ({value} pt{value === 1 ? "" : "s"})
          </button>
        </div>
      )}
    </div>
  );
}
