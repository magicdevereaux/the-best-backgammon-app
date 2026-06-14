import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Board from '../Board';

// Standard backgammon starting position
const INITIAL_BOARD = {
  points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2],
  bar: { p1: 0, p2: 0 },
  off: { p1: 0, p2: 0 },
};

/*
 * All tests in the "board structure" and "checker placement" groups FAIL
 * until you replace the placeholder in Board.jsx with real rendering.
 *
 * The contract these tests enforce:
 *   - Each point is rendered as an element with data-testid="point-N" (1-indexed)
 *   - P1 checkers inside a point are elements with data-testid="p1-checker"
 *   - P2 checkers inside a point are elements with data-testid="p2-checker"
 *   - The bar has data-testid="bar"
 *   - The borne-off areas have data-testid="off-p1" and data-testid="off-p2"
 *
 * Run with:
 *   cd frontend && npm test -- --testPathPattern=Board
 */

describe('Board — null/empty state (should pass even before implementation)', () => {
  test('renders without crashing when boardState is null', () => {
    render(<Board boardState={null} />);
    expect(screen.getByText(/no board state/i)).toBeInTheDocument();
  });
});

describe('Board — 24 points (FAIL until rendered)', () => {
  test('renders an element for each of the 24 points', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    for (let i = 1; i <= 24; i++) {
      expect(screen.getByTestId(`point-${i}`)).toBeInTheDocument();
    }
  });

  test('point-1 exists and is in the document', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    expect(screen.getByTestId('point-1')).toBeInTheDocument();
  });

  test('point-24 exists and is in the document', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    expect(screen.getByTestId('point-24')).toBeInTheDocument();
  });
});

describe('Board — p1 checker placement (FAIL until rendered)', () => {
  test('point-1 shows 2 p1 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-1');
    expect(point.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(2);
  });

  test('point-12 shows 5 p1 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-12');
    expect(point.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(5);
  });

  test('point-17 shows 3 p1 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-17');
    expect(point.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(3);
  });

  test('point-19 shows 5 p1 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-19');
    expect(point.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(5);
  });
});

describe('Board — p2 checker placement (FAIL until rendered)', () => {
  test('point-6 shows 5 p2 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-6');
    expect(point.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(5);
  });

  test('point-8 shows 3 p2 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-8');
    expect(point.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(3);
  });

  test('point-13 shows 5 p2 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-13');
    expect(point.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(5);
  });

  test('point-24 shows 2 p2 checkers (standard start)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const point = screen.getByTestId('point-24');
    expect(point.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(2);
  });
});

describe('Board — bar area (FAIL until rendered)', () => {
  test('renders a bar element', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    expect(screen.getByTestId('bar')).toBeInTheDocument();
  });

  test('bar is empty at start (no checkers)', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const bar = screen.getByTestId('bar');
    expect(bar.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(0);
    expect(bar.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(0);
  });

  test('bar shows p1 checker when p1 has been hit', () => {
    const board = { ...INITIAL_BOARD, bar: { p1: 1, p2: 0 } };
    render(<Board boardState={board} />);
    const bar = screen.getByTestId('bar');
    expect(bar.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(1);
  });
});

describe('Board — off/borne-off areas (FAIL until rendered)', () => {
  test('renders the p1 borne-off area', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    expect(screen.getByTestId('off-p1')).toBeInTheDocument();
  });

  test('renders the p2 borne-off area', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    expect(screen.getByTestId('off-p2')).toBeInTheDocument();
  });

  test('off areas are empty at game start', () => {
    render(<Board boardState={INITIAL_BOARD} />);
    const offP1 = screen.getByTestId('off-p1');
    const offP2 = screen.getByTestId('off-p2');
    expect(offP1.querySelectorAll('[data-testid="p1-checker"]')).toHaveLength(0);
    expect(offP2.querySelectorAll('[data-testid="p2-checker"]')).toHaveLength(0);
  });
});

describe('Board — move interaction', () => {
  test('selecting own checker then a destination calls onMove with from and to', () => {
    const onMove = jest.fn();
    render(<Board boardState={INITIAL_BOARD} currentPlayer="p1" onMove={onMove} />);
    fireEvent.click(screen.getByTestId('point-1'));
    fireEvent.click(screen.getByTestId('point-2'));
    expect(onMove).toHaveBeenCalledWith(1, 2);
  });

  test('clicking an opponent checker does not select it as a source', () => {
    const onMove = jest.fn();
    render(<Board boardState={INITIAL_BOARD} currentPlayer="p1" onMove={onMove} />);
    fireEvent.click(screen.getByTestId('point-6')); // p2 checkers
    fireEvent.click(screen.getByTestId('point-7'));
    expect(onMove).not.toHaveBeenCalled();
  });

  test('clicking the same point twice deselects it', () => {
    const onMove = jest.fn();
    render(<Board boardState={INITIAL_BOARD} currentPlayer="p1" onMove={onMove} />);
    fireEvent.click(screen.getByTestId('point-1'));
    fireEvent.click(screen.getByTestId('point-1'));
    fireEvent.click(screen.getByTestId('point-2'));
    expect(onMove).not.toHaveBeenCalled();
  });

  test('selecting the bar then a point enters from the bar (from_point 0)', () => {
    const onMove = jest.fn();
    const board = { ...INITIAL_BOARD, bar: { p1: 1, p2: 0 } };
    render(<Board boardState={board} currentPlayer="p1" onMove={onMove} />);
    fireEvent.click(screen.getByTestId('bar'));
    fireEvent.click(screen.getByTestId('point-3'));
    expect(onMove).toHaveBeenCalledWith(0, 3);
  });

  test('selecting a checker then the matching off area bears it off (to_point 25)', () => {
    const onMove = jest.fn();
    render(<Board boardState={INITIAL_BOARD} currentPlayer="p1" onMove={onMove} />);
    fireEvent.click(screen.getByTestId('point-19'));
    fireEvent.click(screen.getByTestId('off-p1'));
    expect(onMove).toHaveBeenCalledWith(19, 25);
  });

  test('without onMove or currentPlayer, clicking points does not trigger a move', () => {
    const onMove = jest.fn();
    render(<Board boardState={INITIAL_BOARD} />);
    fireEvent.click(screen.getByTestId('point-1'));
    fireEvent.click(screen.getByTestId('point-2'));
    expect(onMove).not.toHaveBeenCalled();
  });
});
