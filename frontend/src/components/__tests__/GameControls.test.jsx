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

describe('GameControls — Reset Turn / Confirm Turn', () => {
  test('renders Reset Turn and Confirm Turn buttons', () => {
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /reset turn/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm turn/i })).toBeInTheDocument();
  });

  test('Confirm Turn is disabled when no dice have been rolled', () => {
    render(<GameControls game={activeGameNoDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm turn/i })).toBeDisabled();
  });

  test('Confirm Turn is enabled once dice have been rolled', () => {
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm turn/i })).not.toBeDisabled();
  });

  test('Reset Turn is disabled when there are no pending moves', () => {
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} hasPendingMoves={false} />);
    expect(screen.getByRole('button', { name: /reset turn/i })).toBeDisabled();
  });

  test('Reset Turn is enabled once a move has been staged', () => {
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} hasPendingMoves={true} />);
    expect(screen.getByRole('button', { name: /reset turn/i })).not.toBeDisabled();
  });

  test('Reset Turn is disabled when no dice have been rolled, even with pending moves', () => {
    render(<GameControls game={activeGameNoDice} onRollDice={() => {}} hasPendingMoves={true} />);
    expect(screen.getByRole('button', { name: /reset turn/i })).toBeDisabled();
  });

  test('calls onConfirmTurn when Confirm Turn is clicked', () => {
    const onConfirmTurn = jest.fn();
    render(<GameControls game={activeGameWithDice} onRollDice={() => {}} onConfirmTurn={onConfirmTurn} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm turn/i }));
    expect(onConfirmTurn).toHaveBeenCalledTimes(1);
  });

  test('calls onResetTurn when Reset Turn is clicked', () => {
    const onResetTurn = jest.fn();
    render(
      <GameControls
        game={activeGameWithDice}
        onRollDice={() => {}}
        onResetTurn={onResetTurn}
        hasPendingMoves={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /reset turn/i }));
    expect(onResetTurn).toHaveBeenCalledTimes(1);
  });

  test('both buttons are disabled once the game is finished', () => {
    render(<GameControls game={finishedGameP1Wins} onRollDice={() => {}} hasPendingMoves={true} />);
    expect(screen.getByRole('button', { name: /reset turn/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /confirm turn/i })).toBeDisabled();
  });
});

describe('GameControls — maximal dice usage affordance', () => {
  test('Confirm Turn is disabled while legal moves remain for unused dice', () => {
    render(
      <GameControls game={activeGameWithDice} onRollDice={() => {}} mustUseMoreDice={true} />
    );
    expect(screen.getByRole('button', { name: /confirm turn/i })).toBeDisabled();
  });

  test('shows a hint explaining why Confirm is blocked', () => {
    render(
      <GameControls game={activeGameWithDice} onRollDice={() => {}} mustUseMoreDice={true} />
    );
    expect(screen.getByText(/use as many dice as possible/i)).toBeInTheDocument();
  });

  test('Confirm Turn is enabled when no more dice need to be used', () => {
    render(
      <GameControls game={activeGameWithDice} onRollDice={() => {}} mustUseMoreDice={false} />
    );
    expect(screen.getByRole('button', { name: /confirm turn/i })).not.toBeDisabled();
  });

  test('does not call onConfirmTurn while moves remain', () => {
    const onConfirmTurn = jest.fn();
    render(
      <GameControls
        game={activeGameWithDice}
        onRollDice={() => {}}
        onConfirmTurn={onConfirmTurn}
        mustUseMoreDice={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm turn/i }));
    expect(onConfirmTurn).not.toHaveBeenCalled();
  });
});
