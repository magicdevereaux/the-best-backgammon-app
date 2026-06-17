import React from "react";

const WIN_TYPE_LABEL = {
  normal: "wins!",
  gammon: "wins with a gammon!",
  backgammon: "wins with a backgammon!",
};

export default function GameOverScreen({ game, match, onNextGame, onNewMatch, onLobby }) {
  const winnerName = game.winner === "p1" ? game.player1_name : game.player2_name;
  const pts = game.points_value ?? 1;
  const label = WIN_TYPE_LABEL[game.win_type] ?? "wins!";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "2rem 2.5rem",
          maxWidth: 420,
          width: "90%",
          textAlign: "center",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>
          {winnerName} {label}
        </h2>
        <p style={{ fontSize: "1.1rem", color: "#555" }}>
          {pts === 1
            ? "1 point awarded"
            : `${pts} points awarded`}
          {game.win_type === "gammon" && " — gammon (opponent has borne off nothing)"}
          {game.win_type === "backgammon" &&
            " — backgammon (opponent still has a checker on the bar or in your home board)"}
        </p>

        {match && (
          <div
            style={{
              margin: "1rem 0",
              padding: "0.75rem 1rem",
              background: "#f5f5f5",
              borderRadius: 8,
            }}
          >
            <strong>Match score</strong> (first to {match.target_points})<br />
            <span style={{ fontSize: "1.4rem", fontWeight: "bold" }}>
              {match.player1_name} {match.player1_score} – {match.player2_score} {match.player2_name}
            </span>
            {match.status === "finished" && (
              <p style={{ color: "#27ae60", fontWeight: "bold", marginBottom: 0 }}>
                {match.winner === "p1" ? match.player1_name : match.player2_name} wins the match!
              </p>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginTop: "1.25rem" }}>
          {match && match.status === "active" && (
            <button onClick={onNextGame} style={{ fontWeight: "bold" }}>
              Next Game
            </button>
          )}
          {(!match || match.status === "finished") && (
            <button onClick={onNewMatch}>New Match</button>
          )}
          <button onClick={onLobby} style={{ background: "#eee", color: "#333" }}>
            Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
