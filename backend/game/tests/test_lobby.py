from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Game
from game.game_logic import get_initial_board_state


def make_user(username="alice", password="securepass123"):
    return User.objects.create_user(username=username, password=password)


def auth_client(user, password="securepass123"):
    client = APIClient()
    resp = client.post(
        "/api/auth/login/",
        {"username": user.username, "password": password},
        format="json",
    )
    token = resp.json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


class GameCreationTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_create_with_both_names_starts_active_hotseat(self):
        resp = self.client.post(
            "/api/games/",
            {"player1_name": "Alice", "player2_name": "Bob"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["status"], "active")

    def test_create_with_only_player1_name_starts_waiting(self):
        resp = self.client.post(
            "/api/games/",
            {"player1_name": "Alice"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["status"], "waiting")

    def test_authenticated_create_links_player1_user(self):
        user = make_user()
        client = auth_client(user)
        resp = client.post("/api/games/", {}, format="json")
        self.assertEqual(resp.status_code, 201)
        game = Game.objects.get(pk=resp.json()["id"])
        self.assertEqual(game.player1_user, user)

    def test_authenticated_create_uses_username_as_default_name(self):
        user = make_user()
        client = auth_client(user)
        resp = client.post("/api/games/", {}, format="json")
        self.assertEqual(resp.json()["player1_name"], "alice")

    def test_authenticated_create_with_player2_starts_active(self):
        user = make_user()
        client = auth_client(user)
        resp = client.post(
            "/api/games/",
            {"player2_name": "Bob"},
            format="json",
        )
        self.assertEqual(resp.json()["status"], "active")


class LobbyListTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_status_filter_returns_only_waiting_games(self):
        Game.objects.create(
            player1_name="Alice", player2_name="",
            board_state=get_initial_board_state(), dice_values=[],
            status="waiting",
        )
        Game.objects.create(
            player1_name="Carol", player2_name="Dave",
            board_state=get_initial_board_state(), dice_values=[],
            status="active",
        )
        resp = self.client.get("/api/games/?status=waiting")
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["status"], "waiting")

    def test_no_filter_returns_all_games(self):
        Game.objects.create(
            player1_name="Alice", player2_name="",
            board_state=get_initial_board_state(), dice_values=[],
            status="waiting",
        )
        Game.objects.create(
            player1_name="Carol", player2_name="Dave",
            board_state=get_initial_board_state(), dice_values=[],
            status="active",
        )
        resp = self.client.get("/api/games/")
        self.assertEqual(len(resp.json()), 2)


class JoinGameTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _make_waiting_game(self, player1_name="Alice"):
        return Game.objects.create(
            player1_name=player1_name, player2_name="",
            board_state=get_initial_board_state(), dice_values=[],
            status="waiting",
        )

    def test_guest_join_with_name_makes_game_active(self):
        game = self._make_waiting_game()
        resp = self.client.post(
            f"/api/games/{game.pk}/join/",
            {"player2_name": "Bob"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.status, "active")
        self.assertEqual(game.player2_name, "Bob")

    def test_guest_join_without_name_returns_400(self):
        game = self._make_waiting_game()
        resp = self.client.post(f"/api/games/{game.pk}/join/", {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_authenticated_join_uses_username_as_player2_name(self):
        user = make_user(username="bob")
        client = auth_client(user)
        game = self._make_waiting_game()
        resp = client.post(f"/api/games/{game.pk}/join/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.player2_user, user)
        self.assertEqual(game.player2_name, "bob")

    def test_join_active_game_returns_400(self):
        game = Game.objects.create(
            player1_name="Alice", player2_name="Bob",
            board_state=get_initial_board_state(), dice_values=[],
            status="active",
        )
        resp = self.client.post(
            f"/api/games/{game.pk}/join/",
            {"player2_name": "Carol"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_game_state_persists_after_session_boundary(self):
        """Fetching a game by id restores its board state exactly."""
        from game.game_logic import get_initial_board_state
        board = get_initial_board_state()
        game = Game.objects.create(
            player1_name="Alice", player2_name="Bob",
            board_state=board, dice_values=[3, 5],
            current_turn="p2", status="active",
        )
        resp = self.client.get(f"/api/games/{game.pk}/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["board_state"], board)
        self.assertEqual(data["dice_values"], [3, 5])
        self.assertEqual(data["current_turn"], "p2")
