import React, { useState } from "react";

/*
 * The control for claiming a win against an opponent who stopped moving.
 *
 * Shaped like AbandonGamePanel, but the opposite thing: `abandon` closes out a
 * game nobody can win and changes no score, whereas this **ends the game with a
 * real winner and real points** (one point times the cube value, see
 * docs/decisions/adr-002-inactivity-forfeit.md). The copy has to be plain about
 * that, and the act needs a second, explicit yes — this takes someone's game
 * away from them.
 *
 * Rendered only when utils/seats.canClaimTimeout says so; the server re-checks
 * the clock and may still refuse (see gameApi.claimTimeout).
 */
export default function ClaimTimeoutPanel({ opponentName, onClaim }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const them = opponentName || "Your opponent";

  async function handleConfirm() {
    setBusy(true);
    try {
      await onClaim();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section
      aria-labelledby="claim-timeout-heading"
      style={{
        marginTop: "1rem",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        maxWidth: 460,
      }}
    >
      <h3 id="claim-timeout-heading" style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>
        Claim the win on time
      </h3>

      {!confirming ? (
        <>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: 0 }}>
            {them} ran out of time to move. You can end the game now and take the
            win — it scores as a single, doubled by the cube, exactly like a
            normal win. You can also just keep waiting; nothing expires.
          </p>
          <button type="button" onClick={() => setConfirming(true)}>
            Claim the win on time
          </button>
        </>
      ) : (
        <>
          <p style={{ fontWeight: "bold", fontSize: "0.85rem", marginTop: 0 }}>
            End the game and award yourself the win? {them} loses the game and
            the points count towards the match. This can't be undone.
          </p>
          <button type="button" onClick={handleConfirm} disabled={busy}>
            {busy ? "Claiming…" : "Yes, claim the win"}
          </button>{" "}
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
        </>
      )}
    </section>
  );
}
