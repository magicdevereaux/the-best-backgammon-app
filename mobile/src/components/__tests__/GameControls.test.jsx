import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import GameControls from "../GameControls";

// GameControls had no test file before the higher-die rule landed. These cover
// the Confirm-button affordances only: the two rules that disable it, and the
// Pass relabelling. The server enforces both rules at confirm_turn — this is the
// matching UX, so a client can no longer stage a turn it knows will 400.
// Mirrors frontend/src/components/__tests__/GameControls.test.jsx.
function renderControls(props = {}) {
  const onConfirmTurn = jest.fn();
  render(
    <GameControls
      turnActive
      hasPendingMoves
      hasLegalMoves
      onUndo={jest.fn()}
      onResetTurn={jest.fn()}
      onConfirmTurn={onConfirmTurn}
      {...props}
    />
  );
  return { onConfirmTurn };
}

describe("GameControls — higher-die affordance", () => {
  test("does not confirm while the staged turn plays the lower die", () => {
    const { onConfirmTurn } = renderControls({ mustPlayHigherDie: true });

    fireEvent.press(screen.getByText("Confirm Turn"));
    expect(onConfirmTurn).not.toHaveBeenCalled();
  });

  test("does not confirm while dice remain usable", () => {
    const { onConfirmTurn } = renderControls({ mustUseMoreDice: true });

    fireEvent.press(screen.getByText("Confirm Turn"));
    expect(onConfirmTurn).not.toHaveBeenCalled();
  });

  test("confirms when neither rule is pending", () => {
    const { onConfirmTurn } = renderControls();

    fireEvent.press(screen.getByText("Confirm Turn"));
    expect(onConfirmTurn).toHaveBeenCalled();
  });

  test("does not confirm outside your turn, whatever the rule flags say", () => {
    // Confirm is disabled on `!turnActive || blockConfirm`, so not being to move
    // is sufficient on its own — the rule flags never get a chance to matter.
    const { onConfirmTurn } = renderControls({
      turnActive: false,
      mustPlayHigherDie: false,
      mustUseMoreDice: false,
    });

    fireEvent.press(screen.getByText("Confirm Turn"));
    expect(onConfirmTurn).not.toHaveBeenCalled();
  });

  test("relabels to Pass Turn when nothing can be played", () => {
    renderControls({ hasPendingMoves: false, hasLegalMoves: false });

    expect(screen.getByText("Pass Turn")).toBeTruthy();
    expect(screen.queryByText("Confirm Turn")).toBeNull();
  });
});
