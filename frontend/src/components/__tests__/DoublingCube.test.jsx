import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DoublingCube from '../DoublingCube';

const baseGame = {
  status: 'active',
  current_turn: 'p1',
  player1_name: 'Alice',
  player2_name: 'Bob',
  cube_value: 1,
  cube_owner: null,
  double_offered_by: null,
  crawford_game: false,
};

describe('DoublingCube', () => {
  test('shows the cube value and centered state', () => {
    render(<DoublingCube game={baseGame} canOfferDouble={false} />);
    expect(screen.getByTestId('cube-value')).toHaveTextContent('1');
    expect(screen.getByText(/cube: centered/i)).toBeInTheDocument();
  });

  test('shows the owner name when the cube is owned', () => {
    render(
      <DoublingCube game={{ ...baseGame, cube_value: 2, cube_owner: 'p2' }} canOfferDouble={false} />
    );
    expect(screen.getByTestId('cube-value')).toHaveTextContent('2');
    expect(screen.getByText(/cube: bob/i)).toBeInTheDocument();
  });

  test('renders the Double button only when offering is legal', () => {
    const { rerender } = render(<DoublingCube game={baseGame} canOfferDouble={true} />);
    expect(screen.getByRole('button', { name: /double to 2/i })).toBeInTheDocument();

    rerender(<DoublingCube game={baseGame} canOfferDouble={false} />);
    expect(screen.queryByRole('button', { name: /double/i })).not.toBeInTheDocument();
  });

  test('clicking Double calls onOfferDouble', () => {
    const onOfferDouble = jest.fn();
    render(<DoublingCube game={baseGame} canOfferDouble={true} onOfferDouble={onOfferDouble} />);
    fireEvent.click(screen.getByRole('button', { name: /double to 2/i }));
    expect(onOfferDouble).toHaveBeenCalledTimes(1);
  });

  test('notes the Crawford game and shows no Double button', () => {
    render(<DoublingCube game={{ ...baseGame, crawford_game: true }} canOfferDouble={false} />);
    expect(screen.getByText(/crawford game — no doubling/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /double/i })).not.toBeInTheDocument();
  });

  test('renders the accept/drop prompt when a double is pending', () => {
    const onRespondToDouble = jest.fn();
    render(
      <DoublingCube
        game={{ ...baseGame, cube_value: 2, cube_owner: 'p1', double_offered_by: 'p1' }}
        canOfferDouble={false}
        onRespondToDouble={onRespondToDouble}
      />
    );
    expect(screen.getByText(/alice offers to double to 4/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(onRespondToDouble).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: /drop/i }));
    expect(onRespondToDouble).toHaveBeenCalledWith(false);
  });

  test('drop button states the points conceded', () => {
    render(
      <DoublingCube
        game={{ ...baseGame, cube_value: 4, cube_owner: 'p2', double_offered_by: 'p2' }}
        canOfferDouble={false}
        onRespondToDouble={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /drop \(4 pts\)/i })).toBeInTheDocument();
  });
});
