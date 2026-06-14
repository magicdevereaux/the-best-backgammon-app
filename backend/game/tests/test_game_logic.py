import unittest
from game.game_logic import (
    roll_dice,
    get_initial_board_state,
    get_legal_moves,
    apply_move,
    can_bear_off,
    check_winner,
    opponent,
)


def empty_board():
    return {
        "points": [0] * 24,
        "bar": {"p1": 0, "p2": 0},
        "off": {"p1": 0, "p2": 0},
    }


class RollDiceTest(unittest.TestCase):
    """
    All tests here FAIL until you implement roll_dice() in game_logic.py.

    Run with:
        python manage.py test game.tests.test_game_logic
    """

    def test_returns_a_list(self):
        result = roll_dice()
        self.assertIsInstance(result, list)

    def test_values_are_integers(self):
        result = roll_dice()
        for val in result:
            self.assertIsInstance(val, int, f"Expected int, got {type(val)}: {val}")

    def test_each_value_is_between_1_and_6(self):
        for _ in range(50):
            for val in roll_dice():
                self.assertGreaterEqual(val, 1, f"Die value {val} is below 1")
                self.assertLessEqual(val, 6, f"Die value {val} is above 6")

    def test_non_doubles_returns_exactly_two_values(self):
        # Run until we hit a non-doubles result (expected in ~5/6 of rolls)
        for _ in range(100):
            result = roll_dice()
            if len(result) == 2:
                return
        self.fail("roll_dice() never returned a 2-item list in 100 rolls — are non-doubles possible?")

    def test_doubles_returns_exactly_four_values(self):
        # Run until we hit a doubles result (expected in ~1/6 of rolls)
        for _ in range(200):
            result = roll_dice()
            if len(result) == 4:
                return
        self.fail("roll_dice() never returned a 4-item list in 200 rolls — are doubles handled?")

    def test_doubles_four_values_are_all_equal(self):
        # When doubles occur, all four values must be the same number
        for _ in range(200):
            result = roll_dice()
            if len(result) == 4:
                self.assertEqual(
                    len(set(result)), 1,
                    f"Doubles should be 4 identical values, got {result}"
                )
                return
        self.fail("Could not find a doubles result in 200 rolls to verify")

    def test_non_doubles_two_values_are_each_valid_dice(self):
        for _ in range(100):
            result = roll_dice()
            if len(result) == 2:
                d1, d2 = result
                self.assertIn(d1, range(1, 7))
                self.assertIn(d2, range(1, 7))
                return

    def test_result_length_is_only_2_or_4(self):
        for _ in range(50):
            result = roll_dice()
            self.assertIn(len(result), [2, 4], f"Unexpected length {len(result)}: {result}")


class InitialBoardStateTest(unittest.TestCase):
    """
    get_initial_board_state() is already implemented — these tests should pass.
    They document the expected board structure for reference as you build on it.
    """

    def setUp(self):
        self.board = get_initial_board_state()

    def test_has_24_points(self):
        self.assertEqual(len(self.board["points"]), 24)

    def test_has_bar_key(self):
        self.assertIn("bar", self.board)
        self.assertIn("p1", self.board["bar"])
        self.assertIn("p2", self.board["bar"])

    def test_has_off_key(self):
        self.assertIn("off", self.board)
        self.assertIn("p1", self.board["off"])
        self.assertIn("p2", self.board["off"])

    def test_bar_starts_empty(self):
        self.assertEqual(self.board["bar"]["p1"], 0)
        self.assertEqual(self.board["bar"]["p2"], 0)

    def test_total_p1_checkers_is_15(self):
        points = self.board["points"]
        total = sum(v for v in points if v > 0) + self.board["off"]["p1"] + self.board["bar"]["p1"]
        self.assertEqual(total, 15)

    def test_total_p2_checkers_is_15(self):
        points = self.board["points"]
        total = sum(abs(v) for v in points if v < 0) + self.board["off"]["p2"] + self.board["bar"]["p2"]
        self.assertEqual(total, 15)

    def test_point_1_has_two_p1_checkers(self):
        # Index 0 = point 1; positive = p1
        self.assertEqual(self.board["points"][0], 2)

    def test_point_24_has_two_p2_checkers(self):
        # Index 23 = point 24; negative = p2
        self.assertEqual(self.board["points"][23], -2)


class OpponentTest(unittest.TestCase):
    def test_opponent_of_p1_is_p2(self):
        self.assertEqual(opponent("p1"), "p2")

    def test_opponent_of_p2_is_p1(self):
        self.assertEqual(opponent("p2"), "p1")


