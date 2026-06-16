from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Game


def make_user(username="alice", password="securepass123"):
    return User.objects.create_user(username=username, password=password)


def get_tokens(client, username="alice", password="securepass123"):
    resp = client.post(
        "/api/auth/login/",
        {"username": username, "password": password},
        format="json",
    )
    return resp.json()


class RegisterTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_creates_user_and_returns_tokens(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn("access", data)
        self.assertIn("refresh", data)
        self.assertEqual(data["user"]["username"], "alice")
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_register_duplicate_username_returns_400(self):
        make_user()
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_register_short_password_returns_400(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": "short"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_register_returns_initial_win_loss_counts(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(resp.json()["user"]["wins"], 0)
        self.assertEqual(resp.json()["user"]["losses"], 0)


class LoginTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        make_user()

    def test_login_returns_tokens(self):
        resp = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": "securepass123"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.json())
        self.assertIn("refresh", resp.json())

    def test_login_wrong_password_returns_401(self):
        resp = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": "wrongpassword"},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)


class MeViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_me_without_auth_returns_401(self):
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 401)

    def test_me_with_valid_token_returns_user_data(self):
        tokens = get_tokens(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["username"], "alice")
        self.assertIn("wins", data)
        self.assertIn("losses", data)

    def test_me_counts_wins_correctly(self):
        tokens = get_tokens(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        # Game where alice is p1 and wins
        Game.objects.create(
            player1_user=self.user, player1_name="alice",
            player2_name="bob", board_state={}, dice_values=[],
            status="finished", winner="p1",
        )
        # Game where alice is p2 and wins
        Game.objects.create(
            player2_user=self.user, player2_name="alice",
            player1_name="bob", board_state={}, dice_values=[],
            status="finished", winner="p2",
        )
        # Game where alice loses
        Game.objects.create(
            player1_user=self.user, player1_name="alice",
            player2_name="bob", board_state={}, dice_values=[],
            status="finished", winner="p2",
        )

        resp = self.client.get("/api/auth/me/")
        data = resp.json()
        self.assertEqual(data["wins"], 2)
        self.assertEqual(data["losses"], 1)

    def test_token_refresh_returns_new_access_token(self):
        tokens = get_tokens(self.client)
        resp = self.client.post(
            "/api/auth/refresh/",
            {"refresh": tokens["refresh"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.json())
