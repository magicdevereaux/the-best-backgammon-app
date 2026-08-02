import React, { useState } from "react";

/*
 * The escape hatch for a game deadlocked by a closed seat: the opponent deleted
 * their account, the server refuses their seat to everyone (including this
 * player), and no action will ever advance the board again.
 *
 * Deliberately *not* worded as a resign. `POST /api/games/{id}/abandon/` has no
 * scoring semantics at all — the game finishes with no winner, no points, and no
 * change to the match score — so the copy has to say that plainly, or a player
 * will read it as conceding a live game.
 *
 * Two stages, matching DeleteAccountPanel: the destructive verb is on screen
 * from the start (there is nothing else left to do here) but the act itself
 * needs a second, explicit yes.
 */
export default function AbandonGamePanel({ onAbandon }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onAbandon();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section
      aria-labelledby="abandon-heading"
      style={{
        marginTop: "1rem",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        maxWidth: 460,
      }}
    >
      <h3 id="abandon-heading" style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>
        Close out this game
      </h3>

      {!confirming ? (
        <>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: 0 }}>
            This game is over as a contest — it can never be played out. Closing
            it out ends it with no winner and no points for either player. Your
            match score and your record are left exactly as they are.
          </p>
          <button type="button" onClick={() => setConfirming(true)}>
            Close out this game
          </button>
        </>
      ) : (
        <>
          <p style={{ fontWeight: "bold", fontSize: "0.85rem", marginTop: 0 }}>
            End this game with no winner and no score change? This can't be undone.
          </p>
          <button type="button" onClick={handleConfirm} disabled={busy}>
            {busy ? "Closing out…" : "Yes, close it out"}
          </button>{" "}
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
        </>
      )}
    </section>
  );
}
