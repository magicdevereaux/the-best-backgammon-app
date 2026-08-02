"""
Tests for the in-app account deletion path: DELETE /api/auth/me/.

Both app stores require a logged-in user to be able to destroy their own
account from inside the app, so this endpoint is a submission blocker as much
as a feature. The interesting behaviour is not the happy path but what it
leaves behind: the opponent's games and match history must survive with the
deleted player's seat *anonymised*, and every token the account ever held must
stop working.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_account_deletion
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)

from game.game_logic import get_initial_board_state
from game.models import Game, Match


PASSWORD = "securepass123"


def make_user(username="alice", password=PASSWORD):
    return User.objects.create_user(username=username, password=password)


def login(client, username="alice", password=PASSWORD):
    """Log in and return the raw token pair (without attaching credentials)."""
    resp = client.post(
        "/api/auth/login/",
        {"username": username, "password": password},
        format="json",
    )
    return resp.json()


class AccountDeleteAuthTest(TestCase):
    """Who may call the endpoint, and with what."""

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_anonymous_delete_returns_401(self):
        resp = self.client.delete("/api/auth/me/", {"password": PASSWORD}, format="json")
        self.assertEqual(resp.status_code, 401)
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_missing_password_returns_400(self):
        tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        resp = self.client.delete("/api/auth/me/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("password", resp.json())
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_wrong_password_returns_400_and_keeps_the_account(self):
        tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        resp = self.client.delete(
            "/api/auth/me/", {"password": "notmypassword"}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["password"], ["Password is incorrect."])
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_correct_password_returns_204_and_removes_the_user(self):
        tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        resp = self.client.delete("/api/auth/me/", {"password": PASSWORD}, format="json")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(User.objects.filter(username="alice").exists())

    def test_deletion_only_ever_targets_the_caller(self):
        """
        The target comes from the bearer token, never the payload — a `username`
        (or any other identifier) in the body is ignored, so there is no way to
        aim this endpoint at somebody else's account.
        """
        victim = make_user("bob")
        tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        resp = self.client.delete(
            "/api/auth/me/",
            {"password": PASSWORD, "username": "bob", "id": victim.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(User.objects.filter(username="alice").exists())
        self.assertTrue(User.objects.filter(username="bob").exists())

    def test_get_me_still_works(self):
        """Adding DELETE must not disturb the profile read on the same route."""
        tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["username"], "alice")


class AccountDeleteTokenTest(TestCase):
    """Every token the account held must stop working immediately."""

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.tokens = login(self.client)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.tokens['access']}")

    def _delete(self):
        resp = self.client.delete("/api/auth/me/", {"password": PASSWORD}, format="json")
        self.assertEqual(resp.status_code, 204)

    def test_access_token_is_rejected_afterwards(self):
        self._delete()
        # Same credentials still attached; the user row behind them is gone.
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 401)

    def test_access_token_cannot_act_on_games_afterwards(self):
        game = Game.objects.create(
            player1_user=self.user, player1_name="alice", player2_name="bob",
            board_state={}, dice_values=[], status="active", current_turn="p1",
        )
        self._delete()
        resp = self.client.post(f"/api/games/{game.id}/roll_dice/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_refresh_token_is_blacklisted(self):
        self._delete()
        resp = self.client.post(
            "/api/auth/refresh/", {"refresh": self.tokens["refresh"]}, format="json"
        )
        self.assertEqual(resp.status_code, 401)

    def test_blacklist_row_survives_the_user_deletion(self):
        """
        OutstandingToken.user is SET_NULL, so the blacklist entry written before
        the delete is orphaned rather than cascaded away. If that FK were ever
        changed to CASCADE the rows would vanish and refresh would start
        succeeding again — this test is the tripwire for that.
        """
        self._delete()
        self.assertEqual(BlacklistedToken.objects.count(), 1)
        outstanding = OutstandingToken.objects.get()
        self.assertIsNone(outstanding.user_id)

    def test_every_outstanding_token_is_blacklisted_not_just_the_latest(self):
        """A user logged in on several devices must be signed out everywhere."""
        second = login(APIClient())  # a second session for the same account
        self._delete()

        for refresh in (self.tokens["refresh"], second["refresh"]):
            resp = self.client.post("/api/auth/refresh/", {"refresh": refresh}, format="json")
            self.assertEqual(resp.status_code, 401)

    def test_wrong_password_does_not_blacklist_anything(self):
        self.client.delete("/api/auth/me/", {"password": "wrong"}, format="json")
        self.assertEqual(BlacklistedToken.objects.count(), 0)
        resp = self.client.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)


class AccountDeleteGameRecordsTest(TestCase):
    """
    What deletion does to game records.

    Policy: **anonymise, don't destroy.** Both user FKs on Game and Match are
    `on_delete=SET_NULL` and the seat's display name is a separate CharField,
    so deleting the user nulls the FK and leaves name/board/winner/scores
    intact. An opponent must never lose their history because the other player
    quit.
    """

    def setUp(self):
        self.client = APIClient()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.tokens = login(self.client, "alice")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.tokens['access']}")

    def _delete_alice(self):
        resp = self.client.delete("/api/auth/me/", {"password": PASSWORD}, format="json")
        self.assertEqual(resp.status_code, 204)

    def test_finished_game_survives_with_the_seat_anonymised(self):
        game = Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[],
            status="finished", winner="p2", win_type="gammon", points_value=2,
        )
        self._delete_alice()

        game.refresh_from_db()
        self.assertIsNone(game.player1_user_id)      # FK anonymised
        self.assertEqual(game.player1_name, "alice")  # display name preserved
        self.assertEqual(game.player2_user_id, self.bob.id)
        self.assertEqual(game.winner, "p2")
        self.assertEqual(game.points_value, 2)

    def test_opponent_stats_are_unaffected(self):
        Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[],
            status="finished", winner="p2", win_type="gammon", points_value=2,
        )
        self._delete_alice()

        bob_client = APIClient()
        bob_tokens = login(bob_client, "bob")
        bob_client.credentials(HTTP_AUTHORIZATION=f"Bearer {bob_tokens['access']}")
        data = bob_client.get("/api/auth/me/").json()

        self.assertEqual(data["total_games"], 1)
        self.assertEqual(data["wins"], 1)
        self.assertEqual(data["total_gammons"], 1)
        self.assertEqual(data["total_points_won"], 2)

    def test_game_serializer_still_renders_an_anonymised_seat(self):
        """A null seat FK must not break GameSerializer.get_viewer_seat."""
        game = Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="active", current_turn="p1",
        )
        self._delete_alice()

        bob_client = APIClient()
        bob_tokens = login(bob_client, "bob")
        bob_client.credentials(HTTP_AUTHORIZATION=f"Bearer {bob_tokens['access']}")
        resp = bob_client.get(f"/api/games/{game.id}/")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNone(data["player1_user"])
        self.assertEqual(data["player1_name"], "alice")
        self.assertEqual(data["viewer_seat"], "p2")
        self.assertTrue(data["viewer_is_participant"])

        # Anonymous readers are fine too (the lobby list is unauthenticated).
        self.assertEqual(APIClient().get(f"/api/games/{game.id}/").status_code, 200)

    def test_in_progress_game_is_not_destroyed(self):
        game = Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="active", current_turn="p1",
        )
        self._delete_alice()
        self.assertTrue(Game.objects.filter(id=game.id).exists())

    def test_match_history_survives_with_the_seat_anonymised(self):
        match = Match.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            target_points=5, player1_score=2, player2_score=5,
            status="finished", winner="p2",
        )
        game = Game.objects.create(
            match=match,
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="finished", winner="p2",
        )
        self._delete_alice()

        match.refresh_from_db()
        game.refresh_from_db()
        self.assertIsNone(match.player1_user_id)
        self.assertEqual(match.player1_name, "alice")
        self.assertEqual(match.player2_score, 5)
        self.assertEqual(match.winner, "p2")
        self.assertEqual(game.match_id, match.id)

    def test_unjoined_lobby_game_is_removed(self):
        """
        A waiting game has no opponent, so nothing is lost by dropping it — and
        keeping it would leave a deleted account's name in the public lobby on a
        seat that can never be played.
        """
        waiting = Game.objects.create(
            player1_user=self.alice, player1_name="alice", player2_name="",
            board_state={}, dice_values=[], status="waiting",
        )
        self._delete_alice()

        self.assertFalse(Game.objects.filter(id=waiting.id).exists())
        self.assertEqual(APIClient().get("/api/games/?status=waiting").json(), [])

    def test_unjoined_match_is_removed_but_a_joined_one_is_kept(self):
        unjoined = Match.objects.create(
            player1_user=self.alice, player1_name="alice", player2_name="",
        )
        joined = Match.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
        )
        self._delete_alice()

        self.assertFalse(Match.objects.filter(id=unjoined.id).exists())
        self.assertTrue(Match.objects.filter(id=joined.id).exists())

    def test_another_players_lobby_entry_is_untouched(self):
        bobs_game = Game.objects.create(
            player1_user=self.bob, player1_name="bob", player2_name="",
            board_state={}, dice_values=[], status="waiting",
        )
        self._delete_alice()
        self.assertTrue(Game.objects.filter(id=bobs_game.id).exists())

    def test_guest_seated_games_are_untouched(self):
        """Games with no registered players at all must be left alone."""
        guest_game = Game.objects.create(
            player1_name="Guest 1", player2_name="Guest 2",
            board_state={}, dice_values=[], status="active",
        )
        self._delete_alice()
        self.assertTrue(Game.objects.filter(id=guest_game.id).exists())


class DeletedSeatIsClosedTest(TestCase):
    """
    An anonymised seat must not decay into a *guest* seat.

    Both user FKs are ``on_delete=SET_NULL``, so after a deletion the seat's
    FK is null — exactly what a guest seat looks like, and guest seats are
    deliberately playable by anonymous callers. Without a marker, deleting your
    account would hand every live game you were in to anyone holding its id.
    ``player*_deleted`` is that marker; these tests pin both halves: the closed
    seat is shut to everyone, and genuine guest play is unchanged.
    """

    def setUp(self):
        self.client = APIClient()
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.mallory = make_user("mallory")

    def _delete_alice(self):
        client = APIClient()
        tokens = login(client, "alice")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        resp = client.delete("/api/auth/me/", {"password": PASSWORD}, format="json")
        self.assertEqual(resp.status_code, 204)

    def _live_game(self, current_turn="p1", **kwargs):
        fields = dict(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state=get_initial_board_state(), dice_values=[],
            status="active", current_turn=current_turn,
        )
        fields.update(kwargs)
        return Game.objects.create(**fields)

    # -- the flags get set ---------------------------------------------------

    def test_deletion_flags_both_the_game_and_match_seats(self):
        match = Match.objects.create(
            player1_user=self.bob, player1_name="bob",
            player2_user=self.alice, player2_name="alice",
        )
        game = Game.objects.create(
            match=match,
            player1_user=self.bob, player1_name="bob",
            player2_user=self.alice, player2_name="alice",
            board_state={}, dice_values=[], status="active",
        )
        self._delete_alice()

        game.refresh_from_db()
        match.refresh_from_db()
        self.assertTrue(game.player2_deleted)
        self.assertFalse(game.player1_deleted)   # bob's seat is untouched
        self.assertTrue(match.player2_deleted)
        self.assertFalse(match.player1_deleted)

    def test_finished_games_are_flagged_too(self):
        """Harmless, and it keeps the flag a truthful statement about the seat."""
        game = Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="finished", winner="p2",
        )
        self._delete_alice()
        game.refresh_from_db()
        self.assertTrue(game.player1_deleted)

    # -- the hole itself -----------------------------------------------------

    def test_anonymous_cannot_roll_on_a_deleted_seat(self):
        game = self._live_game(current_turn="p1")
        self._delete_alice()

        resp = APIClient().post(f"/api/games/{game.id}/roll_dice/")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("deleted their account", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.dice_values, [])

    def test_anonymous_cannot_confirm_a_turn_on_a_deleted_seat(self):
        game = self._live_game(current_turn="p1", dice_values=[1, 2])
        self._delete_alice()

        resp = APIClient().post(
            f"/api/games/{game.id}/confirm_turn/",
            {"moves": [{"from_point": 1, "to_point": 2},
                       {"from_point": 2, "to_point": 4}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")
        self.assertEqual(game.board_state, get_initial_board_state())

    def test_anonymous_cannot_double_on_a_deleted_seat(self):
        game = self._live_game(current_turn="p1", dice_values=[])
        self._delete_alice()
        anon = APIClient()

        double = anon.post(f"/api/games/{game.id}/offer_double/")
        self.assertEqual(double.status_code, 403)

    def test_anonymous_cannot_answer_a_double_as_the_deleted_seat(self):
        """respond_to_double checks an explicit seat, not current_turn."""
        game = self._live_game(current_turn="p2")
        game.double_offered_by = "p2"   # bob doubled; alice's seat must answer
        game.save()
        self._delete_alice()

        resp = APIClient().post(
            f"/api/games/{game.id}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(resp.status_code, 403)
        game.refresh_from_db()
        self.assertEqual(game.cube_value, 1)

    def test_another_logged_in_account_cannot_take_a_deleted_seat(self):
        game = self._live_game(current_turn="p1")
        self._delete_alice()

        client = APIClient()
        client.force_authenticate(user=self.mallory)
        self.assertEqual(client.post(f"/api/games/{game.id}/roll_dice/").status_code, 403)

    def test_the_opponent_cannot_play_the_deleted_seat_either(self):
        """
        The survivor satisfies `is_participant` on the orphaned seat, so
        without the closed check they could play both sides of the board.
        """
        game = self._live_game(current_turn="p1")
        self._delete_alice()

        client = APIClient()
        client.force_authenticate(user=self.bob)
        resp = client.post(f"/api/games/{game.id}/roll_dice/")
        self.assertEqual(resp.status_code, 403)

    # -- the opponent keeps their own seat -----------------------------------

    def test_the_opponent_can_still_act_on_their_own_turn(self):
        game = self._live_game(current_turn="p2")
        self._delete_alice()

        client = APIClient()
        client.force_authenticate(user=self.bob)
        resp = client.post(f"/api/games/{game.id}/roll_dice/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(len(resp.json()["dice_values"]), [2, 4])

    def test_the_opponent_can_still_read_the_game(self):
        game = self._live_game()
        self._delete_alice()

        client = APIClient()
        client.force_authenticate(user=self.bob)
        data = client.get(f"/api/games/{game.id}/").json()
        self.assertEqual(data["viewer_seat"], "p2")
        self.assertTrue(data["player1_deleted"])
        self.assertFalse(data["player2_deleted"])

    # -- genuine guest play is untouched (the regression risk) ---------------

    def test_a_real_guest_seat_still_allows_anonymous_play(self):
        game = Game.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_name="a guest",            # null FK, never deleted
            board_state=get_initial_board_state(), dice_values=[],
            status="active", current_turn="p2",
        )
        self._delete_alice()

        resp = APIClient().post(f"/api/games/{game.id}/roll_dice/")
        self.assertEqual(resp.status_code, 200)

    def test_a_fully_guest_game_is_unaffected_by_someone_elses_deletion(self):
        game = Game.objects.create(
            player1_name="Guest 1", player2_name="Guest 2",
            board_state=get_initial_board_state(), dice_values=[],
            status="active", current_turn="p1",
        )
        self._delete_alice()

        resp = APIClient().post(f"/api/games/{game.id}/roll_dice/")
        self.assertEqual(resp.status_code, 200)

    # -- match-level actions -------------------------------------------------

    def test_anonymous_cannot_advance_a_match_through_a_deleted_seat(self):
        match = Match.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob", target_points=5,
        )
        Game.objects.create(
            match=match, player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="finished", winner="p2",
        )
        self._delete_alice()

        resp = APIClient().post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(resp.status_code, 403)

    def test_a_guest_opponent_can_still_advance_the_match(self):
        """One seat closed, the other a genuine guest → the guest plays on."""
        match = Match.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_name="a guest", target_points=5,
        )
        Game.objects.create(
            match=match, player1_user=self.alice, player1_name="alice",
            player2_name="a guest",
            board_state={}, dice_values=[], status="finished", winner="p2",
        )
        self._delete_alice()

        resp = APIClient().post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(resp.status_code, 201)

    def test_next_game_carries_the_closure_into_the_new_game(self):
        match = Match.objects.create(
            player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob", target_points=5,
        )
        Game.objects.create(
            match=match, player1_user=self.alice, player1_name="alice",
            player2_user=self.bob, player2_name="bob",
            board_state={}, dice_values=[], status="finished", winner="p2",
        )
        self._delete_alice()

        client = APIClient()
        client.force_authenticate(user=self.bob)   # the survivor advances
        resp = client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()["player1_deleted"])

        # ...and the fresh game's orphaned seat is closed, not guest-open.
        new_game_id = resp.json()["id"]
        anon = APIClient().post(f"/api/games/{new_game_id}/roll_dice/")
        self.assertEqual(anon.status_code, 403)


class SeatClosedFieldDefaultsTest(TestCase):
    """
    The flags default to False, so the migration leaves every existing row —
    and every ordinary new game — exactly as it was.
    """

    def test_new_rows_default_to_open_seats(self):
        game = Game.objects.create(
            player1_name="p1", player2_name="p2", board_state={}, dice_values=[]
        )
        match = Match.objects.create(player1_name="p1", player2_name="p2")
        self.assertFalse(game.player1_deleted)
        self.assertFalse(game.player2_deleted)
        self.assertFalse(match.player1_deleted)
        self.assertFalse(match.player2_deleted)

    def test_a_row_written_without_the_fields_stays_anonymous_playable(self):
        """
        The pre-migration shape: a guest game created with no mention of the
        new columns behaves exactly as it did before they existed.
        """
        game = Game.objects.create(
            player1_name="Guest 1", player2_name="Guest 2",
            board_state=get_initial_board_state(), dice_values=[],
            status="active", current_turn="p1",
        )
        self.assertEqual(
            APIClient().post(f"/api/games/{game.id}/roll_dice/").status_code, 200
        )

    def test_the_flags_are_read_only_on_create(self):
        """A caller must not be able to close a seat by asking nicely."""
        resp = APIClient().post(
            "/api/games/",
            {"player1_name": "a", "player2_name": "b", "player1_deleted": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertFalse(resp.json()["player1_deleted"])
        self.assertFalse(Game.objects.get(id=resp.json()["id"]).player1_deleted)
