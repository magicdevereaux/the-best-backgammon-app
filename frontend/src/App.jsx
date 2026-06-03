import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import GamePage from "./pages/GamePage";
import LobbyPage from "./pages/LobbyPage";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: "1rem", borderBottom: "1px solid #ccc" }}>
        <Link to="/" style={{ marginRight: "1rem" }}>Lobby</Link>
      </nav>

      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/game/:id" element={<GamePage />} />
      </Routes>
    </BrowserRouter>
  );
}
