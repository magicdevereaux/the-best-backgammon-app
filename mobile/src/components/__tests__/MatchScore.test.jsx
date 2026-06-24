import React from "react";
import { render, screen } from "@testing-library/react-native";
import MatchScore from "../MatchScore";

describe("MatchScore", () => {
  test("renders the target and both scores", () => {
    const match = {
      player1_name: "Alice", player2_name: "Bob",
      player1_score: 3, player2_score: 1,
      target_points: 5,
    };
    render(<MatchScore match={match} />);

    expect(screen.getAllByText(/first to 5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bob/).length).toBeGreaterThan(0);
  });

  test("renders nothing without a match", () => {
    const { toJSON } = render(<MatchScore match={null} />);
    expect(toJSON()).toBeNull();
  });
});
