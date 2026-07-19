import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import DoublingCube from "../DoublingCube";

const baseGame = {
  status: "active",
  current_turn: "p1",
  player1_name: "Alice",
  player2_name: "Bob",
  cube_value: 1,
  cube_owner: null,
  double_offered_by: null,
  crawford_game: false,
};

describe("DoublingCube", () => {
  test("shows the cube value and centered state", () => {
    const { getByText } = render(<DoublingCube game={baseGame} />);
    getByText("1");
    getByText(/cube: centered/i);
  });

  test("shows the owner and Crawford note", () => {
    const { getByText, queryByText } = render(
      <DoublingCube
        game={{ ...baseGame, cube_value: 2, cube_owner: "p2", crawford_game: true }}
      />
    );
    getByText(/cube: bob/i);
    getByText(/crawford — no doubling/i);
    expect(queryByText(/double to/i)).toBeNull();
  });

  test("Double button shows only when offering is allowed and calls the handler", () => {
    const onOfferDouble = jest.fn();
    const { getByText, queryByText, rerender } = render(
      <DoublingCube game={baseGame} canOfferDouble onOfferDouble={onOfferDouble} />
    );
    fireEvent.press(getByText(/double to 2/i));
    expect(onOfferDouble).toHaveBeenCalledTimes(1);

    rerender(<DoublingCube game={baseGame} canOfferDouble={false} />);
    expect(queryByText(/double to 2/i)).toBeNull();
  });

  test("pending double shows accept/drop for the responder", () => {
    const onRespondToDouble = jest.fn();
    const { getByText } = render(
      <DoublingCube
        game={{ ...baseGame, cube_value: 2, cube_owner: "p1", double_offered_by: "p1" }}
        canRespond
        onRespondToDouble={onRespondToDouble}
      />
    );
    getByText(/alice offers to double to 4/i);
    fireEvent.press(getByText(/accept/i));
    expect(onRespondToDouble).toHaveBeenCalledWith(true);
    fireEvent.press(getByText(/drop \(2 pts\)/i));
    expect(onRespondToDouble).toHaveBeenCalledWith(false);
  });

  test("pending double shows a waiting note when this device cannot respond", () => {
    const { getByText, queryByText } = render(
      <DoublingCube
        game={{ ...baseGame, double_offered_by: "p1" }}
        canRespond={false}
      />
    );
    getByText(/waiting for their answer/i);
    expect(queryByText(/accept/i)).toBeNull();
  });
});
