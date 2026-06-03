from django.test import TestCase
from rest_framework.test import APIClient
from game.models import Game
from game.game_logic import get_initial_board_state


def make_game(**kwargs):
    """Helper: create a Game with required fields pre-filled."""
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


# ---------------------------------------------------------------------------
# GET /api/games/  and  POST /api/games/
# ---------------------------------------------------------------------------

class GameListCreateTest(TestCase):
    """
    Routing is already wired. These tests FAIL until:
      - Game model fields exist   (POST and list-with-items tests)
      - GameSerializer has a Meta (any test that triggers serialization)

    Run with:
        python manage.py test game.tests.test_views.GameListCreateTest
    """

    def setUp(self):
        self.client = APIClient()

    def test_list_endpoint_returns_200(self):
        response = self.client.get("/api/games/")
        self.assertEqual(response.status_code, 200)

    def test_list_endpoint_returns_empty_list_when_no_games(self):
        response = self.client.get("/api/games/")
        self.assertEqual(response.json(), [])

    def test_create_game_returns_201(self):
        response = self.client.post(
            "/api/games/",
            {"player1_name": "Alice", "player2_name": "Bob"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_create_game_response_includes_id(self):
        response = self.client.post(
            "/api/games/",
            {"player1_name": "Alice", "player2_name": "Bob"},
            format="json",
        )
        self.assertIn("id", response.json())

    def test_create_game_response_echoes_player_names(self):
        response = self.client.post(
            "/api/games/",
            {"player1_name": "Alice", "player2_name": "Bob"},
            format="json",
        )
        data = response.json()
        self.assertEqual(data["player1_name"], "Alice")
        self.assertEqual(data["player2_name"], "Bob")

    def test_create_game_response_includes_status(self):
        response = self.client.post(
            "/api/games/",
            {"player1_name": "Alice", "player2_name": "Bob"},
            format="json",
        )
        self.assertIn("status", response.json())

    def test_list_endpoint_shows_created_games(self):
        make_game()
        make_game(player1_name="Carol", player2_name="Dave")
        response = self.client.get("/api/games/")
        self.assertEqual(len(response.json()), 2)


# ---------------------------------------------------------------------------
# GET /api/games/:id/
# ---------------------------------------------------------------------------

class GameRetrieveTest(TestCase):
    """
    FAIL until model fields + serializer Meta exist.

    Run with:
        python manage.py test game.tests.test_views.GameRetrieveTest
    """

    def setUp(self):
        self.client = APIClient()
        self.game = make_game()

    def test_retrieve_returns_200(self):
        response = self.client.get(f"/api/games/{self.game.pk}/")
        self.assertEqual(response.status_code, 200)

    def test_retrieve_returns_correct_id(self):
        response = self.client.get(f"/api/games/{self.game.pk}/")
        self.assertEqual(response.json()["id"], self.game.pk)

    def test_retrieve_returns_player_names(self):
        response = self.client.get(f"/api/games/{self.game.pk}/")
        data = response.json()
        self.assertEqual(data["player1_name"], "Alice")
        self.assertEqual(data["player2_name"], "Bob")

    def test_retrieve_returns_board_state(self):
        response = self.client.get(f"/api/games/{self.game.pk}/")
        self.assertIn("board_state", response.json())

    def test_retrieve_nonexistent_game_returns_404(self):
        # This should pass once routing is correct, even before full implementation
        response = self.client.get("/api/games/99999/")
        self.assertEqual(response.status_code, 404)


# ---------------------------------------------------------------------------
# POST /api/games/:id/roll_dice/
# ---------------------------------------------------------------------------

class RollDiceEndpointTest(TestCase):
    """
    FAIL until:
      - Model fields + serializer exist  (setUp)
      - roll_dice() is implemented       (the endpoint calls it)

    Run with:
        python manage.py test game.tests.test_views.RollDiceEndpointTest
    """

    def setUp(self):
        self.client = APIClient()
        self.game = make_game()

    def test_roll_dice_returns_200(self):
        response = self.client.post(f"/api/games/{self.game.pk}/roll_dice/")
        self.assertEqual(response.status_code, 200)

    def test_roll_dice_response_includes_dice_values(self):
        response = self.client.post(f"/api/games/{self.game.pk}/roll_dice/")
        data = response.json()
        self.assertIn("dice_values", data)

    def test_roll_dice_response_has_2_or_4_values(self):
        response = self.client.post(f"/api/games/{self.game.pk}/roll_dice/")
        dice = response.json()["dice_values"]
        self.assertIn(len(dice), [2, 4])

    def test_roll_dice_values_are_in_range(self):
        response = self.client.post(f"/api/games/{self.game.pk}/roll_dice/")
        for val in response.json()["dice_values"]:
            self.assertGreaterEqual(val, 1)
            self.assertLessEqual(val, 6)

    def test_roll_dice_persists_dice_to_database(self):
        self.client.post(f"/api/games/{self.game.pk}/roll_dice/")
        self.game.refresh_from_db()
        self.assertGreater(len(self.game.dice_values), 0)


# ---------------------------------------------------------------------------
# POST /api/games/:id/move_checker/
# ---------------------------------------------------------------------------

class MoveCheckerEndpointTest(TestCase):
    """
    FAIL until model fields, serializer, and move logic in views.py are implemented.

    These tests also document the expected board mutation contract:
    moving from_point → to_point should update board_state["points"] accordingly.

    Run with:
        python manage.py test game.tests.test_views.MoveCheckerEndpointTest
    """

    def setUp(self):
        self.client = APIClient()
        # Give p1 a [1] die so a move of 1 step is legal
        self.game = make_game(dice_values=[1])

    def test_move_checker_returns_200(self):
        response = self.client.post(
            f"/api/games/{self.game.pk}/move_checker/",
            {"from_point": 1, "to_point": 2},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_move_checker_missing_body_returns_400(self):
        # views.py already returns 400 for missing fields — this should pass
        response = self.client.post(
            f"/api/games/{self.game.pk}/move_checker/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_move_checker_decrements_source_point(self):
        """
        After moving a p1 checker from point 1 to point 2,
        point 1 (index 0) should have one fewer p1 checker.
        This fails until move logic is written in the view.
        """
        checkers_before = self.game.board_state["points"][0]  # point 1
        self.client.post(
            f"/api/games/{self.game.pk}/move_checker/",
            {"from_point": 1, "to_point": 2},
            format="json",
        )
        self.game.refresh_from_db()
        checkers_after = self.game.board_state["points"][0]
        self.assertEqual(checkers_after, checkers_before - 1)

    def test_move_checker_increments_destination_point(self):
        """
        After moving a p1 checker from point 1 to point 2,
        point 2 (index 1) should have one more p1 checker.
        """
        checkers_before = self.game.board_state["points"][1]  # point 2
        self.client.post(
            f"/api/games/{self.game.pk}/move_checker/",
            {"from_point": 1, "to_point": 2},
            format="json",
        )
        self.game.refresh_from_db()
        checkers_after = self.game.board_state["points"][1]
        self.assertEqual(checkers_after, checkers_before + 1)

    def test_move_checker_consumes_the_used_die(self):
        """
        After using die value 1, it should no longer appear in dice_values.
        """
        self.client.post(
            f"/api/games/{self.game.pk}/move_checker/",
            {"from_point": 1, "to_point": 2},
            format="json",
        )
        self.game.refresh_from_db()
        self.assertEqual(self.game.dice_values, [])