class LegalMovesTest(unittest.TestCase):
    def test_simple_open_move_is_legal(self):
        board = get_initial_board_state()
        moves = get_legal_moves(board, "p1", [1])
        self.assertIn((1, 2, 1), moves)

    def test_move_onto_point_with_two_opponent_checkers_is_illegal(self):
        board = get_initial_board_state()
        # Point 6 (index 5) holds -5 (p2) — blocked for p1.
        moves = get_legal_moves(board, "p1", [5])
        self.assertNotIn((1, 6, 5), moves)

    def test_move_onto_lone_opponent_blot_is_legal(self):
        board = empty_board()
        board["points"][0] = 1  # p1 at point 1
        board["points"][4] = -1  # p2 blot at point 5
        moves = get_legal_moves(board, "p1", [4])
        self.assertIn((1, 5, 4), moves)

    def test_checkers_on_bar_must_enter_first(self):
        board = get_initial_board_state()
        board["bar"]["p1"] = 1
        moves = get_legal_moves(board, "p1", [3])
        self.assertTrue(all(m[0] == 0 for m in moves))
        self.assertIn((0, 3, 3), moves)

    def test_bar_entry_blocked_by_two_opponent_checkers(self):
        board = get_initial_board_state()
        board["bar"]["p1"] = 1
        board["points"][2] = -2  # point 3 blocked
        moves = get_legal_moves(board, "p1", [3])
        self.assertNotIn((0, 3, 3), moves)

    def test_no_moves_without_dice(self):
        board = get_initial_board_state()
        self.assertEqual(get_legal_moves(board, "p1", []), set())

    def test_cannot_bear_off_with_checkers_outside_home(self):
        board = get_initial_board_state()
        moves = get_legal_moves(board, "p1", [1, 2, 3, 4, 5, 6])
        self.assertFalse(any(to == 25 for _, to, _ in moves))

    def test_bear_off_with_exact_die(self):
        board = empty_board()
        board["points"][18] = 1  # point 19, distance 6 for p1
        board["points"][23] = 14  # point 24, distance 1 for p1
        moves = get_legal_moves(board, "p1", [1])
        self.assertIn((24, 25, 1), moves)
        self.assertNotIn((19, 25, 1), moves)

    def test_bear_off_with_higher_die_from_highest_point(self):
        board = empty_board()
        board["points"][23] = 15  # all p1 checkers on point 24, distance 1
        moves = get_legal_moves(board, "p1", [6])
        self.assertIn((24, 25, 6), moves)

    def test_bear_off_with_higher_die_cannot_skip_farther_checker(self):
        board = empty_board()
        board["points"][18] = 1  # point 19, distance 6
        board["points"][23] = 14  # point 24, distance 1
        moves = get_legal_moves(board, "p1", [6])
        self.assertIn((19, 25, 6), moves)
        self.assertNotIn((24, 25, 6), moves)

    def test_p2_moves_toward_lower_points(self):
        board = get_initial_board_state()
        # Point 24 (index 23) holds -2 (p2); p2 moves toward decreasing numbers.
        moves = get_legal_moves(board, "p2", [1])
        self.assertIn((24, 23, 1), moves)

    def test_p2_bar_entry_uses_high_points(self):
        board = get_initial_board_state()
        board["bar"]["p2"] = 1
        moves = get_legal_moves(board, "p2", [3])
        # Die 3 enters p2 on point 25 - 3 = 22.
        self.assertIn((0, 22, 3), moves)


class ApplyMoveTest(unittest.TestCase):
    def test_normal_move_updates_points(self):
        board = get_initial_board_state()
        apply_move(board, "p1", 1, 2)
        self.assertEqual(board["points"][0], 1)
        self.assertEqual(board["points"][1], 1)

    def test_hitting_blot_sends_opponent_to_bar(self):
        board = empty_board()
        board["points"][0] = 1
        board["points"][4] = -1
        apply_move(board, "p1", 1, 5)
        self.assertEqual(board["points"][0], 0)
        self.assertEqual(board["points"][4], 1)
        self.assertEqual(board["bar"]["p2"], 1)

    def test_entering_from_bar_decrements_bar_count(self):
        board = empty_board()
        board["bar"]["p1"] = 1
        apply_move(board, "p1", 0, 3)
        self.assertEqual(board["bar"]["p1"], 0)
        self.assertEqual(board["points"][2], 1)

    def test_bearing_off_increments_off_count(self):
        board = empty_board()
        board["points"][23] = 1
        apply_move(board, "p1", 24, 25)
        self.assertEqual(board["points"][23], 0)
        self.assertEqual(board["off"]["p1"], 1)


class CanBearOffTest(unittest.TestCase):
    def test_false_when_checkers_outside_home(self):
        board = get_initial_board_state()
        self.assertFalse(can_bear_off(board, "p1"))

    def test_false_when_checkers_on_bar(self):
        board = empty_board()
        board["points"][18] = 15
        board["bar"]["p1"] = 1
        self.assertFalse(can_bear_off(board, "p1"))

    def test_true_when_all_checkers_in_home(self):
        board = empty_board()
        board["points"][18] = 15
        self.assertTrue(can_bear_off(board, "p1"))


class CheckWinnerTest(unittest.TestCase):
    def test_no_winner_initially(self):
        board = get_initial_board_state()
        self.assertIsNone(check_winner(board))

    def test_p1_wins_with_15_off(self):
        board = empty_board()
        board["off"]["p1"] = 15
        self.assertEqual(check_winner(board), "p1")

    def test_p2_wins_with_15_off(self):
        board = empty_board()
        board["off"]["p2"] = 15
        self.assertEqual(check_winner(board), "p2")
