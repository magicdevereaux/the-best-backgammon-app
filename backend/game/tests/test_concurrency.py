"""
Transaction and row-locking tests for the mutating game/match actions.

**What this file is defending against.** Every mutating action is a
read-modify-write: read the row, check some guards against it, compute the new
board or score in Python, write the whole row back. Nothing here used
``transaction.atomic()`` or ``select_for_update()``, and ``ATOMIC_REQUESTS`` is
unset, so two requests that read before either wrote both passed the guards and
the second ``save()`` silently overwrote the first. SQLite made this *narrow*
rather than impossible — it serializes writers but not readers, and even
``runserver`` is multi-threaded — and Postgres with several gunicorn workers
widens the window to the whole request.

**Why these tests are sequential, not threaded.** A genuinely concurrent test
would need ``TransactionTestCase``, real threads and a backend that actually
implements ``FOR UPDATE`` (SQLite does not — ``has_select_for_update`` is False,
so the lock compiles away to nothing here). That buys flakiness, not
confidence. What is worth pinning down is the *observable* guarantee the
locking exists to deliver: **a replayed request must be refused, not applied a
second time.** Every duplicate-submission bug a user can actually cause — a
double-tapped Confirm, a retried POST, two open tabs, an impatient
"Next game" — degenerates to exactly that, and it is fully deterministic.

``LockingIsActuallyRequestedTest`` covers the part behaviour cannot see on
SQLite: that the lock is genuinely asked for, and on the right model.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_concurrency
"""

from contextlib import contextmanager
from unittest import mock

from django.contrib.auth.models import User
from django.db.models.query import QuerySet
from django.test import TestCase
from rest_framework.test import APIClient

from game.game_logic import get_initial_board_state
from game.models import Game, Match


PASSWORD = "securepass123"


def empty_board():
    return {"points": [0] * 24, "bar": {"p1": 0, "p2": 0}, "off": {"p1": 0, "p2": 0}}


def make_match(**kwargs):
    defaults = dict(
        player1_name="Alice",
        player2_name="Bob",
        target_points=5,
    )
    defaults.update(kwargs)
    return Match.objects.create(**defaults)


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


def nearly_won_game(**kwargs):
    """p1 one checker from bearing off the last one — confirm_turn ends the game."""
    board = empty_board()
    board["points"][23] = 1
    board["off"]["p1"] = 14
    defaults = dict(board_state=board, dice_values=[1], current_turn="p1")
    defaults.update(kwargs)
    return make_game(**defaults)


BEAR_OFF_LAST = {"moves": [{"from_point": 24, "to_point": 25}]}


@contextmanager
def lock_spy():
    """
    Record every ``select_for_update()`` call by model name.

    SQLite emits no ``FOR UPDATE`` clause, so the SQL can't be inspected to
    prove a row was locked. Spying on the queryset method can, and it fails
    loudly if a future edit drops the lock while leaving the behaviour intact
    on SQLite — which is precisely the regression that would only show up in
    production on Postgres.
    """
    calls = []
    original = QuerySet.select_for_update

    def spy(self, *args, **kwargs):
        calls.append(self.model.__name__)
        return original(self, *args, **kwargs)

    with mock.patch.object(QuerySet, "select_for_update", spy):
        yield calls


# ---------------------------------------------------------------------------
# next_game: the one action whose replay *inserts* rather than overwrites
# ---------------------------------------------------------------------------

