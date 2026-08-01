"""
Tests for POST /api/games/{id}/abandon/.

Account deletion closes the deleted player's seat (``player*_deleted``), and
``_seat_permission_error`` then refuses that seat to *everyone* — including the
surviving opponent, who would otherwise be able to play both sides. The
deliberate consequence is a game that can never advance once it is the closed
seat's turn. This endpoint is the escape hatch, and the interesting part is
everything it refuses to do: it is not a resign button, it awards no points, and
it never runs on a game that is merely inconvenient rather than genuinely stuck.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_abandon
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.game_logic import get_initial_board_state
from game.models import Game, Match


PASSWORD = "securepass123"


def make_user(username, password=PASSWORD):
    return User.objects.create_user(username=username, password=password)


def login(client, username, password=PASSWORD):
    resp = client.post(
        "/api/auth/login/", {"username": username, "password": password}, format="json"
    )
    return resp.json()["access"]


def make_match(p1_user=None, p2_user=None, **kwargs):
    return Match.objects.create(
        player1_user=p1_user,
        player2_user=p2_user,
        player1_name=p1_user.username if p1_user else "Guest 1",
        player2_name=p2_user.username if p2_user else "Guest 2",
        target_points=5,
        **kwargs,
    )


def make_game(match=None, p1_user=None, p2_user=None, **kwargs):
    """An active game, by default with both seats open and p1 to move."""
    fields = {
        "match": match,
        "player1_user": p1_user,
        "player2_user": p2_user,
        "player1_name": p1_user.username if p1_user else "Guest 1",
        "player2_name": p2_user.username if p2_user else "Guest 2",
        "board_state": get_initial_board_state(),
        "current_turn": "p1",
        "dice_values": [],
        "status": "active",
    }
    fields.update(kwargs)
    return Game.objects.create(**fields)


def close_seat(game, seat):
    """Mimic what account deletion leaves behind: null FK + closure flag."""
    setattr(game, f"{seat}_user", None)
    setattr(game, f"{seat}_deleted", True)
    game.save()
    if game.match_id:
        match = game.match
        setattr(match, f"{seat}_user", None)
        setattr(match, f"{seat}_deleted", True)
        match.save()


class AbandonHappyPathTest(TestCase):
    """The one position this endpoint exists for: survivor closes out a deadlock."""

    def setUp(self):
        self.client = APIClient()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.match = make_match(self.alice, self.bob)
        self.game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        close_seat(self.game, "player1")
        self.token = login(self.client, "bob")

    def test_survivor_can_abandon_a_deadlocked_game(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

        resp = self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 200)

        body = resp.json()
        self.assertEqual(body["status"], "finished")
        self.assertIsNone(body["winner"])
        self.assertEqual(body["win_type"], "abandoned")

        self.game.refresh_from_db()
        self.assertEqual(self.game.status, "finished")
        self.assertIsNone(self.game.winner)
        self.assertEqual(self.game.win_type, "abandoned")
        self.assertEqual(self.game.points_value, 0)

    def test_no_points_are_fabricated(self):
        """The whole reason auto-forfeit was rejected: scores must not move."""
        self.match.player1_score = 2
        self.match.player2_score = 1
        self.match.save()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

        resp = self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 200)

        self.match.refresh_from_db()
        self.assertEqual(self.match.player1_score, 2)
        self.assertEqual(self.match.player2_score, 1)
        self.assertIsNone(self.match.winner)

    def test_match_is_finished_without_a_winner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")

        self.match.refresh_from_db()
        self.assertEqual(self.match.status, "finished")
        self.assertIsNone(self.match.winner)

    def test_match_cannot_spawn_another_dead_game(self):
        """
        next_game copies the closure flags onto the game it creates, so an open
        match would just hand the survivor a fresh deadlock. Finishing the match
        is what closes that loop.
        """
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")

        resp = self.client.post(f"/api/matches/{self.match.id}/next_game/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.match.games.count(), 1)

    def test_pending_dice_and_double_are_cleared(self):
        self.game.dice_values = [3, 5]
        self.game.save()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

        self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        self.game.refresh_from_db()
        self.assertEqual(self.game.dice_values, [])
        self.assertIsNone(self.game.double_offered_by)

    def test_game_without_a_match_can_be_abandoned(self):
        solo = make_game(None, self.alice, self.bob, current_turn="p1")
        close_seat(solo, "player1")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

        resp = self.client.post(f"/api/games/{solo.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        solo.refresh_from_db()
        self.assertEqual(solo.win_type, "abandoned")

    def test_end_to_end_after_a_real_account_deletion(self):
        """The same flow driven through DELETE /api/auth/me/ rather than fixtures."""
        carol = make_user("carol")
        dave = make_user("dave")
        match = make_match(carol, dave)
        game = make_game(match, carol, dave, current_turn="p1")

        deleter = APIClient()
        deleter.credentials(HTTP_AUTHORIZATION=f"Bearer {login(deleter, 'carol')}")
        self.assertEqual(
            deleter.delete("/api/auth/me/", {"password": PASSWORD}, format="json").status_code,
            204,
        )

        survivor = APIClient()
        survivor.credentials(HTTP_AUTHORIZATION=f"Bearer {login(survivor, 'dave')}")

        # Confirm the deadlock is real before escaping it.
        self.assertEqual(
            survivor.post(f"/api/games/{game.id}/roll_dice/", {}, format="json").status_code,
            403,
        )
        self.assertEqual(
            survivor.post(f"/api/games/{game.id}/abandon/", {}, format="json").status_code,
            200,
        )
        game.refresh_from_db()
        match.refresh_from_db()
        self.assertEqual(game.win_type, "abandoned")
        self.assertEqual(match.status, "finished")
        self.assertEqual((match.player1_score, match.player2_score), (0, 0))


class AbandonPermissionTest(TestCase):
    """Only the surviving seat may call it."""

    def setUp(self):
        self.client = APIClient()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.match = make_match(self.alice, self.bob)
        self.game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        close_seat(self.game, "player1")

    def assertRefused(self, resp):
        self.assertEqual(resp.status_code, 403)
        self.game.refresh_from_db()
        self.assertEqual(self.game.status, "active")

    def test_a_stranger_cannot_abandon(self):
        make_user("mallory")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'mallory')}")
        self.assertRefused(
            self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        )

    def test_the_closed_seats_owner_cannot_abandon(self):
        """
        The deleted account is gone, so the closest thing to its "owner" is a
        re-registration of the same username. It is a different user row and not
        a participant, and it must not be able to close out the game it left.
        """
        make_user("alice2")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'alice2')}")
        self.assertRefused(
            self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        )

    def test_anonymous_cannot_abandon_for_a_registered_survivor(self):
        self.assertRefused(
            self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        )

    def test_both_seats_closed_leaves_nobody_able_to_abandon(self):
        close_seat(self.game, "player2")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'bob')}")
        # bob's own seat is closed too — there is no survivor to act for.
        self.assertRefused(
            self.client.post(f"/api/games/{self.game.id}/abandon/", {}, format="json")
        )

    def test_a_guest_survivor_may_abandon_anonymously(self):
        """The documented guest-seat trade-off, applied consistently here."""
        match = make_match(self.alice, None)
        game = make_game(match, self.alice, None, current_turn="p1")
        close_seat(game, "player1")

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.win_type, "abandoned")

    def test_another_account_cannot_abandon_for_a_guest_survivor(self):
        match = make_match(self.alice, None)
        game = make_game(match, self.alice, None, current_turn="p1")
        close_seat(game, "player1")

        make_user("mallory")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'mallory')}")
        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 403)
        game.refresh_from_db()
        self.assertEqual(game.status, "active")


class AbandonPreconditionTest(TestCase):
    """It only fires on a genuine deadlock — it is not a resign button."""

    def setUp(self):
        self.client = APIClient()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.match = make_match(self.alice, self.bob)

    def as_bob(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'bob')}")

    def test_a_healthy_game_cannot_be_abandoned(self):
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        self.as_bob()

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not abandoned", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_a_closed_seat_that_is_not_to_move_is_not_yet_a_deadlock(self):
        """
        p1's seat is closed but it is p2's turn, so play can still proceed. The
        survivor must actually be stuck before they get to end the game.
        """
        game = make_game(self.match, self.alice, self.bob, current_turn="p2")
        close_seat(game, "player1")
        self.as_bob()

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_a_finished_game_is_400(self):
        game = make_game(
            self.match,
            self.alice,
            self.bob,
            current_turn="p1",
            status="finished",
            winner="p2",
            win_type="single",
            points_value=1,
        )
        close_seat(game, "player1")
        self.as_bob()

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("already finished", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.winner, "p2")
        self.assertEqual(game.win_type, "single")

    def test_a_waiting_game_is_400(self):
        game = make_game(self.match, self.alice, self.bob, current_turn="p1", status="waiting")
        close_seat(game, "player1")
        self.as_bob()

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not active", resp.json()["error"])

    def test_a_pending_double_moves_the_blocked_seat_to_the_responder(self):
        """
        A pending double is answered by the *offerer's opponent*, so that is the
        seat whose closure deadlocks the game — exactly how respond_to_double
        picks its seat.
        """
        game = make_game(
            self.match, self.alice, self.bob, current_turn="p1", double_offered_by="p1"
        )
        close_seat(game, "player2")

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(self.client, 'alice')}")
        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.win_type, "abandoned")

    def test_a_closed_offerer_with_a_pending_double_is_not_a_deadlock(self):
        """The survivor still owes an answer, so the game can still move."""
        game = make_game(
            self.match, self.alice, self.bob, current_turn="p1", double_offered_by="p1"
        )
        close_seat(game, "player1")
        self.as_bob()

        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_abandoning_twice_is_400(self):
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        close_seat(game, "player1")
        self.as_bob()

        self.assertEqual(
            self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json").status_code,
            200,
        )
        resp = self.client.post(f"/api/games/{game.id}/abandon/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.match.refresh_from_db()
        self.assertEqual((self.match.player1_score, self.match.player2_score), (0, 0))
