import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import GamePage from "../GamePage";
import { AuthProvider } from "../../context/AuthContext";
import * as gameApi from "../../api/gameApi";
import * as matchApi from "../../api/matchApi";
import * as authApi from "../../api/authApi";

/*
 * Covers the closed-seat banner: when the seat that owes the next action has
 * been closed by account deletion, the survivor must be told the game can't
 * continue instead of being shown a turn that will never come.
 *
 * Run with:
 *   cd frontend && CI=true npm test -- --testPathPattern=GamePage
 */

jest.mock("../../api/gameApi");
jest.mock("../../api/matchApi");
jest.mock("../../api/authApi");

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useParams: () => ({ id: "1" }),
  useNavigate: () => jest.fn(),
}));

const INITIAL_BOARD = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

const BASE = {
  id: 1,
  status: "active",
  current_turn: "p1",
  board_state: INITIAL_BOARD,
  dice_values: [3, 5],
  player1_name: "alice",
  player2_name: "bob",
  player1_user: 1,
  player2_user: 2,
  match: null,
};

async function renderGame(overrides = {}) {
  authApi.fetchMe.mockResolvedValue(null); // logged out; seat comes from viewer_seat
  gameApi.fetchGame.mockResolvedValue({ ...BASE, ...overrides });
  render(
    <MemoryRouter>
      <AuthProvider>
        <GamePage />
      </AuthProvider>
    </MemoryRouter>
  );
  await screen.findByRole("heading", { name: /alice vs bob/i });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GamePage turn banner", () => {
  test("shows the normal turn line when both seats are open", async () => {
    await renderGame();
    expect(screen.getByText("alice's turn")).toBeInTheDocument();
    expect(screen.queryByText(/deleted their account/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /roll dice/i })).toBeInTheDocument();
  });

  test("absent deletion flags behave exactly as before", async () => {
    await renderGame({ player1_deleted: undefined, player2_deleted: undefined });
    expect(screen.getByText("alice's turn")).toBeInTheDocument();
  });

  test("a closed seat holding the turn replaces the banner and hides the controls", async () => {
    await renderGame({ current_turn: "p2", player2_deleted: true });
    expect(
      screen.getByText("bob deleted their account — this game can't continue.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/'s turn/)).not.toBeInTheDocument();
    // Nothing interactive: every action on a closed seat 403s.
    expect(screen.queryByRole("button", { name: /roll dice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm turn/i })).not.toBeInTheDocument();
  });

  test("names the other seat's owner as 'your opponent' when viewer_seat says so", async () => {
    await renderGame({ current_turn: "p2", player2_deleted: true, viewer_seat: "p1" });
    expect(
      screen.getByText("Your opponent deleted their account — this game can't continue.")
    ).toBeInTheDocument();
  });

  test("the deleted seat's own viewpoint is deadlocked too", async () => {
    await renderGame({ current_turn: "p1", player1_deleted: true, viewer_seat: "p1" });
    expect(
      screen.getByText("alice deleted their account — this game can't continue.")
    ).toBeInTheDocument();
  });

  test("a closed seat that does not hold the turn leaves play normal", async () => {
    await renderGame({ current_turn: "p1", player2_deleted: true });
    expect(screen.getByText("alice's turn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /roll dice/i })).toBeInTheDocument();
  });

  test("pending double: an open responder can still answer, so no banner", async () => {
    // p1 offered then deleted; p2 may still accept or drop.
    await renderGame({
      current_turn: "p1",
      dice_values: [],
      double_offered_by: "p1",
      player1_deleted: true,
    });
    expect(screen.queryByText(/deleted their account/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  test("pending double: a closed responder deadlocks on the offerer's turn", async () => {
    await renderGame({
      current_turn: "p1",
      dice_values: [],
      double_offered_by: "p1",
      player2_deleted: true,
    });
    expect(
      screen.getByText("bob deleted their account — this game can't continue.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });

  test("a finished game shows no deadlock banner", async () => {
    matchApi.fetchMatch.mockResolvedValue(null);
    await renderGame({ status: "finished", winner: "p1", player2_deleted: true, current_turn: "p2" });
    expect(screen.queryByText(/deleted their account/i)).not.toBeInTheDocument();
  });
});

/*
 * The abandon control: the only action left on a deadlocked board, offered only
 * to the player who can act for the surviving seat. Everything else on such a
 * game 403s, and the endpoint itself refuses a game that is not genuinely stuck.
 */
describe("GamePage abandon control", () => {
  // p2 deleted their account and owes the turn; the server nulls the FK and
  // flags the seat. p1 (alice, user 1) is the survivor.
  const DEADLOCKED = {
    current_turn: "p2",
    player2_user: null,
    player2_deleted: true,
  };

  const abandonButton = () => screen.queryByRole("button", { name: /close out this game/i });

  test("is hidden on a healthy game", async () => {
    await renderGame();
    expect(abandonButton()).not.toBeInTheDocument();
  });

  test("is hidden from a viewer who does not hold the surviving seat", async () => {
    // No viewer_seat: the server doesn't recognise this requester as the
    // registered survivor, so offering the button would only earn a 403.
    await renderGame(DEADLOCKED);
    expect(screen.getByText(/deleted their account/i)).toBeInTheDocument();
    expect(abandonButton()).not.toBeInTheDocument();
  });

  test("is shown to the survivor of a deadlocked game", async () => {
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });
    expect(abandonButton()).toBeInTheDocument();
  });

  test("is hidden when both seats are closed — nobody may act", async () => {
    await renderGame({
      ...DEADLOCKED,
      player1_user: null,
      player1_deleted: true,
      viewer_seat: null,
    });
    expect(abandonButton()).not.toBeInTheDocument();
  });

  test("words itself as closing out, not resigning, and needs a second yes", async () => {
    matchApi.fetchMatch.mockResolvedValue(null);
    gameApi.abandonGame.mockResolvedValue({
      ...BASE, ...DEADLOCKED, status: "finished", winner: null, win_type: "abandoned",
    });
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });

    expect(screen.getByText(/no winner and no points for either player/i)).toBeInTheDocument();
    expect(screen.queryByText(/resign/i)).not.toBeInTheDocument();

    await userEvent.click(abandonButton());
    expect(
      screen.getByText(/end this game with no winner and no score change/i)
    ).toBeInTheDocument();
    expect(gameApi.abandonGame).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /yes, close it out/i }));
    await waitFor(() => expect(gameApi.abandonGame).toHaveBeenCalledWith("1"));
  });

  test("cancelling the confirmation calls nothing", async () => {
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });
    await userEvent.click(abandonButton());
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(gameApi.abandonGame).not.toHaveBeenCalled();
    expect(abandonButton()).toBeInTheDocument();
  });

  test("the abandoned game comes back finished, with the control gone", async () => {
    gameApi.abandonGame.mockResolvedValue({
      ...BASE,
      ...DEADLOCKED,
      viewer_seat: "p1",
      status: "finished",
      winner: null,
      win_type: "abandoned",
      points_value: 0,
    });
    matchApi.fetchMatch.mockResolvedValue(null);
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });

    await userEvent.click(abandonButton());
    await userEvent.click(screen.getByRole("button", { name: /yes, close it out/i }));

    await waitFor(() => expect(abandonButton()).not.toBeInTheDocument());
    expect(screen.queryByText(/deleted their account/i)).not.toBeInTheDocument();
  });

  test("surfaces a 403 from the server through the page's error line", async () => {
    gameApi.abandonGame.mockRejectedValue(
      new Error("This player deleted their account — their seat is closed.")
    );
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });

    await userEvent.click(abandonButton());
    await userEvent.click(screen.getByRole("button", { name: /yes, close it out/i }));

    expect(
      await screen.findByText("This player deleted their account — their seat is closed.")
    ).toBeInTheDocument();
    // The game is untouched, so the control is still there to retry.
    expect(abandonButton()).toBeInTheDocument();
  });

  test("surfaces the 'not abandoned' 400 without changing the board", async () => {
    gameApi.abandonGame.mockRejectedValue(
      new Error("This game is not abandoned — the player to act still has an open seat.")
    );
    await renderGame({ ...DEADLOCKED, viewer_seat: "p1" });

    await userEvent.click(abandonButton());
    await userEvent.click(screen.getByRole("button", { name: /yes, close it out/i }));

    expect(
      await screen.findByText(
        "This game is not abandoned — the player to act still has an open seat."
      )
    ).toBeInTheDocument();
  });
});
