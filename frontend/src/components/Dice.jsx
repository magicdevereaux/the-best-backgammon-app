import React from "react";

// A single die face showing its value.
function Die({ value }) {
  return (
    <div style={styles.die}>
      {value}
    </div>
  );
}

// Renders all dice remaining for the current turn.
// diceValues is an array like [3, 5] or [4, 4, 4, 4] for doubles.
export default function Dice({ diceValues }) {
  if (!diceValues || diceValues.length === 0) {
    return <p style={{ color: "#888" }}>No dice rolled yet.</p>;
  }

  return (
    <div style={styles.container}>
      {diceValues.map((val, i) => (
        <Die key={i} value={val} />
      ))}
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    gap: "0.5rem",
    margin: "0.5rem 0",
  },
  die: {
    width: "48px",
    height: "48px",
    background: "#fff",
    border: "2px solid #333",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
    fontWeight: "bold",
  },
};
