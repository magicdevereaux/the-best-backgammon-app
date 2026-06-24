import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import GameOverScreen from "../GameOverScreen";

const normalWin = {
  winner: "p1",
  player1_name: "Alice",
  player2_name: "Bob",
  win_type: "normal",
  points_value: 1,
};

describe("GameOverScreen", () => {
  test("single game: shows winner + points and offers New Match", () => {
    const onNewMatch = jest.fn();
    render(
      <GameOverScreen
        game={normalWin}
        match={null}
        onNextGame={jest.fn()}
        onNewMatch={onNewMatch}
        onLobby={jest.fn()}
      />
    );

    expect(screen.getByText("Alice wins!")).toBeTruthy();
    expect(screen.getByText("1 point awarded")).toBeTruthy();
    expect(screen.queryByText("Next Game")).toBeNull();

    fireEvent.press(screen.getByText("New Match"));
    expect(onNewMatch).toHaveBeenCalledTimes(1);
  });

  test("gammon in an ongoing match: shows score + detail and offers Next Game", () => {
    const onNextGame = jest.fn();
    const game = { ...normalWin, win_type: "gammon", points_value: 2 };
    const match = {
      player1_name: "Alice", player2_name: "Bob",
      player1_score: 2, player2_score: 0,
      target_points: 5, status: "active",
    };
    render(
      <GameOverScreen
        game={game}
        match={match}
        onNextGame={onNextGame}
        onNewMatch={jest.fn()}
        onLobby={jest.fn()}
      />
    );

    expect(screen.getByText("2 points awarded")).toBeTruthy();
    expect(screen.getByText(/Gammon/)).toBeTruthy();
    expect(screen.getByText(/Alice 2/)).toBeTruthy(); // "Alice 2 – 0 Bob"
    expect(screen.queryByText(/wins the match/)).toBeNull();

    fireEvent.press(screen.getByText("Next Game"));
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  test("match completion: announces the match winner", () => {
    const game = { ...normalWin, win_type: "backgammon", points_value: 3 };
    const match = {
      player1_name: "Alice", player2_name: "Bob",
      player1_score: 5, player2_score: 1,
      target_points: 5, status: "finished", winner: "p1",
    };
    render(
      <GameOverScreen
        game={game}
        match={match}
        onNextGame={jest.fn()}
        onNewMatch={jest.fn()}
        onLobby={jest.fn()}
      />
    );

    expect(screen.getByText(/Alice wins the match!/)).toBeTruthy();
    expect(screen.getByText("New Match")).toBeTruthy();
    expect(screen.queryByText("Next Game")).toBeNull();
  });
});
