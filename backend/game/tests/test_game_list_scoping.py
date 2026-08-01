"""
Scoping of ``GET /api/games/`` (see _list_scope_q in views.py).

Policy under test — a row is listed when *any* of these holds:
  1. status == "waiting" (the public lobby, visible to everyone),
  2. either seat's user FK is the requester (authenticated callers only),
  3. the game is fully-guest: both seat FKs null AND neither seat closed
     by account deletion (player1_deleted / player2_deleted both False).

``retrieve`` by id is deliberately *not* scoped — link sharing depends on it.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Game
from game.game_logic import get_initial_board_state


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


class ListScopingBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(username="alice", password="password123")
        self.bob = User.objects.create_user(username="bob", password="password123")

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def as_anonymous(self):
        self.client.force_authenticate(user=None)

    def list_ids(self, query=""):
        res = self.client.get(f"/api/games/{query}")
        self.assertEqual(res.status_code, 200)
        return [row["id"] for row in res.json()]


class AnonymousListScopeTest(ListScopingBase):
    """Clause 1 and clause 3, and what falls outside them."""

    def test_anonymous_sees_waiting_game(self):
        game = make_game(
            player1_user=self.alice, player1_name="alice",
            player2_name="", status="waiting",
        )
        self.as_anonymous()
        self.assertIn(game.pk, self.list_ids())

    def test_anonymous_sees_fully_guest_game(self):
        game = make_game()  # both seat FKs null, neither seat closed
        self.as_anonymous()
        self.assertIn(game.pk, self.list_ids())

    def test_anonymous_does_not_see_registered_active_game(self):
        game = make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        self.assertNotIn(game.pk, self.list_ids())

    def test_anonymous_does_not_see_mixed_guest_registered_active_game(self):
        # One guest seat, one registered seat: fails clause 3 (a seat FK is
        # set) and clause 2 (anonymous has no identity).
        game = make_game(player1_user=self.alice, player1_name="alice")
        self.as_anonymous()
        self.assertNotIn(game.pk, self.list_ids())

    def test_anonymous_does_not_see_game_with_seat_closed_by_deletion(self):
        # Null FK but player1_deleted=True: an orphaned seat, not a guest seat.
        # It must fail clause 3 even though both FKs are null.
        game = make_game(player1_deleted=True)
        self.as_anonymous()
        self.assertNotIn(game.pk, self.list_ids())

    def test_anonymous_does_not_see_game_with_player2_closed_by_deletion(self):
        game = make_game(player2_deleted=True)
        self.as_anonymous()
        self.assertNotIn(game.pk, self.list_ids())

    def test_waiting_game_with_a_closed_seat_is_not_advertised(self):
        # Deletion purges unjoined lobby adverts, so this row should not exist
        # in the first place. Clause 1 checks the closure flags anyway: a seat
        # nobody may act on is unjoinable, and the lobby must never advertise
        # one even if a row survives the purge.
        game = make_game(player2_name="", status="waiting", player1_deleted=True)
        self.as_anonymous()
        self.assertNotIn(game.pk, self.list_ids())


class AuthenticatedListScopeTest(ListScopingBase):
    """Clause 2: your own games, whichever seat you hold."""

    def test_user_sees_own_active_game_as_player1(self):
        game = make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_user(self.alice)
        self.assertIn(game.pk, self.list_ids())

    def test_user_sees_own_active_game_as_player2(self):
        game = make_game(
            player1_user=self.bob, player2_user=self.alice,
            player1_name="bob", player2_name="alice",
        )
        self.as_user(self.alice)
        self.assertIn(game.pk, self.list_ids())

    def test_user_does_not_see_another_users_active_game(self):
        game = make_game(
            player1_user=self.bob, player2_name="Carol",
            player1_name="bob",
        )
        self.as_user(self.alice)
        self.assertNotIn(game.pk, self.list_ids())

    def test_user_sees_own_finished_game(self):
        # Clause 2 is status-independent: full history comes back.
        game = make_game(
            player1_user=self.alice, player1_name="alice",
            status="finished", winner="p1",
        )
        self.as_user(self.alice)
        self.assertIn(game.pk, self.list_ids())

    def test_user_still_sees_lobby_and_guest_games(self):
        waiting = make_game(player2_name="", status="waiting")
        guest = make_game()
        mine = make_game(player1_user=self.alice, player1_name="alice")
        theirs = make_game(player1_user=self.bob, player1_name="bob")
        self.as_user(self.alice)
        ids = self.list_ids()
        self.assertIn(waiting.pk, ids)
        self.assertIn(guest.pk, ids)
        self.assertIn(mine.pk, ids)
        self.assertNotIn(theirs.pk, ids)


class ListScopeStatusFilterTest(ListScopingBase):
    """``?status=`` narrows the scope; it must not widen it."""

    def test_status_filter_applies_within_scope_for_authenticated_user(self):
        mine = make_game(player1_user=self.alice, player1_name="alice")
        theirs = make_game(player1_user=self.bob, player1_name="bob")
        self.as_user(self.alice)
        ids = self.list_ids("?status=active")
        self.assertIn(mine.pk, ids)
        self.assertNotIn(theirs.pk, ids)

    def test_status_filter_does_not_expose_registered_games_to_anonymous(self):
        guest = make_game()
        theirs = make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        ids = self.list_ids("?status=active")
        self.assertIn(guest.pk, ids)
        self.assertNotIn(theirs.pk, ids)

    def test_status_waiting_filter_still_returns_the_lobby(self):
        waiting = make_game(
            player1_user=self.alice, player1_name="alice",
            player2_name="", status="waiting",
        )
        active_guest = make_game()
        self.as_anonymous()
        ids = self.list_ids("?status=waiting")
        self.assertIn(waiting.pk, ids)
        self.assertNotIn(active_guest.pk, ids)

    def test_own_game_excluded_when_status_filter_does_not_match(self):
        mine = make_game(
            player1_user=self.alice, player1_name="alice",
            status="finished", winner="p1",
        )
        self.as_user(self.alice)
        self.assertNotIn(mine.pk, self.list_ids("?status=active"))


class RetrieveStaysOpenTest(ListScopingBase):
    """Scoping is list-only — fetching by id is how shared links work."""

    def test_anonymous_can_retrieve_registered_active_game_by_id(self):
        game = make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        res = self.client.get(f"/api/games/{game.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], game.pk)
        # ...and it is genuinely absent from that same caller's list.
        self.assertNotIn(game.pk, self.list_ids())

    def test_other_user_can_retrieve_a_game_they_cannot_list(self):
        game = make_game(player1_user=self.bob, player1_name="bob")
        self.as_user(self.alice)
        res = self.client.get(f"/api/games/{game.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(game.pk, self.list_ids())

    def test_anonymous_can_retrieve_game_with_a_closed_seat(self):
        game = make_game(player1_deleted=True)
        self.as_anonymous()
        res = self.client.get(f"/api/games/{game.pk}/")
        self.assertEqual(res.status_code, 200)


class ListResponseShapeTest(ListScopingBase):
    """Both clients ``.map()`` over this body — it must stay a bare array."""

    def test_list_body_is_a_bare_array_not_a_pagination_envelope(self):
        make_game()
        make_game(player2_name="", status="waiting")
        self.as_anonymous()
        body = self.client.get("/api/games/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 2)

    def test_empty_scope_returns_an_empty_array(self):
        make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        body = self.client.get("/api/games/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(body, [])

    def test_authenticated_list_body_is_also_a_bare_array(self):
        make_game(player1_user=self.alice, player1_name="alice")
        self.as_user(self.alice)
        body = self.client.get("/api/games/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 1)
