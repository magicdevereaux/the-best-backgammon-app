import React from "react";

export default function MatchScore({ match }) {
  if (!match) return null;
  return (
    <div
      style={{
        display: "inline-block",
        padding: "0.35rem 0.75rem",
        background: "#f0f0f0",
        borderRadius: 6,
        fontSize: "0.9rem",
        marginBottom: "0.5rem",
      }}
    >
      <strong>Match</strong> (first to {match.target_points}):{" "}
      {match.player1_name} <strong>{match.player1_score}</strong>
      {" – "}
      <strong>{match.player2_score}</strong> {match.player2_name}
    </div>
  );
}