class NextGameDuplicateTest(TestCase):
    """
    The highest-consequence replay in the app. Every other action loses an
    update; this one mints a second game, and a match holding two active games
    is permanently broken — later next_game calls all trip the in-progress
    guard, and the clients disagree about which game is "the" current one.
    There is no unique constraint to catch it, so the guard read under the
    match lock is the entire defence.
    """

    def setUp(self):
        self.client = APIClient()

    def _finished_game(self, match, winner="p1"):
        return make_game(
            match=match,
            status="finished",
            winner=winner,
            win_type="normal",
            points_value=1,
        )

    def test_double_submitted_next_game_creates_exactly_one_game(self):
        match = make_match()
        self._finished_game(match)

        first = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        second = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")

        self.assertEqual(first.status_code, 201)
        # Unchanged response shape: the replay is refused by the existing guard,
        # which is now simply un-skippable.
        self.assertEqual(second.status_code, 400)
        self.assertIn("already in progress", second.json()["error"])

        self.assertEqual(match.games.filter(status="active").count(), 1)
        self.assertEqual(match.games.count(), 2)  # the finished one + one new

    def test_replay_does_not_mint_a_second_crawford_game(self):
        """
        Crawford is "exactly one cube-less game per match", and the rule is
        enforced by counting existing `crawford_game` rows. A duplicated
        next_game at match point therefore hands the trailing player a whole
        second game with the cube disabled.
        """
        match = make_match(player1_score=4, target_points=5)
        self._finished_game(match)

        self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")

        self.assertEqual(match.games.filter(crawford_game=True).count(), 1)

    def test_next_game_locks_the_match_row(self):
        match = make_match()
        self._finished_game(match)

        with lock_spy() as locked:
            res = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")

        self.assertEqual(res.status_code, 201)
        self.assertIn("Match", locked)


# ---------------------------------------------------------------------------
# confirm_turn: the action users double-tap
# ---------------------------------------------------------------------------

class ConfirmTurnReplayTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_replayed_confirm_is_rejected_after_the_turn_advanced(self):
        game = make_game(dice_values=[6, 6])
        body = {
            "moves": [
                {"from_point": 1, "to_point": 7},
                {"from_point": 1, "to_point": 7},
            ]
        }

        first = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/", body, format="json"
        )
        self.assertEqual(first.status_code, 200)
        board_after_first = first.json()["board_state"]

        second = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/", body, format="json"
        )
        # Committing cleared dice_values, so the replay reads the post-turn row.
        self.assertEqual(second.status_code, 400)
        self.assertIn("No dice rolled", second.json()["error"])

        game.refresh_from_db()
        self.assertEqual(game.board_state, board_after_first)
        self.assertEqual(game.current_turn, "p2")  # flipped once, not twice

    def test_replayed_winning_confirm_does_not_score_the_match_twice(self):
        """
        The nastiest version: the second request re-applies a *game-finishing*
        turn, and _apply_game_result increments the match score in Python. Read
        the match after the first commit and the increment lands again — the
        game is worth double.
        """
        match = make_match()
        game = nearly_won_game(match=match)

        first = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/", BEAR_OFF_LAST, format="json"
        )
        self.assertEqual(first.status_code, 200)
        awarded = first.json()["points_value"]

        match.refresh_from_db()
        self.assertEqual(match.player1_score, awarded)

        second = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/", BEAR_OFF_LAST, format="json"
        )
        self.assertEqual(second.status_code, 400)

        match.refresh_from_db()
        self.assertEqual(match.player1_score, awarded)
        self.assertEqual(match.player2_score, 0)

    def test_confirm_turn_locks_the_game_row(self):
        game = make_game(dice_values=[6, 6])
        with lock_spy() as locked:
            res = self.client.post(
                f"/api/games/{game.pk}/confirm_turn/",
                {"moves": [{"from_point": 1, "to_point": 7}] * 2},
                format="json",
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("Game", locked)

    def test_winning_confirm_locks_the_match_row_too(self):
        """
        _apply_game_result is reached from two different actions, so the match
        lock lives in the helper. Confirm it is actually taken from this path —
        the game lock alone does not protect the match row.
        """
        game = nearly_won_game(match=make_match())
        with lock_spy() as locked:
            res = self.client.post(
                f"/api/games/{game.pk}/confirm_turn/", BEAR_OFF_LAST, format="json"
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("Game", locked)
        self.assertIn("Match", locked)


# ---------------------------------------------------------------------------
# roll_dice: re-rolling is cheating, and the guard is a read-modify-write
# ---------------------------------------------------------------------------

class RollDiceReplayTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_second_roll_is_refused_and_the_dice_do_not_change(self):
        game = make_game()

        first = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(first.status_code, 200)
        rolled = first.json()["dice_values"]

        second = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(second.status_code, 400)
        self.assertIn("already been rolled", second.json()["error"])

        game.refresh_from_db()
        self.assertEqual(game.dice_values, rolled)

    def test_roll_dice_locks_the_game_row(self):
        game = make_game()
        with lock_spy() as locked:
            res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Game", locked)


# ---------------------------------------------------------------------------
# Doubling cube: neither branch of respond_to_double is idempotent
# ---------------------------------------------------------------------------

class DoubleResponseReplayTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_double_drop_cannot_be_applied_twice(self):
        match = make_match()
        game = make_game(match=match, double_offered_by="p1", cube_value=2)

        first = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": False}, format="json"
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["win_type"], "drop")

        match.refresh_from_db()
        self.assertEqual(match.player1_score, 2)

        second = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": False}, format="json"
        )
        # The game is finished, so it fails the status guard rather than the
        # offer guard — either way the points are awarded exactly once.
        self.assertEqual(second.status_code, 400)

        match.refresh_from_db()
        self.assertEqual(match.player1_score, 2)

    def test_double_accept_cannot_double_the_cube_twice(self):
        game = make_game(double_offered_by="p1", cube_value=1)

        first = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["cube_value"], 2)

        second = self.client.post(
            f"/api/games/{game.pk}/respond_to_double/", {"accept": True}, format="json"
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("No double has been offered", second.json()["error"])

        game.refresh_from_db()
        self.assertEqual(game.cube_value, 2)
        self.assertEqual(game.cube_owner, "p2")

    def test_replayed_offer_double_does_not_re_offer(self):
        game = make_game()

        self.assertEqual(
            self.client.post(f"/api/games/{game.pk}/offer_double/").status_code, 200
        )
        second = self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertEqual(second.status_code, 400)
        self.assertIn("already been offered", second.json()["error"])

    def test_cube_actions_lock_the_game_row(self):
        game = make_game()
        with lock_spy() as offered:
            self.client.post(f"/api/games/{game.pk}/offer_double/")
        self.assertIn("Game", offered)

        with lock_spy() as answered:
            self.client.post(
                f"/api/games/{game.pk}/respond_to_double/",
                {"accept": True},
                format="json",
            )
        self.assertIn("Game", answered)


# ---------------------------------------------------------------------------
# Joining: two people, one open seat
# ---------------------------------------------------------------------------

class JoinRaceTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_second_join_cannot_evict_the_first_player(self):
        game = make_game(player2_name="", status="waiting")

        first = self.client.post(
            f"/api/games/{game.pk}/join/", {"player2_name": "Bob"}, format="json"
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.post(
            f"/api/games/{game.pk}/join/", {"player2_name": "Carol"}, format="json"
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("not open to join", second.json()["error"])

        game.refresh_from_db()
        self.assertEqual(game.player2_name, "Bob")

    def test_second_match_join_cannot_evict_the_first_player(self):
        match = make_match(player2_name="")
        make_game(match=match, player2_name="", status="waiting")

        first = self.client.post(
            f"/api/matches/{match.id}/join/", {"player2_name": "Bob"}, format="json"
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.post(
            f"/api/matches/{match.id}/join/", {"player2_name": "Carol"}, format="json"
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("already has two players", second.json()["error"])

        match.refresh_from_db()
        self.assertEqual(match.player2_name, "Bob")
        self.assertEqual(match.games.get().player2_name, "Bob")

    def test_join_locks_the_game_row(self):
        game = make_game(player2_name="", status="waiting")
        with lock_spy() as locked:
            res = self.client.post(
                f"/api/games/{game.pk}/join/", {"player2_name": "Bob"}, format="json"
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("Game", locked)

    def test_match_join_locks_both_the_match_and_its_waiting_game(self):
        match = make_match(player2_name="")
        make_game(match=match, player2_name="", status="waiting")
        with lock_spy() as locked:
            res = self.client.post(
                f"/api/matches/{match.id}/join/", {"player2_name": "Bob"}, format="json"
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("Match", locked)
        self.assertIn("Game", locked)


# ---------------------------------------------------------------------------
# abandon: two writes that must not come apart
# ---------------------------------------------------------------------------

class AbandonReplayTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.survivor = User.objects.create_user("survivor", password=PASSWORD)

    def _deadlocked(self):
        """A game stuck on p1's closed seat, with p2 alive to abandon it."""
        match = make_match(player2_user=self.survivor, player1_deleted=True)
        game = make_game(
            match=match,
            player2_user=self.survivor,
            player1_deleted=True,
            current_turn="p1",
        )
        self.client.force_authenticate(user=self.survivor)
        return match, game

    def test_replayed_abandon_is_refused(self):
        match, game = self._deadlocked()

        first = self.client.post(f"/api/games/{game.pk}/abandon/")
        self.assertEqual(first.status_code, 200)

        second = self.client.post(f"/api/games/{game.pk}/abandon/")
        self.assertEqual(second.status_code, 400)
        self.assertIn("already finished", second.json()["error"])

        match.refresh_from_db()
        self.assertEqual(match.status, "finished")
        # Still non-scoring after both calls.
        self.assertEqual(match.player1_score, 0)
        self.assertEqual(match.player2_score, 0)

    def test_abandon_locks_both_the_game_and_its_match(self):
        _, game = self._deadlocked()
        with lock_spy() as locked:
            res = self.client.post(f"/api/games/{game.pk}/abandon/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Game", locked)
        self.assertIn("Match", locked)

    def test_a_failed_match_write_rolls_the_game_back(self):
        """
        Finishing the game without finishing the match is the half-state this
        endpoint exists to prevent — the survivor could mint another dead game
        from an open match. Both writes share one transaction, so a failure on
        the second undoes the first.
        """
        _, game = self._deadlocked()

        # assertLogs doubles as a muzzle: the deliberate 500 would otherwise
        # dump a traceback into the test output and read as a real failure.
        with mock.patch.object(Match, "save", side_effect=RuntimeError("boom")):
            with self.assertLogs("django.request", level="ERROR"):
                with self.assertRaises(RuntimeError):
                    self.client.post(f"/api/games/{game.pk}/abandon/")

        game.refresh_from_db()
        self.assertEqual(game.status, "active")
        self.assertIsNone(game.win_type)


# ---------------------------------------------------------------------------
# Multi-row writes that must not come apart
# ---------------------------------------------------------------------------

class AtomicMultiRowWriteTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_match_creation_rolls_back_if_the_first_game_fails(self):
        """
        A match is created together with its first game. A match that lost its
        game would be unplayable forever: next_game refuses to run while it has
        no finished game to follow, and the lobby would advertise nothing.
        """
        with mock.patch(
            "game.views.get_initial_board_state", side_effect=RuntimeError("boom")
        ):
            with self.assertLogs("django.request", level="ERROR"):
                with self.assertRaises(RuntimeError):
                    self.client.post(
                        "/api/matches/",
                        {"player1_name": "Alice", "player2_name": "Bob"},
                        format="json",
                    )

        self.assertEqual(Match.objects.count(), 0)
        self.assertEqual(Game.objects.count(), 0)

    def test_account_deletion_rolls_back_if_seat_closure_fails(self):
        """
        The seat-closure flags are the only thing stopping an orphaned seat
        from reading as an anonymously-playable guest seat, so a deletion that
        committed the user removal without them would quietly open every game
        the account was in.
        """
        user = User.objects.create_user("doomed", password=PASSWORD)
        game = make_game(player1_user=user, player1_name="doomed")

        self.client.force_authenticate(user=user)
        with mock.patch(
            "game.views._close_deleted_account_seats", side_effect=RuntimeError("boom")
        ):
            with self.assertLogs("django.request", level="ERROR"):
                with self.assertRaises(RuntimeError):
                    self.client.delete(
                        "/api/auth/me/", {"password": PASSWORD}, format="json"
                    )

        self.assertTrue(User.objects.filter(pk=user.pk).exists())
        game.refresh_from_db()
        self.assertEqual(game.player1_user_id, user.pk)
        self.assertFalse(game.player1_deleted)


# ---------------------------------------------------------------------------
# Read-only endpoints must NOT take write locks
# ---------------------------------------------------------------------------

class LockingIsActuallyRequestedTest(TestCase):
    """
    The other half of the contract: locking a row on every GET would serialize
    the ~3.5s poll both clients run, turning a robustness fix into a
    throughput bug. Reads stay lock-free.
    """

    def setUp(self):
        self.client = APIClient()

    def test_retrieving_a_game_takes_no_lock(self):
        game = make_game()
        with lock_spy() as locked:
            res = self.client.get(f"/api/games/{game.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(locked, [])

    def test_listing_games_takes_no_lock(self):
        make_game(status="waiting", player2_name="")
        with lock_spy() as locked:
            res = self.client.get("/api/games/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(locked, [])
