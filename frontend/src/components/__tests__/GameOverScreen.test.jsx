import React from "react";
import { render, screen } from "@testing-library/react";
import GameOverScreen from "../GameOverScreen";

/*
 * Covers the win_type → copy mapping, which silently falls back to a bare
 * "wins!" for anything it doesn't know. A new win type that isn't added here
 * therefore *looks* fine while under-explaining the result.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=GameOverScreen
 */

const BASE = {
  status: "finished",
  player1_name: "alice",
  player2_name: "bob",
  winner: "p1",
  win_type: "normal",
  points_value: 1,
};

const show = (overrides = {}) =>
  render(<GameOverScreen game={{ ...BASE, ...overrides }} onNextGame={() => {}} onNewMatch={() => {}} onLobby={() => {}} />);

describe("GameOverScreen — inactivity forfeit", () => {
  test("names the win on time rather than falling back to a bare 'wins!'", () => {
    show({ win_type: "timeout" });
    expect(screen.getByRole("heading", { name: /alice wins on time!/i })).toBeInTheDocument();
  });

  test("explains the result in the third person, so it reads for both players", () => {
    // The forfeiting player sees this screen too; nothing here says "you".
    show({ win_type: "timeout", winner: "p2" });
    expect(screen.getByRole("heading", { name: /bob wins on time!/i })).toBeInTheDocument();
    expect(screen.getByText(/alice ran out of time to move/i)).toBeInTheDocument();
    expect(screen.queryByText(/\byou\b/i)).not.toBeInTheDocument();
  });

  test("scores like any other win — points, and no 'no winner' wording", () => {
    show({ win_type: "timeout", points_value: 2, cube_value: 2 });
    expect(screen.getByText(/2 points awarded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no winner/i)).not.toBeInTheDocument();
  });

  test("an abandoned game still reads as the unscored close-out it is", () => {
    show({ win_type: "abandoned", winner: null, points_value: 0 });
    expect(screen.getByText(/ended with no winner/i)).toBeInTheDocument();
    expect(screen.queryByText(/on time/i)).not.toBeInTheDocument();
  });
});
