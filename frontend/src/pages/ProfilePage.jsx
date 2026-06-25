import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe } from "../api/authApi";
import { useAuth } from "../context/AuthContext";

function StatRow({ label, value }) {
  return (
    <tr>
      <td style={{ padding: "0.4rem 1rem 0.4rem 0", color: "var(--text-secondary)" }}>{label}</td>
      <td style={{ padding: "0.4rem 0", fontWeight: "bold" }}>{value}</td>
    </tr>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user === null) {
      navigate("/login");
      return;
    }
    if (user === undefined) return;
    fetchMe()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  if (user === undefined || loading) return <p style={{ padding: "1rem" }}>Loading…</p>;
  if (!stats) return <p style={{ padding: "1rem" }}>Could not load stats.</p>;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 480 }}>
      <h1 style={{ marginBottom: "0.25rem" }}>{stats.username}</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>Player profile</p>

      <h2>Lifetime stats</h2>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          <StatRow label="Games played" value={stats.total_games} />
          <StatRow label="Wins" value={stats.wins} />
          <StatRow label="Losses" value={stats.losses} />
          <StatRow label="Win %" value={`${stats.win_percentage}%`} />
          <StatRow label="Gammons won" value={stats.total_gammons} />
          <StatRow label="Backgammons won" value={stats.total_backgammons} />
          <StatRow label="Gammon rate (% of wins)" value={`${stats.gammon_rate}%`} />
          <StatRow label="Total points won" value={stats.total_points_won} />
          <StatRow label="Total points lost" value={stats.total_points_lost} />
        </tbody>
      </table>
    </div>
  );
}
