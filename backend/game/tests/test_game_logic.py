import unittest
from game.game_logic import roll_dice, get_initial_board_state


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
