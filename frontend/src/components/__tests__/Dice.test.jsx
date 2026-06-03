import React from 'react';
import { render, screen } from '@testing-library/react';
import Dice from '../Dice';

/*
 * Dice.jsx is fully implemented — these tests should all PASS immediately.
 * They serve as a baseline and document the component's expected behavior.
 *
 * Run with:
 *   cd frontend && npm test -- --testPathPattern=Dice
 */

describe('Dice component', () => {
  test('shows "no dice" message when diceValues is null', () => {
    render(<Dice diceValues={null} />);
    expect(screen.getByText(/no dice rolled yet/i)).toBeInTheDocument();
  });

  test('shows "no dice" message when diceValues is empty', () => {
    render(<Dice diceValues={[]} />);
    expect(screen.getByText(/no dice rolled yet/i)).toBeInTheDocument();
  });

  test('renders two dice faces for a normal roll', () => {
    render(<Dice diceValues={[3, 5]} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('renders four dice faces for doubles', () => {
    render(<Dice diceValues={[4, 4, 4, 4]} />);
    // getAllByText because the same number appears multiple times
    const fours = screen.getAllByText('4');
    expect(fours).toHaveLength(4);
  });

  test('renders the correct values', () => {
    render(<Dice diceValues={[1, 6]} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });
});
