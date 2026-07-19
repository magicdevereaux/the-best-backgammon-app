"""
Doubling cube: offer/accept/drop flow, cube ownership, scoring multiplication,
Crawford rule, and seat security on the cube endpoints.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Game, Match
from game.game_logic import get_initial_board_state


def empty_board():
    return {"points": [0] * 24, "bar": {"p1": 0, "p2": 0}, "off": {"p1": 0, "p2": 0}}


def make_game(**kwargs):
    defaults = dict(
        player1_name="Alice",
        player2_name="Bob",
        status="active",
        current_turn="p1",
        dice_values=[],
        board_state=get_initial_board_state(),
    )
    defaults.update(kwargs)
    return Game.objects.create(**defaults)


class OfferDoubleTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_offer_double_sets_pending_offer(self):
        game = make_game()
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["double_offered_by"], "p1")
        # Cube unchanged until the opponent accepts.
        self.assertEqual(data["cube_value"], 1)
        self.assertIsNone(data["cube_owner"])

    def test_cannot_double_after_rolling(self):
        game = make_game(dice_values=[3, 5])
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("before rolling", res.json()["error"])

    def test_cannot_double_when_opponent_owns_cube(self):
        game = make_game(cube_value=2, cube_owner="p2", current_turn="p1")
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("opponent owns the cube", res.json()["error"])

    def test_cube_owner_may_redouble(self):
        game = make_game(cube_value=2, cube_owner="p1", current_turn="p1")
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["double_offered_by"], "p1")

    def test_cannot_offer_twice(self):
        game = make_game(double_offered_by="p1")
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 400)

    def test_cannot_double_at_cube_cap(self):
        game = make_game(cube_value=64, cube_owner="p1", current_turn="p1")
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("maximum", res.json()["error"])

    def test_cannot_double_in_crawford_game(self):
        game = make_game(crawford_game=True)
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Crawford", res.json()["error"])

    def test_rolling_blocked_while_double_pending(self):
        game = make_game(double_offered_by="p1")
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("accept or drop", res.json()["error"])

    def test_confirm_turn_blocked_while_double_pending(self):
        game = make_game(double_offered_by="p1", dice_values=[3, 5])
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/", {"moves": []}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("accept or drop", res.json()["error"])


class RespondToDoubleTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_accept_doubles_cube_and_transfers_ownership(self):
        game = make_game(double_offered_by="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["cube_value"], 2)
        self.assertEqual(data["cube_owner"], "p2")  # acceptor owns the cube
        self.assertIsNone(data["double_offered_by"])
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["current_turn"], "p1")  # offerer still to roll

    def test_accept_redouble_reaches_four_and_returns_ownership(self):
        game = make_game(
            cube_value=2, cube_owner="p2", current_turn="p2", double_offered_by="p2"
        )
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["cube_value"], 4)
        self.assertEqual(data["cube_owner"], "p1")

    def test_drop_ends_game_at_pre_double_stakes(self):
        game = make_game(cube_value=2, cube_owner="p1", double_offered_by="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": False}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "finished")
        self.assertEqual(data["winner"], "p1")
        self.assertEqual(data["win_type"], "drop")
        self.assertEqual(data["points_value"], 2)  # pre-double cube value
        self.assertEqual(data["cube_value"], 2)    # never doubled
        self.assertIsNone(data["double_offered_by"])

    def test_drop_updates_match_score(self):
        match = Match.objects.create(
            player1_name="Alice", player2_name="Bob", target_points=5
        )
        game = make_game(match=match, double_offered_by="p1", cube_value=2, cube_owner="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": False}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        match.refresh_from_db()
        self.assertEqual(match.player1_score, 2)
        self.assertEqual(match.player2_score, 0)

    def test_respond_requires_pending_offer(self):
        game = make_game()
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_respond_requires_boolean_accept(self):
        game = make_game(double_offered_by="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": "yes"}, format="json"
        )
        self.assertEqual(res.status_code, 400)


class CubeScoringTest(TestCase):
    """Cube value multiplies gammon/backgammon points on board wins."""

    def setUp(self):
        self.client = APIClient()

    def _near_win_game(self, **kwargs):
        # p1 bears off their last checker; p2 has borne off nothing → gammon
        # (or backgammon if p2 is on the bar).
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1
        board["points"][0] = -15
        return make_game(board_state=board, dice_values=[1], **kwargs)

    def test_gammon_with_cube_4_scores_8(self):
        game = self._near_win_game(cube_value=4, cube_owner="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 24, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "gammon")
        self.assertEqual(data["points_value"], 8)

    def test_backgammon_with_cube_4_scores_12(self):
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1
        board["bar"]["p2"] = 1
        board["points"][0] = -14
        game = make_game(board_state=board, dice_values=[1], cube_value=4, cube_owner="p2")
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 24, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "backgammon")
        self.assertEqual(data["points_value"], 12)

    def test_normal_win_at_cube_1_still_scores_1(self):
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1
        board["off"]["p2"] = 3
        game = make_game(board_state=board, dice_values=[1])
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 24, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "normal")
        self.assertEqual(data["points_value"], 1)

    def test_cube_win_updates_match_score_with_multiplied_points(self):
        match = Match.objects.create(
            player1_name="Alice", player2_name="Bob", target_points=9
        )
        game = self._near_win_game(match=match, cube_value=2, cube_owner="p1")
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 24, "to_point": 25}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        match.refresh_from_db()
        self.assertEqual(match.player1_score, 4)  # gammon (2) × cube (2)


class CrawfordRuleTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _match_with_finished_game(self, p1_score, p2_score, target=5, crawford_played=False):
        match = Match.objects.create(
            player1_name="Alice", player2_name="Bob", target_points=target,
            player1_score=p1_score, player2_score=p2_score,
        )
        board = empty_board()
        board["off"]["p1"] = 15
        Game.objects.create(
            match=match, player1_name="Alice", player2_name="Bob",
            board_state=board, current_turn="p1", dice_values=[],
            status="finished", winner="p1", win_type="normal", points_value=1,
            crawford_game=crawford_played,
        )
        return match

    def test_next_game_at_match_point_is_crawford(self):
        match = self._match_with_finished_game(4, 2)  # p1 at match point (5-target)
        res = self.client.post(f"/api/matches/{match.pk}/next_game/")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.json()["crawford_game"])

    def test_next_game_not_at_match_point_is_not_crawford(self):
        match = self._match_with_finished_game(2, 2)
        res = self.client.post(f"/api/matches/{match.pk}/next_game/")
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.json()["crawford_game"])

    def test_post_crawford_doubling_resumes(self):
        # The Crawford game has already been played; the next game allows
        # doubling even though a player is still at match point.
        match = self._match_with_finished_game(4, 2, crawford_played=True)
        res = self.client.post(f"/api/matches/{match.pk}/next_game/")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertFalse(data["crawford_game"])

        # And offering a double in that game succeeds.
        res = self.client.post(f"/api/games/{data['id']}/offer_double/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["double_offered_by"], "p1")

    def test_crawford_game_starts_with_centered_cube(self):
        match = self._match_with_finished_game(4, 0)
        res = self.client.post(f"/api/matches/{match.pk}/next_game/")
        data = res.json()
        self.assertEqual(data["cube_value"], 1)
        self.assertIsNone(data["cube_owner"])


class CubeSeatSecurityTest(TestCase):
    """Cube endpoints follow the same seat enforcement as gameplay actions."""

    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(username="alice", password="password123")
        self.bob = User.objects.create_user(username="bob", password="password123")
        self.mallory = User.objects.create_user(username="mallory", password="password123")

    def _owned_game(self, **kwargs):
        return make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
            **kwargs,
        )

    def test_only_current_player_may_offer(self):
        game = self._owned_game(current_turn="p1")
        self.client.force_authenticate(user=self.bob)
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not your turn", res.json()["error"])

    def test_non_participant_cannot_offer(self):
        game = self._owned_game()
        self.client.force_authenticate(user=self.mallory)
        res = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(res.status_code, 403)

    def test_offerer_cannot_answer_their_own_double(self):
        game = self._owned_game(current_turn="p1", double_offered_by="p1")
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("not your turn", res.json()["error"])

    def test_opponent_may_answer_the_double(self):
        game = self._owned_game(current_turn="p1", double_offered_by="p1")
        self.client.force_authenticate(user=self.bob)
        res = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["cube_value"], 2)
