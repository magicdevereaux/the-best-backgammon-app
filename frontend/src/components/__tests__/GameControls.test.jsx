import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import GameControls from '../GameControls';

/*
 * GameControls.jsx is fully implemented — these tests should all PASS immediately.
 *
 * Run with:
 *   cd frontend && npm test -- --testPathPattern=GameControls
 */

const activeGameNoDice = {
  status: 'active',
  dice_values: [],
  player1_name: 'Alice',
  player2_name: 'Bob',
};

const activeGameWithDice = {
  status: 'active',
  dice_values: [3, 5],
  player1_name: 'Alice',
  player2_name: 'Bob',
};

const finishedGameP1Wins = {
  status: 'finished',
  winner: 'p1',
  dice_values: [],
  player1_name: 'Alice',
  player2_name: 'Bob',
};

const finishedGameP2Wins = {
  status: 'finished',
  winner: 'p2',
  dice_values: [],
  player1_name: 'Alice',
  player2_name: 'Bob',
};

describe('GameControls component', () => {
  test('renders a Roll Dice button', () => {
    render(<GameControls game={activeGameNoDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /roll dice/i })).toBeInTheDocument();
  });

  test('Roll Dice button is enabled when no dice have been rolled', () => {
    render(<GameControls game={activeGameNoDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /roll dice/i })).not.toBeDisabled();
  });

  test('Roll Dice button is disabled when dice are already rolled', () => {
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /roll dice/i })).toBeDisabled();
  });

  test('calls onRollDice when Roll Dice button is clicked', () => {
    const onRollDice = jest.fn();
    render(<GameControls game={activeGameNoDice} onRollDice={onRollDice} />);
    fireEvent.click(screen.getByRole('button', { name: /roll dice/i }));
    expect(onRollDice).toHaveBeenCalledTimes(1);
  });

  test('does not call onRollDice when button is disabled', () => {
    const onRollDice = jest.fn();
    render(<GameControls game={activeGameWithDice} onRollDice={onRollDice} />);
    fireEvent.click(screen.getByRole('button', { name: /roll dice/i }));
    expect(onRollDice).not.toHaveBeenCalled();
  });

  test('shows winner name when p1 wins', () => {
    render(<GameControls game={finishedGameP1Wins} onRollDice={() => {}} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });

  test('shows winner name when p2 wins', () => {
    render(<GameControls game={finishedGameP2Wins} onRollDice={() => {}} />);
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  test('does not show winner message during active game', () => {
    render(<GameControls game={activeGameNoDice} onRollDice={() => {}} />);
    expect(screen.queryByText(/game over/i)).not.toBeInTheDocument();
  });
});
