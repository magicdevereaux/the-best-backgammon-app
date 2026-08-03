"""
Tests for the inactivity-forfeit clock and POST /api/games/{id}/claim_timeout/.

Two halves, and the first is the load-bearing one. ``turn_started_at`` is only
meaningful if it is written *everywhere* the seat being waited on changes and
*nowhere* else — a missed transition strands a player on a deadline they never
saw start, and a spurious reset (notably on ``roll_dice``) hands a staller an
endlessly renewable clock. TurnClockTest pins every transition individually.

The second half is the claim itself: what it refuses (guests, closed seats, a
deadline that has not passed, a replay), who may make it, and that a timeout win
is an ordinary scoring win — 1 × cube into the match, and a win/loss pair in the
two players' stats with no change to the stats code at all.

There is no freezegun in requirements.txt, so time is manipulated by writing
``turn_started_at`` into the past directly. That is exactly what the endpoint
reads, so it exercises the real comparison.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_timeout
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from game.game_logic import get_initial_board_state
from game.models import Game, Match
from game.serializers import GameSerializer


PASSWORD = "securepass123"


def make_user(username, password=PASSWORD):
    return User.objects.create_user(username=username, password=password)


def login(client, username, password=PASSWORD):
    resp = client.post(
        "/api/auth/login/", {"username": username, "password": password}, format="json"
    )
    return resp.json()["access"]


def auth(username):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(client, username)}")
    return client


def make_match(p1_user=None, p2_user=None, **kwargs):
    return Match.objects.create(
        player1_user=p1_user,
        player2_user=p2_user,
        player1_name=p1_user.username if p1_user else "Guest 1",
        player2_name=p2_user.username if p2_user else "Guest 2",
        target_points=kwargs.pop("target_points", 5),
        **kwargs,
    )


def make_game(match=None, p1_user=None, p2_user=None, **kwargs):
    """An active game with a clock that started just now, p1 to move."""
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
        "turn_started_at": timezone.now(),
    }
    fields.update(kwargs)
    return Game.objects.create(**fields)


# A deterministic 3-4 roll and the two moves that use it from the opening
# position: p1's back checkers sit on point 1, and points 4 and 5 are empty.
# Fixed rather than rolled, so no test depends on avoiding doubles (which
# yield four dice and would fail the maximal-usage check with two moves).
OPENING_DICE = [3, 4]
OPENING_MOVES = [
    {"from_point": 1, "to_point": 4},
    {"from_point": 1, "to_point": 5},
]


def expire(game, hours=49):
    """Backdate the clock so the deadline (48h by default) has passed."""
    Game.objects.filter(pk=game.pk).update(
        turn_started_at=timezone.now() - timedelta(hours=hours)
    )
    game.refresh_from_db()


def close_seat(game, seat):
    """What account deletion leaves behind: null FK + closure flag."""
    setattr(game, f"{seat}_user", None)
    setattr(game, f"{seat}_deleted", True)
    game.save()


# ---------------------------------------------------------------------------
# The clock itself
# ---------------------------------------------------------------------------

class TurnClockTest(TestCase):
    """
    Every transition that changes the seat being waited on must restart the
    clock — and rolling the dice must not.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def test_a_waiting_lobby_game_has_no_clock(self):
        """
        Nobody is idle until there is an opponent. A clock started at creation
        would tick down while the advert sat unjoined.
        """
        resp = APIClient().post("/api/games/", {"player1_name": "Guest 1"}, format="json")
        self.assertEqual(resp.status_code, 201)
        game = Game.objects.get(pk=resp.json()["id"])
        self.assertEqual(game.status, "waiting")
        self.assertIsNone(game.turn_started_at)

    def test_joining_a_game_starts_the_clock(self):
        creator = auth("alice")
        game_id = creator.post("/api/games/", {}, format="json").json()["id"]
        self.assertIsNone(Game.objects.get(pk=game_id).turn_started_at)

        before = timezone.now()
        self.assertEqual(
            auth("bob").post(f"/api/games/{game_id}/join/", {}, format="json").status_code,
            200,
        )

        game = Game.objects.get(pk=game_id)
        self.assertEqual(game.status, "active")
        self.assertIsNotNone(game.turn_started_at)
        self.assertGreaterEqual(game.turn_started_at, before)

    def test_joining_a_match_starts_its_waiting_games_clock(self):
        creator = auth("alice")
        match_id = creator.post("/api/matches/", {}, format="json").json()["id"]
        game = Game.objects.get(match_id=match_id)
        self.assertIsNone(game.turn_started_at)

        before = timezone.now()
        self.assertEqual(
            auth("bob").post(f"/api/matches/{match_id}/join/", {}, format="json").status_code,
            200,
        )

        game.refresh_from_db()
        self.assertEqual(game.status, "active")
        self.assertGreaterEqual(game.turn_started_at, before)

    def test_a_hotseat_game_starts_active_with_a_clock(self):
        before = timezone.now()
        resp = APIClient().post(
            "/api/games/",
            {"player1_name": "Guest 1", "player2_name": "Guest 2"},
            format="json",
        )
        game = Game.objects.get(pk=resp.json()["id"])
        self.assertEqual(game.status, "active")
        self.assertGreaterEqual(game.turn_started_at, before)

    def test_rolling_the_dice_does_not_restart_the_clock(self):
        """
        The deliberate omission. One deadline covers roll *and* move: if rolling
        bought a fresh clock, a player could roll inside the window and stall on
        the board forever without ever becoming claimable.
        """
        game = make_game(None, self.alice, self.bob, current_turn="p1")
        expire(game, hours=10)
        started = game.turn_started_at

        resp = auth("alice").post(f"/api/games/{game.id}/roll_dice/", {}, format="json")
        self.assertEqual(resp.status_code, 200)

        game.refresh_from_db()
        self.assertEqual(game.turn_started_at, started)

    def test_confirming_a_turn_restarts_the_clock_for_the_opponent(self):
        game = make_game(
            None, self.alice, self.bob, current_turn="p1", dice_values=OPENING_DICE
        )
        expire(game, hours=10)
        started = game.turn_started_at

        resp = auth("alice").post(
            f"/api/games/{game.id}/confirm_turn/", {"moves": OPENING_MOVES}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())

        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")
        self.assertGreater(game.turn_started_at, started)

    def test_offering_a_double_restarts_the_clock_for_the_responder(self):
        """
        `current_turn` does not move, but the seat being *waited on* does — the
        responder now owes an answer, so the clock is theirs.
        """
        game = make_game(None, self.alice, self.bob, current_turn="p1")
        expire(game, hours=10)
        started = game.turn_started_at

        resp = auth("alice").post(f"/api/games/{game.id}/offer_double/", {}, format="json")
        self.assertEqual(resp.status_code, 200)

        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")
        self.assertEqual(game.waiting_seat, "p2")
        self.assertGreater(game.turn_started_at, started)

    def test_taking_a_double_restarts_the_clock_for_the_offerer(self):
        game = make_game(
            None, self.alice, self.bob, current_turn="p1", double_offered_by="p1"
        )
        expire(game, hours=10)
        started = game.turn_started_at

        resp = auth("bob").post(
            f"/api/games/{game.id}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(resp.status_code, 200)

        game.refresh_from_db()
        self.assertEqual(game.waiting_seat, "p1")
        self.assertGreater(game.turn_started_at, started)

    def test_next_game_starts_a_fresh_clock(self):
        match = make_match(self.alice, self.bob)
        finished = make_game(
            match,
            self.alice,
            self.bob,
            status="finished",
            winner="p2",
            win_type="single",
            points_value=1,
        )
        Game.objects.filter(pk=finished.pk).update(
            turn_started_at=timezone.now() - timedelta(hours=10)
        )

        before = timezone.now()
        resp = auth("bob").post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.assertEqual(resp.status_code, 201)

        new_game = Game.objects.get(pk=resp.json()["id"])
        self.assertEqual(new_game.current_turn, "p2")
        self.assertGreaterEqual(new_game.turn_started_at, before)


# ---------------------------------------------------------------------------
# Serializer surface
# ---------------------------------------------------------------------------

class TurnDeadlineSerializerTest(TestCase):
    """
    The clients never re-derive the eligibility rule: a null `turn_deadline` is
    the whole "no claim is possible here" signal.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def payload(self, game):
        return GameSerializer(game).data

    def test_active_registered_game_exposes_seat_and_deadline(self):
        game = make_game(None, self.alice, self.bob, current_turn="p1")
        data = self.payload(game)

        self.assertEqual(data["turn_waiting_seat"], "p1")
        self.assertIsNotNone(data["turn_deadline"])
        # Same spelling DRF gives created_at/updated_at, so clients parse one
        # format everywhere: "...Z", not Python's "+00:00".
        self.assertTrue(data["turn_deadline"].endswith("Z"))
        expected = game.turn_started_at + timedelta(hours=48)
        self.assertEqual(
            data["turn_deadline"], expected.isoformat().replace("+00:00", "Z")
        )

    @override_settings(TURN_TIMEOUT_HOURS=6)
    def test_deadline_follows_the_setting(self):
        game = make_game(None, self.alice, self.bob)
        self.assertEqual(
            game.timeout_deadline(), game.turn_started_at + timedelta(hours=6)
        )

    def test_pending_double_puts_the_responder_on_the_clock(self):
        game = make_game(
            None, self.alice, self.bob, current_turn="p1", double_offered_by="p1"
        )
        self.assertEqual(self.payload(game)["turn_waiting_seat"], "p2")

    def test_null_deadline_for_a_guest_seat(self):
        game = make_game(None, self.alice, None)
        data = self.payload(game)
        self.assertEqual(data["turn_waiting_seat"], "p1")
        self.assertIsNone(data["turn_deadline"])

    def test_null_deadline_for_a_closed_seat(self):
        game = make_game(None, self.alice, self.bob)
        close_seat(game, "player1")
        self.assertIsNone(self.payload(game)["turn_deadline"])

    def test_null_deadline_and_seat_for_a_waiting_game(self):
        game = make_game(None, self.alice, None, status="waiting", turn_started_at=None)
        data = self.payload(game)
        self.assertIsNone(data["turn_waiting_seat"])
        self.assertIsNone(data["turn_deadline"])

    def test_null_deadline_and_seat_for_a_finished_game(self):
        game = make_game(
            None, self.alice, self.bob, status="finished", winner="p1",
            win_type="single", points_value=1,
        )
        data = self.payload(game)
        self.assertIsNone(data["turn_waiting_seat"])
        self.assertIsNone(data["turn_deadline"])

    def test_null_deadline_when_no_clock_is_running(self):
        game = make_game(None, self.alice, self.bob, turn_started_at=None)
        self.assertIsNone(self.payload(game)["turn_deadline"])

    def test_the_clock_is_read_only_over_the_api(self):
        """A writable deadline would let a client park itself past every claim."""
        resp = auth("alice").post(
            "/api/games/",
            {"player2_name": "Guest 2", "turn_started_at": "2099-01-01T00:00:00Z"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        game = Game.objects.get(pk=resp.json()["id"])
        self.assertLess(game.turn_started_at, timezone.now() + timedelta(minutes=1))


# ---------------------------------------------------------------------------
# The claim
# ---------------------------------------------------------------------------

class ClaimTimeoutHappyPathTest(TestCase):
    """A stalled turn becomes an ordinary scoring win for the opponent."""

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.match = make_match(self.alice, self.bob)
        self.game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        expire(self.game)

    def claim(self, username="bob"):
        return auth(username).post(
            f"/api/games/{self.game.id}/claim_timeout/", {}, format="json"
        )

    def test_opponent_claims_a_single_at_cube_one(self):
        resp = self.claim()
        self.assertEqual(resp.status_code, 200, resp.json())

        body = resp.json()
        self.assertEqual(body["status"], "finished")
        self.assertEqual(body["winner"], "p2")
        self.assertEqual(body["win_type"], "timeout")
        self.assertEqual(body["points_value"], 1)

        self.game.refresh_from_db()
        self.assertEqual(self.game.winner, "p2")
        self.assertEqual(self.game.win_type, "timeout")
        self.assertEqual(self.game.points_value, 1)

    def test_the_match_score_moves(self):
        self.claim()
        self.match.refresh_from_db()
        self.assertEqual((self.match.player1_score, self.match.player2_score), (0, 1))
        self.assertEqual(self.match.status, "active")

    def test_a_claim_after_a_take_is_worth_the_doubled_cube(self):
        """
        Cube 2, and the offerer is the one who walked away — so the acceptor
        claims 1 x 2. Runs the real cube flow rather than fixture-setting it.
        """
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        auth("alice").post(f"/api/games/{game.id}/offer_double/", {}, format="json")
        auth("bob").post(
            f"/api/games/{game.id}/respond_to_double/", {"accept": True}, format="json"
        )
        game.refresh_from_db()
        self.assertEqual(game.cube_value, 2)
        # After a take the offerer (p1) owes the roll; they never make it.
        self.assertEqual(game.waiting_seat, "p1")
        expire(game)

        resp = auth("bob").post(f"/api/games/{game.id}/claim_timeout/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        game.refresh_from_db()
        self.assertEqual(game.winner, "p2")
        self.assertEqual(game.points_value, 2)

    def test_a_claim_can_complete_a_match(self):
        self.match.player2_score = 4  # target is 5
        self.match.save()

        self.assertEqual(self.claim().status_code, 200)
        self.match.refresh_from_db()
        self.assertEqual(self.match.player2_score, 5)
        self.assertEqual(self.match.status, "finished")
        self.assertEqual(self.match.winner, "p2")

    def test_a_game_without_a_match_can_be_claimed(self):
        solo = make_game(None, self.alice, self.bob, current_turn="p1")
        expire(solo)
        resp = auth("bob").post(f"/api/games/{solo.id}/claim_timeout/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        solo.refresh_from_db()
        self.assertEqual(solo.win_type, "timeout")

    def test_a_stalled_roll_is_claimable_too(self):
        """
        The deadline covers roll-and-move as one turn, so a player who rolled
        and then walked away is just as claimable as one who never rolled.
        """
        self.game.dice_values = [3, 5]
        self.game.save()
        expire(self.game)

        self.assertEqual(self.claim().status_code, 200)
        self.game.refresh_from_db()
        self.assertEqual(self.game.win_type, "timeout")
        self.assertEqual(self.game.dice_values, [])

    @override_settings(TURN_TIMEOUT_HOURS=2)
    def test_a_shorter_configured_timeout_is_honoured(self):
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        expire(game, hours=3)
        resp = auth("bob").post(f"/api/games/{game.id}/claim_timeout/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())


class ClaimTimeoutPermissionTest(TestCase):
    """Only the seat opposite the idle one may claim."""

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = make_game(None, self.alice, self.bob, current_turn="p1")
        expire(self.game)

    def assertRefused(self, resp):
        self.assertEqual(resp.status_code, 403)
        self.game.refresh_from_db()
        self.assertEqual(self.game.status, "active")

    def test_the_idle_player_cannot_claim_against_themselves(self):
        self.assertRefused(
            auth("alice").post(
                f"/api/games/{self.game.id}/claim_timeout/", {}, format="json"
            )
        )

    def test_a_stranger_cannot_claim(self):
        make_user("mallory")
        self.assertRefused(
            auth("mallory").post(
                f"/api/games/{self.game.id}/claim_timeout/", {}, format="json"
            )
        )

    def test_an_anonymous_caller_cannot_claim(self):
        self.assertRefused(
            APIClient().post(
                f"/api/games/{self.game.id}/claim_timeout/", {}, format="json"
            )
        )

    def test_with_a_double_pending_the_responder_is_on_the_clock(self):
        """
        The responder owes the answer, so they are the one who can be timed out
        — and the *offerer* is the one entitled to claim, even though the
        offerer holds `current_turn`.
        """
        game = make_game(
            None, self.alice, self.bob, current_turn="p1", double_offered_by="p1"
        )
        expire(game)
        self.assertEqual(game.waiting_seat, "p2")

        # The responder (bob) is the idle seat and may not claim.
        self.assertEqual(
            auth("bob").post(
                f"/api/games/{game.id}/claim_timeout/", {}, format="json"
            ).status_code,
            403,
        )

        resp = auth("alice").post(f"/api/games/{game.id}/claim_timeout/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        game.refresh_from_db()
        self.assertEqual(game.winner, "p1")
        self.assertEqual(game.win_type, "timeout")


class ClaimTimeoutRejectionTest(TestCase):
    """Everything it refuses to do."""

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.match = make_match(self.alice, self.bob)

    def claim(self, game, username="bob"):
        return auth(username).post(
            f"/api/games/{game.id}/claim_timeout/", {}, format="json"
        )

    def test_before_the_deadline_it_reports_the_time_remaining(self):
        game = make_game(self.match, self.alice, self.bob)
        expire(game, hours=1)  # 47h left of 48

        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        error = resp.json()["error"]
        self.assertIn("remaining", error)
        # ~47h left, reported as "46h 59m" (the seconds already elapsed).
        self.assertRegex(error, r"\b46h 5\dm\b")
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_a_fresh_turn_cannot_be_claimed(self):
        game = make_game(self.match, self.alice, self.bob)
        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("still has time", resp.json()["error"])

    def test_a_guest_seat_cannot_be_claimed_against(self):
        """
        Registered seats only. A guest seat is unverifiable, so otherwise anyone
        with the game id could claim — including a hotseat player farming their
        own second seat.
        """
        game = make_game(None, self.alice, None, current_turn="p1")
        expire(game)

        # The registered seat's owner is exactly the plausible attacker here.
        resp = self.claim(game, username="alice")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("registered", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_a_fully_guest_game_cannot_be_claimed(self):
        game = make_game(None, None, None, current_turn="p1")
        expire(game)
        resp = APIClient().post(f"/api/games/{game.id}/claim_timeout/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        game.refresh_from_db()
        self.assertEqual(game.status, "active")

    def test_a_closed_seat_is_pointed_at_abandon(self):
        """
        A deleted account is a deadlock, not a stall, and abandon is deliberately
        non-scoring. Claiming a win here would invent the points that endpoint
        exists to refuse to invent.
        """
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        close_seat(game, "player1")
        expire(game)

        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("abandon", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.status, "active")
        self.match.refresh_from_db()
        self.assertEqual((self.match.player1_score, self.match.player2_score), (0, 0))

    def test_a_game_with_no_clock_cannot_be_claimed(self):
        game = make_game(self.match, self.alice, self.bob, turn_started_at=None)
        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("no turn clock", resp.json()["error"])

    def test_a_waiting_game_cannot_be_claimed(self):
        game = make_game(
            self.match, self.alice, self.bob, status="waiting", turn_started_at=None
        )
        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not active", resp.json()["error"])

    def test_a_finished_game_cannot_be_claimed(self):
        game = make_game(
            self.match, self.alice, self.bob, status="finished", winner="p1",
            win_type="single", points_value=1,
        )
        expire(game)
        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not active", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.winner, "p1")

    def test_claiming_twice_scores_once(self):
        """Replay/idempotency: the first claim finishes the game, the second 400s."""
        game = make_game(self.match, self.alice, self.bob, current_turn="p1")
        expire(game)

        self.assertEqual(self.claim(game).status_code, 200)
        second = self.claim(game)
        self.assertEqual(second.status_code, 400)
        self.assertIn("not active", second.json()["error"])

        self.match.refresh_from_db()
        self.assertEqual((self.match.player1_score, self.match.player2_score), (0, 1))
        self.assertEqual(Game.objects.get(pk=game.pk).points_value, 1)

    def test_a_claim_is_refused_once_the_idle_player_finally_moves(self):
        """Confirming a turn restarts the clock, which withdraws the claim."""
        game = make_game(
            self.match, self.alice, self.bob, current_turn="p1",
            dice_values=OPENING_DICE,
        )
        expire(game)

        confirmed = auth("alice").post(
            f"/api/games/{game.id}/confirm_turn/", {"moves": OPENING_MOVES}, format="json"
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.json())

        # The clock now belongs to bob, so his claim is premature — the
        # deadline guard catches it before the seat check even runs.
        resp = self.claim(game)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("still has time", resp.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.status, "active")


class TimeoutStatsTest(TestCase):
    """
    A timeout is *not* in the stats `exclude` list, and must not be: it has a
    real winner, so `losses = total - wins` already books it on both sides. No
    stats code changed for this feature; this test is what proves that.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        game = make_game(None, self.alice, self.bob, current_turn="p1")
        expire(game)
        self.assertEqual(
            auth("bob").post(
                f"/api/games/{game.id}/claim_timeout/", {}, format="json"
            ).status_code,
            200,
        )

    def stats(self, username):
        return auth(username).get("/api/auth/me/").json()

    def test_the_claimant_gets_a_win(self):
        bob = self.stats("bob")
        self.assertEqual(bob["wins"], 1)
        self.assertEqual(bob["losses"], 0)
        self.assertEqual(bob["total_games"], 1)
        self.assertEqual(bob["total_points_won"], 1)
        self.assertEqual(bob["win_percentage"], 100.0)

    def test_the_idle_player_gets_a_loss(self):
        alice = self.stats("alice")
        self.assertEqual(alice["wins"], 0)
        self.assertEqual(alice["losses"], 1)
        self.assertEqual(alice["total_games"], 1)
        self.assertEqual(alice["total_points_lost"], 1)
        self.assertEqual(alice["win_percentage"], 0.0)

    def test_a_timeout_is_not_a_gammon_or_backgammon(self):
        bob = self.stats("bob")
        self.assertEqual(bob["total_gammons"], 0)
        self.assertEqual(bob["total_backgammons"], 0)


# ---------------------------------------------------------------------------
# One account on both seats — the rating farm ADR-002 meant to close
# ---------------------------------------------------------------------------

class SelfPlayTimeoutTest(TestCase):
    """
    The "registered seats only" rule was written to stop a hotseat player
    farming their own second seat, but it only ever checked that neither FK was
    *null*. One account holding **both** FKs passed every guard: the deadline
    was real, ``_seat_permission_error`` waved the claimant through (the seat's
    user *is* the requester), and the claim minted a genuine scoring win with
    ``+1 wins`` in the stats. Repeatable at will, i.e. a self-serve rating farm.

    These tests pin the forfeit layer, which closes the hole for rows that
    already exist as well as any future route to one — the join guard below is
    the root fix, but this layer must stand on its own.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.match = make_match(self.alice, self.alice)

    def test_the_model_refuses_a_deadline(self):
        game = make_game(self.match, self.alice, self.alice)
        self.assertIsNone(game.timeout_deadline())

    def test_the_serializer_reports_a_null_deadline(self):
        game = make_game(self.match, self.alice, self.alice, current_turn="p1")
        data = GameSerializer(game).data
        # The seat is still reported — the game *is* waiting on p1 — but no
        # deadline means no countdown and no claim button on either client.
        self.assertEqual(data["turn_waiting_seat"], "p1")
        self.assertIsNone(data["turn_deadline"])

    def test_the_claim_is_refused_long_past_the_deadline(self):
        game = make_game(self.match, self.alice, self.alice, current_turn="p1")
        expire(game, hours=500)

        resp = auth("alice").post(
            f"/api/games/{game.id}/claim_timeout/", {}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("both seats", resp.json()["error"])

        game.refresh_from_db()
        self.assertEqual(game.status, "active")
        self.assertIsNone(game.winner)
        self.assertIsNone(game.win_type)

    def test_no_match_score_and_no_stats_are_minted(self):
        game = make_game(self.match, self.alice, self.alice, current_turn="p1")
        expire(game, hours=500)

        self.assertEqual(
            auth("alice").post(
                f"/api/games/{game.id}/claim_timeout/", {}, format="json"
            ).status_code,
            400,
        )

        self.match.refresh_from_db()
        self.assertEqual((self.match.player1_score, self.match.player2_score), (0, 0))

        stats = auth("alice").get("/api/auth/me/").json()
        self.assertEqual(stats["wins"], 0)
        self.assertEqual(stats["losses"], 0)
        self.assertEqual(stats["total_games"], 0)
        self.assertEqual(stats["total_points_won"], 0)

    def test_an_ordinary_two_account_claim_still_works(self):
        """The guard must not catch the case the feature exists for."""
        bob = make_user("bob")
        game = make_game(None, self.alice, bob, current_turn="p1")
        expire(game)
        resp = auth("bob").post(
            f"/api/games/{game.id}/claim_timeout/", {}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(resp.json()["winner"], "p2")


# ---------------------------------------------------------------------------
# The root fix: you cannot sit in both seats
# ---------------------------------------------------------------------------

class SelfJoinGuardTest(TestCase):
    """
    ``join`` is the only route that ever writes ``player2_user``, so refusing a
    self-join there is what stops the same-account-both-seats row existing at
    all. Scoped narrowly: it fires only for an *authenticated* requester whose
    id already owns p1 on a **waiting** (lobby) game or a match with a free
    second seat. Hotseat/local games never reach ``join`` — they are created
    with both names, start ``active``, and leave p2 a guest seat — so the guard
    cannot touch them. The regression tests below pin that.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def lobby_game(self, user="alice"):
        return auth(user).post(
            "/api/games/", {"player1_name": user}, format="json"
        ).json()

    def test_a_user_cannot_join_their_own_lobby_game(self):
        game = self.lobby_game()
        resp = auth("alice").post(f"/api/games/{game['id']}/join/", {}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertIn("both seats", resp.json()["error"])

        row = Game.objects.get(pk=game["id"])
        self.assertEqual(row.status, "waiting")
        self.assertIsNone(row.player2_user_id)

    def test_a_name_override_does_not_smuggle_a_self_join_through(self):
        """The guard keys off the requester's id, not the submitted name."""
        game = self.lobby_game()
        resp = auth("alice").post(
            f"/api/games/{game['id']}/join/", {"player2_name": "Someone Else"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIsNone(Game.objects.get(pk=game["id"]).player2_user_id)

    def test_another_account_can_still_join(self):
        game = self.lobby_game()
        resp = auth("bob").post(f"/api/games/{game['id']}/join/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        row = Game.objects.get(pk=game["id"])
        self.assertEqual(row.status, "active")
        self.assertEqual(row.player2_user_id, self.bob.id)

    def test_a_guest_can_still_join(self):
        game = self.lobby_game()
        resp = APIClient().post(
            f"/api/games/{game['id']}/join/", {"player2_name": "Wanderer"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        row = Game.objects.get(pk=game["id"])
        self.assertEqual(row.status, "active")
        self.assertIsNone(row.player2_user_id)

    def test_a_guest_may_join_a_lobby_game_a_guest_created(self):
        """No requester identity, nothing to compare — the guard must not fire."""
        game = APIClient().post(
            "/api/games/", {"player1_name": "Guest 1"}, format="json"
        ).json()
        resp = APIClient().post(
            f"/api/games/{game['id']}/join/", {"player2_name": "Guest 2"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.json())

    def test_a_user_cannot_join_their_own_match(self):
        match = auth("alice").post(
            "/api/matches/", {"player1_name": "alice", "target_points": 5},
            format="json",
        ).json()
        resp = auth("alice").post(
            f"/api/matches/{match['id']}/join/", {}, format="json"
        )

        self.assertEqual(resp.status_code, 400)
        self.assertIn("both seats", resp.json()["error"])

        row = Match.objects.get(pk=match["id"])
        self.assertEqual(row.player2_name, "")
        self.assertIsNone(row.player2_user_id)
        # And the match's waiting game was left alone.
        self.assertEqual(row.games.get().status, "waiting")

    def test_another_account_can_still_join_a_match(self):
        match = auth("alice").post(
            "/api/matches/", {"player1_name": "alice", "target_points": 5},
            format="json",
        ).json()
        resp = auth("bob").post(f"/api/matches/{match['id']}/join/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())

        row = Match.objects.get(pk=match["id"])
        self.assertEqual(row.player2_user_id, self.bob.id)
        self.assertEqual(row.games.get().status, "active")


class HotseatRegressionTest(TestCase):
    """
    The self-join guard must not cost a logged-in player their hotseat game.
    A hotseat game is created with *both* names, so it starts ``active`` with p2
    as a guest seat (null FK) and never touches ``join`` — and
    ``_seat_permission_error`` lets the registered participant play that guest
    seat. Both halves are pinned here.
    """

    def setUp(self):
        self.alice = make_user("alice")

    def test_a_logged_in_hotseat_game_is_created_and_playable_on_both_seats(self):
        client = auth("alice")
        game = client.post(
            "/api/games/",
            {"player1_name": "alice", "player2_name": "Friend"},
            format="json",
        ).json()

        self.assertEqual(game["status"], "active")
        row = Game.objects.get(pk=game["id"])
        self.assertEqual(row.player1_user_id, self.alice.id)
        # The whole reason the guard is safe: hotseat's second seat is a guest.
        self.assertIsNone(row.player2_user_id)
        self.assertIsNone(row.timeout_deadline())

        # alice plays p1...
        Game.objects.filter(pk=row.pk).update(dice_values=OPENING_DICE)
        resp = client.post(
            f"/api/games/{row.pk}/confirm_turn/", {"moves": OPENING_MOVES},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(resp.json()["current_turn"], "p2")

        # ...and then the guest seat, from the same account, on one device.
        roll = client.post(f"/api/games/{row.pk}/roll_dice/", {}, format="json")
        self.assertEqual(roll.status_code, 200, roll.json())

    def test_a_logged_in_hotseat_match_is_created_active(self):
        match = auth("alice").post(
            "/api/matches/",
            {"player1_name": "alice", "player2_name": "Friend", "target_points": 5},
            format="json",
        ).json()
        row = Match.objects.get(pk=match["id"])
        self.assertIsNone(row.player2_user_id)
        self.assertEqual(row.games.get().status, "active")

    def test_a_fully_guest_hotseat_game_is_untouched(self):
        game = APIClient().post(
            "/api/games/",
            {"player1_name": "Guest 1", "player2_name": "Guest 2"},
            format="json",
        ).json()
        self.assertEqual(game["status"], "active")
        self.assertIsNone(Game.objects.get(pk=game["id"]).timeout_deadline())
