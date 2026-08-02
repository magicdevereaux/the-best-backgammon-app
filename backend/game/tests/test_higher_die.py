"""
Higher-die rule (see higher_die_required_moves in game_logic.py): with a
non-double roll, when exactly one die can legally be played but either die
individually has a legal move, the higher die must be played. The rule is
general — it applies while entering from the bar, in blocked mid-board
positions, and while bearing off alike. If the higher die can bear off exactly,
that move is required; otherwise its (furthest-back) oversized bear-off;
otherwise any higher-die move.

Positions here were verified against the engine; the rule only bites when
opponent anchors block the alternative continuations.
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


def make_game(board, dice, off_p1=None, current_turn="p1"):
    if off_p1 is not None:
        board["off"]["p1"] = off_p1
    return Game.objects.create(
        player1_name="Alice",
        player2_name="Bob",
        status="active",
        current_turn=current_turn,
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

    def test_p2_bear_off_mirrors_p1(self):
        # Mirror of the exact-bear-off case for p2 (home board 1-6, moving
        # toward lower points): p2 on 5 and 6, p1 anchors on 1 and 4.
        # Dice [2, 5]: the 2 only plays 5->3; the 5 bears off from 5 exactly.
        board = empty_board()
        board["points"][5] = -1  # point 6
        board["points"][4] = -1  # point 5
        board["points"][3] = 2   # point 4 anchored
        board["points"][0] = 2   # point 1 anchored
        board["off"]["p2"] = 13
        required = higher_die_required_moves(board, "p2", [2, 5])
        self.assertEqual(required, {(5, 25, 5)})

    def test_mid_board_higher_die_is_required(self):
        # Nothing to do with bear-off: p1's lone checker on 12 with an anchor
        # on 15. Either die plays (12->13 or 12->14) but the follow-up is
        # blocked both ways, so only one die is usable and the 2 is forced.
        board = empty_board()
        board["points"][11] = 1   # point 12
        board["points"][14] = -2  # point 15
        board["off"]["p1"] = 14
        required = higher_die_required_moves(board, "p1", [1, 2])
        self.assertEqual(required, {(12, 14, 2)})

    def test_mid_board_higher_die_is_required_for_p2(self):
        # Same shape mirrored: p2 moves toward lower points, so its lone
        # checker on 13 plays 13->12 (the 1) or 13->11 (the 2), and the anchor
        # on 10 blocks either follow-up. The 2 is forced.
        board = empty_board()
        board["points"][12] = -1  # point 13
        board["points"][9] = 2    # point 10 anchored
        board["off"]["p2"] = 14
        required = higher_die_required_moves(board, "p2", [1, 2])
        self.assertEqual(required, {(13, 11, 2)})

    def test_bar_entry_higher_die_is_required(self):
        # p1's last checker is on the bar; points 2 and 5 are both open so
        # either die enters, but point 7 blocks the follow-up from either entry
        # square. Only one die is usable, so the 5 must be the one entered on.
        board = empty_board()
        board["bar"]["p1"] = 1
        board["points"][6] = -2  # point 7
        board["off"]["p1"] = 14
        required = higher_die_required_moves(board, "p1", [2, 5])
        self.assertEqual(required, {(0, 5, 5)})

    def test_bar_entry_higher_die_is_required_for_p2(self):
        # Mirror: p2 enters on 25 - die, so [2, 5] offers points 23 and 20, and
        # the anchor on 18 blocks both follow-ups. The 5 (entering on 20) wins.
        board = empty_board()
        board["bar"]["p2"] = 1
        board["points"][17] = 2  # point 18
        board["off"]["p2"] = 14
        required = higher_die_required_moves(board, "p2", [2, 5])
        self.assertEqual(required, {(0, 20, 5)})

    def test_no_restriction_when_both_dice_usable(self):
        # Open bear-off: p1 on 20 and 22, dice [5, 3]. Both dice can be played
        # (5 bears off 20 exactly, 3 bears off 22 exactly) — free choice.
        board = empty_board()
        board["points"][19] = 1
        board["points"][21] = 1
        board["off"]["p1"] = 13
        self.assertIsNone(higher_die_required_moves(board, "p1", [5, 3]))

    def test_no_restriction_when_only_lower_die_playable(self):
        # p1 on 12 with anchors on 18 and 19: the 6 has no legal move at all
        # (12->18 blocked), so the 1 is played by default, not by choice.
        board = empty_board()
        board["points"][11] = 1
        board["points"][17] = -2  # point 18
        board["points"][18] = -2  # point 19
        board["off"]["p1"] = 14
        self.assertIsNone(higher_die_required_moves(board, "p1", [1, 6]))

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

    def test_no_restriction_on_doubles_even_when_one_die_usable(self):
        # p1 on 12 with an anchor on 16: [2,2,2,2] plays 12->14 and then
        # stops, so exactly one die is usable — but doubles have no higher die
        # and the rule stays out.
        board = empty_board()
        board["points"][11] = 1
        board["points"][15] = -2  # point 16
        board["off"]["p1"] = 14
        self.assertIsNone(higher_die_required_moves(board, "p1", [2, 2, 2, 2]))


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

    def test_mid_board_lower_die_rejected_then_higher_accepted(self):
        # The rule outside bear-off: p1's lone checker on 12, anchor on 15.
        def board():
            b = empty_board()
            b["points"][11] = 1
            b["points"][14] = -2
            return b

        game = make_game(board(), [1, 2], off_p1=14)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 12, "to_point": 13}]},  # the lower die
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("higher die (2)", res.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 12, "to_point": 14}]},  # the higher die
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")

    def test_bar_entry_lower_die_rejected_then_higher_accepted(self):
        def board():
            b = empty_board()
            b["bar"]["p1"] = 1
            b["points"][6] = -2
            return b

        game = make_game(board(), [2, 5], off_p1=14)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 0, "to_point": 2}]},  # entered on the 2
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("higher die (5)", res.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.board_state["bar"]["p1"], 1)

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 0, "to_point": 5}]},  # entered on the 5
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.board_state["bar"]["p1"], 0)
        self.assertEqual(game.board_state["points"][4], 1)

    def test_bar_entry_enforced_for_p2(self):
        board = empty_board()
        board["bar"]["p2"] = 1
        board["points"][17] = 2  # point 18
        board["off"]["p2"] = 14
        game = make_game(board, [2, 5], current_turn="p2")

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 0, "to_point": 23}]},  # entered on the 2
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("higher die (5)", res.json()["error"])

        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 0, "to_point": 20}]},  # entered on the 5
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.board_state["points"][19], -1)

    def test_only_lower_die_playable_is_accepted(self):
        # The higher die has no legal move anywhere, so playing the lower one
        # is the whole turn and the rule must not fire.
        board = empty_board()
        board["points"][11] = 1
        board["points"][17] = -2  # point 18 blocks the 6
        board["points"][18] = -2  # point 19 blocks the 6 after the 1
        game = make_game(board, [1, 6], off_p1=14)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 12, "to_point": 13}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")

    def test_doubles_unaffected(self):
        # Only one die is usable, but doubles are exempt: 12->14 confirms.
        board = empty_board()
        board["points"][11] = 1
        board["points"][15] = -2  # point 16
        game = make_game(board, [2, 2, 2, 2], off_p1=14)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 12, "to_point": 14}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")
