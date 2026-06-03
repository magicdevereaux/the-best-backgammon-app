import React from "react";

// =============================================================================
// TODO: Implement the board rendering logic.
//
// Props:
//   boardState — the board_state object from the Game model:
//     {
//       points: int[24],     // positive = p1 checkers, negative = p2 checkers
//       bar:    { p1: int, p2: int },
//       off:    { p1: int, p2: int },
//     }
//
// What needs rendering:
//   1. 24 points arranged as a standard backgammon board:
//        - Points 13–24 along the top (left to right from p1's perspective)
//        - Points 12–1  along the bottom (left to right from p1's perspective)
//        - A bar dividing the board in the middle
//   2. Checkers on each point (number or stack of circles)
//   3. The bar showing any checkers that have been hit
//   4. The "off" area showing checkers that have been borne off
//
// Suggested approach:
//   - Split the 24 points into top row (indices 12–23) and bottom row
//     (indices 0–11, reversed so point 1 is on the right).
//   - Map each point to a <Point> sub-component that renders a triangle and
//     the checkers stacked on it.
//   - Use inline styles or a CSS module — your choice.
//
// You do NOT need to handle click interactions here; those belong in GamePage
// once you have move logic wired up.
// =============================================================================

export default function Board({ boardState }) {
  if (!boardState) {
    return <div style={styles.board}>No board state available.</div>;
  }

  // TODO: Replace this placeholder with real board rendering.
  return (
    <div style={styles.board}>
      <p style={{ color: "#888", fontStyle: "italic" }}>
        [ Board rendering not yet implemented ]
      </p>
      <pre style={{ fontSize: "0.75rem" }}>
        {JSON.stringify(boardState, null, 2)}
      </pre>
    </div>
  );
}

const styles = {
  board: {
    width: "600px",
    height: "400px",
    background: "#2d5a27",
    border: "4px solid #5c3a1e",
    borderRadius: "4px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    margin: "1rem 0",
    overflow: "auto",
    padding: "0.5rem",
  },
};
