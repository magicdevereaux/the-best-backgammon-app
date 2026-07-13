"""
Higher-die rule during bear-off (see higher_die_required_moves in game_logic.py):
with a non-double roll, when exactly one die can legally be played but either die
individually has a legal move, the higher die must be played. If the higher die
can bear off exactly, that move is required; otherwise its (furthest-back)
oversized bear-off; otherwise any higher-die move.

Positions here were verified by exhaustive search over small bear-off positions:
the rule only bites when opponent anchors block within-board moves.
"""
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Game
from game.game_logic import higher_die_required_moves


def empty_board():
    return {
        "points": [0] * 24,
        "bar": {"p1": 0, "p2": 0},
        "off": {"p1": 0, "p2": 0},
    }


def make_game(board, dice, off_p1=None):
    if off_p1 is not None:
        board["off"]["p1"] = off_p1
    return Game.objects.create(
        player1_name="Alice",
        player2_name="Bob",
        status="active",
        current_turn="p1",
        dice_values=dice,
        board_state=board,
    )


class HigherDieRequiredMovesTest(TestCase):
    """Function-level tests for the rule itself."""

    def test_exact_bear_off_with_higher_die_is_required(self):
        # p1 on 19 and 20; anchors on 21 and 24. Dice [2, 5]:
        # lower 2 -> only 20->22 (within board); higher 5 -> exact bear-off
        # from 20. Only one die can be played either way, so the 5 is forced.
        board = empty_board()
        board["points"][18] = 1   # point 19
        board["points"][19] = 1   # point 20
        board["points"][20] = -2  # point 21 anchored
        board["points"][23] = -2  # point 24 anchored
        board["off"]["p1"] = 13
        required = higher_die_required_moves(board, "p1", [2, 5])
        self.assertEqual(required, {(20, 25, 5)})

    def test_higher_die_within_board_move_is_required(self):
        # p1 on 19 and 20; anchors on 21 and 23. Dice [1, 3]:
        # lower 1 -> 19->20; higher 3 -> 19->22. Neither die can bear off and
        # only one can be played — the higher die's move is forced.
        board = empty_board()
        board["points"][18] = 1
        board["points"][19] = 1
        board["points"][20] = -2  # point 21
        board["points"][22] = -2  # point 23
        board["off"]["p1"] = 13
        required = higher_die_required_moves(board, "p1", [1, 3])
        self.assertEqual(required, {(19, 22, 3)})

    def test_oversized_bear_off_targets_furthest_back_checker(self):
        # Last checker on point 22 (distance 3), dice [3, 5]. Both dice can
        # bear it off (3 exactly, 5 oversized); only one die can be used. The
        # higher die has no exact target, so its oversized bear-off from the
        # furthest-back checker is required — consuming the 5, not the 3.
        board = empty_board()
        board["points"][21] = 1
        board["off"]["p1"] = 14
        required = higher_die_required_moves(board, "p1", [3, 5])
        self.assertEqual(required, {(22, 25, 5)})

    def test_no_restriction_when_both_dice_usable(self):
        # Open bear-off: p1 on 20 and 22, dice [5, 3]. Both dice can be played
        # (5 bears off 20 exactly, 3 bears off 22 exactly) — free choice.
        board = empty_board()
        board["points"][19] = 1
        board["points"][21] = 1
        board["off"]["p1"] = 13
        self.assertIsNone(higher_die_required_moves(board, "p1", [5, 3]))

    def test_no_restriction_outside_bear_off(self):
        # Same one-die-only shape but a checker outside the home board:
        # p1 on 12, anchor on 15, dice [1, 2]. Either die can be played
        # (12->13 or 12->14) but not both — yet the rule is bear-off-scoped,
        # so no restriction applies.
        board = empty_board()
        board["points"][11] = 1
        board["points"][14] = -2  # point 15
        board["off"]["p1"] = 14
        self.assertIsNone(higher_die_required_moves(board, "p1", [1, 2]))

    def test_no_restriction_when_only_higher_die_playable(self):
        # p1 on 19, anchors 20-23, dice [1, 6]: the 1 has no legal move at
        # all, so there is no choice of die to restrict.
        board = empty_board()
        board["points"][18] = 1
        for idx in (19, 20, 21, 22):
            board["points"][idx] = -2
        board["off"]["p1"] = 14
        self.assertIsNone(higher_die_required_moves(board, "p1", [1, 6]))

    def test_no_restriction_on_doubles(self):
        board = empty_board()
        board["points"][21] = 1
        board["off"]["p1"] = 14
        self.assertIsNone(higher_die_required_moves(board, "p1", [3, 3, 3, 3]))


class HigherDieConfirmTurnTest(TestCase):
    """Endpoint enforcement in confirm_turn."""

    def setUp(self):
        self.client = APIClient()

    def _exact_off_board(self):
        board = empty_board()
        board["points"][18] = 1
        board["points"][19] = 1
        board["points"][20] = -2
        board["points"][23] = -2
        return board

    def test_lower_die_move_rejected_when_higher_would_work(self):
        game = make_game(self._exact_off_board(), [2, 5], off_p1=13)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 20, "to_point": 22}]},  # the lower die (2)
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("higher die (5)", res.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")
        self.assertEqual(game.dice_values, [2, 5])
        expected = self._exact_off_board()
        expected["off"]["p1"] = 13
        self.assertEqual(game.board_state, expected)

    def test_higher_die_exact_bear_off_accepted(self):
        game = make_game(self._exact_off_board(), [2, 5], off_p1=13)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 20, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.board_state["off"]["p1"], 14)
        self.assertEqual(game.current_turn, "p2")

    def test_higher_die_within_board_move_enforced(self):
        board = empty_board()
        board["points"][18] = 1
        board["points"][19] = 1
        board["points"][20] = -2
        board["points"][22] = -2
        game = make_game(board, [1, 3], off_p1=13)

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 19, "to_point": 20}]},  # the lower die (1)
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("higher die (3)", res.json()["error"])

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 19, "to_point": 22}]},  # the higher die
            format="json",
        )
        self.assertEqual(res.status_code, 200)

    def test_both_dice_usable_allows_free_choice(self):
        # Open bear-off, dice [5, 3]: both must be used (maximal usage) and
        # either order is accepted — the higher-die rule stays out of it.
        board = empty_board()
        board["points"][19] = 1
        board["points"][21] = 1
        game = make_game(board, [5, 3], off_p1=13)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 22, "to_point": 25}, {"from_point": 20, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.board_state["off"]["p1"], 15)

    def test_non_bear_off_position_unaffected(self):
        # One-die-only choice outside bear-off: the lower die's move confirms
        # fine, documenting that the rule is scoped to bear-off.
        board = empty_board()
        board["points"][11] = 1   # point 12 — outside home, no bear-off
        board["points"][14] = -2  # point 15 blocks both follow-ups
        game = make_game(board, [1, 2], off_p1=14)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 12, "to_point": 13}]},  # the lower die
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")
