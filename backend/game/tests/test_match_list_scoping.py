"""
Scoping of ``GET /api/matches/`` (see _match_list_scope_q in views.py).

Policy under test — a row is listed when *any* of these holds:
  1. the match is fully-guest: both seat FKs null AND neither seat closed by
     account deletion (player1_deleted / player2_deleted both False),
  2. either seat's user FK is the requester (authenticated callers only).

There is deliberately **no lobby clause**, unlike ``GET /api/games/``: a Match
has no ``waiting`` status to advertise (only active/finished), and open matches
reach the lobby through their first game instead.

``retrieve`` by id is deliberately *not* scoped — link sharing depends on it.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.models import Match


def make_match(**kwargs):
    defaults = dict(
        player1_name="Alice",
        player2_name="Bob",
        target_points=5,
        status="active",
    )
    defaults.update(kwargs)
    return Match.objects.create(**defaults)


class MatchListScopingBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(username="alice", password="password123")
        self.bob = User.objects.create_user(username="bob", password="password123")

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def as_anonymous(self):
        self.client.force_authenticate(user=None)

    def list_ids(self):
        res = self.client.get("/api/matches/")
        self.assertEqual(res.status_code, 200)
        return [row["id"] for row in res.json()]


class AnonymousMatchListScopeTest(MatchListScopingBase):
    """Clause 1, and what falls outside it."""

    def test_anonymous_sees_fully_guest_match(self):
        match = make_match()  # both seat FKs null, neither seat closed
        self.as_anonymous()
        self.assertIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_registered_match(self):
        match = make_match(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_mixed_guest_registered_match(self):
        # One guest seat, one registered seat: fails clause 1 (a seat FK is
        # set) and clause 2 (anonymous has no identity).
        match = make_match(player1_user=self.alice, player1_name="alice")
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_match_with_seat_closed_by_deletion(self):
        # Null FK but player1_deleted=True: an orphaned seat, not a guest seat.
        # It must fail clause 1 even though both FKs are null.
        match = make_match(player1_deleted=True)
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_match_with_player2_closed_by_deletion(self):
        match = make_match(player2_deleted=True)
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_open_match_awaiting_an_opponent(self):
        # The nearest thing to a lobby row: a registered player1 with no
        # player2 yet. There is no lobby clause for matches, so it stays
        # hidden; the joiner finds it via the waiting *game* and its match id.
        match = make_match(
            player1_user=self.alice, player1_name="alice", player2_name="",
        )
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_does_not_see_finished_registered_match(self):
        match = make_match(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
            status="finished", winner="p1", player1_score=5,
        )
        self.as_anonymous()
        self.assertNotIn(match.pk, self.list_ids())


class AuthenticatedMatchListScopeTest(MatchListScopingBase):
    """Clause 2: your own matches, whichever seat you hold."""

    def test_user_sees_own_match_as_player1(self):
        match = make_match(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_user(self.alice)
        self.assertIn(match.pk, self.list_ids())

    def test_user_sees_own_match_as_player2(self):
        match = make_match(
            player1_user=self.bob, player2_user=self.alice,
            player1_name="bob", player2_name="alice",
        )
        self.as_user(self.alice)
        self.assertIn(match.pk, self.list_ids())

    def test_user_does_not_see_another_users_match(self):
        match = make_match(
            player1_user=self.bob, player1_name="bob", player2_name="Carol",
        )
        self.as_user(self.alice)
        self.assertNotIn(match.pk, self.list_ids())

    def test_user_sees_own_finished_match(self):
        # Clause 2 is status-independent: full match history comes back.
        match = make_match(
            player1_user=self.alice, player1_name="alice",
            status="finished", winner="p1", player1_score=5,
        )
        self.as_user(self.alice)
        self.assertIn(match.pk, self.list_ids())

    def test_user_sees_own_match_with_opponent_seat_closed(self):
        # The surviving registered player still qualifies on their own seat.
        match = make_match(
            player1_user=self.alice, player1_name="alice",
            player2_name="bob", player2_deleted=True,
        )
        self.as_user(self.alice)
        self.assertIn(match.pk, self.list_ids())

    def test_user_still_sees_guest_matches_but_not_other_peoples(self):
        guest = make_match()
        mine = make_match(player1_user=self.alice, player1_name="alice")
        theirs = make_match(player1_user=self.bob, player1_name="bob")
        closed = make_match(player1_deleted=True)
        self.as_user(self.alice)
        ids = self.list_ids()
        self.assertIn(guest.pk, ids)
        self.assertIn(mine.pk, ids)
        self.assertNotIn(theirs.pk, ids)
        self.assertNotIn(closed.pk, ids)


class MatchRetrieveStaysOpenTest(MatchListScopingBase):
    """Scoping is list-only — fetching by id is how shared links work."""

    def test_anonymous_can_retrieve_registered_match_by_id(self):
        match = make_match(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        res = self.client.get(f"/api/matches/{match.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], match.pk)
        # ...and it is genuinely absent from that same caller's list.
        self.assertNotIn(match.pk, self.list_ids())

    def test_other_user_can_retrieve_a_match_they_cannot_list(self):
        match = make_match(player1_user=self.bob, player1_name="bob")
        self.as_user(self.alice)
        res = self.client.get(f"/api/matches/{match.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(match.pk, self.list_ids())

    def test_anonymous_can_retrieve_match_with_a_closed_seat(self):
        match = make_match(player1_deleted=True)
        self.as_anonymous()
        res = self.client.get(f"/api/matches/{match.pk}/")
        self.assertEqual(res.status_code, 200)


class MatchListResponseShapeTest(MatchListScopingBase):
    """Both clients ``.map()`` over list bodies — they must stay bare arrays."""

    def test_list_body_is_a_bare_array_not_a_pagination_envelope(self):
        make_match()
        make_match()
        self.as_anonymous()
        body = self.client.get("/api/matches/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 2)

    def test_empty_scope_returns_an_empty_array(self):
        make_match(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
        )
        self.as_anonymous()
        body = self.client.get("/api/matches/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(body, [])

    def test_authenticated_list_body_is_also_a_bare_array(self):
        make_match(player1_user=self.alice, player1_name="alice")
        self.as_user(self.alice)
        body = self.client.get("/api/matches/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 1)
