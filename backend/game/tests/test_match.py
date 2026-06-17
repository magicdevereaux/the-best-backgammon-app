"""
Tests for win-type detection, match score tracking, and user stats.
"""
import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from game.game_logic import detect_win_type, win_points, get_initial_board_state
from game.models import Game, Match


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def empty_board():
    return {"points": [0] * 24, "bar": {"p1": 0, "p2": 0}, "off": {"p1": 0, "p2": 0}}


def make_match(target_points=5, p1_name="Alice", p2_name="Bob", p1_user=None, p2_user=None):
    return Match.objects.create(
        target_points=target_points,
        player1_name=p1_name,
        player2_name=p2_name,
        player1_user=p1_user,
        player2_user=p2_user,
    )


def make_finished_game(winner, win_type, points_value, match=None, p1_user=None, p2_user=None):
    board = empty_board()
    board["off"][winner] = 15
    return Game.objects.create(
        match=match,
        player1_user=p1_user,
        player2_user=p2_user,
        player1_name="Alice",
        player2_name="Bob",
        board_state=board,
        current_turn="p1",
        dice_values=[],
        status="finished",
        winner=winner,
        win_type=win_type,
        points_value=points_value,
    )


# ---------------------------------------------------------------------------
# detect_win_type unit tests
# ---------------------------------------------------------------------------

class DetectWinTypeTest(TestCase):
    def _board(self, off_p1=0, off_p2=0, bar_p1=0, bar_p2=0, extra_points=None):
        b = empty_board()
        b["off"]["p1"] = off_p1
        b["off"]["p2"] = off_p2
        b["bar"]["p1"] = bar_p1
        b["bar"]["p2"] = bar_p2
        if extra_points:
            for idx, val in extra_points.items():
                b["points"][idx] = val
        return b

    def test_normal_win_p1_loser_has_borne_off(self):
        b = self._board(off_p1=15, off_p2=3)
        self.assertEqual(detect_win_type(b, "p1"), "normal")

    def test_normal_win_p2_loser_has_borne_off(self):
        b = self._board(off_p1=2, off_p2=15)
        self.assertEqual(detect_win_type(b, "p2"), "normal")

    def test_gammon_p1_wins_loser_has_nothing_off(self):
        b = self._board(off_p1=15, off_p2=0)
        # p2 has checkers but none borne off, none on bar, none in p1's home
        b["points"][0] = -1  # p2 checker on point 1 (p2's home board, not p1's)
        self.assertEqual(detect_win_type(b, "p1"), "gammon")

    def test_gammon_p2_wins_loser_has_nothing_off(self):
        b = self._board(off_p1=0, off_p2=15)
        b["points"][23] = 1  # p1 checker on point 24 (p1's home board, not p2's)
        self.assertEqual(detect_win_type(b, "p2"), "gammon")

    def test_backgammon_p1_wins_p2_on_bar(self):
        b = self._board(off_p1=15, off_p2=0, bar_p2=1)
        self.assertEqual(detect_win_type(b, "p1"), "backgammon")

    def test_backgammon_p2_wins_p1_on_bar(self):
        b = self._board(off_p1=0, off_p2=15, bar_p1=1)
        self.assertEqual(detect_win_type(b, "p2"), "backgammon")

    def test_backgammon_p1_wins_p2_in_p1_home(self):
        # p1's home = indices 18-23 (points 19-24); p2 has -1 there
        b = self._board(off_p1=15, off_p2=0)
        b["points"][18] = -1  # p2 checker on point 19 (p1's home board)
        self.assertEqual(detect_win_type(b, "p1"), "backgammon")

    def test_backgammon_p2_wins_p1_in_p2_home(self):
        # p2's home = indices 0-5 (points 1-6); p1 has +1 there
        b = self._board(off_p1=0, off_p2=15)
        b["points"][3] = 1  # p1 checker on point 4 (p2's home board)
        self.assertEqual(detect_win_type(b, "p2"), "backgammon")


class WinPointsTest(TestCase):
    def test_normal(self):
        self.assertEqual(win_points("normal"), 1)

    def test_gammon(self):
        self.assertEqual(win_points("gammon"), 2)

    def test_backgammon(self):
        self.assertEqual(win_points("backgammon"), 3)


# ---------------------------------------------------------------------------
# Match API endpoint tests
# ---------------------------------------------------------------------------

class MatchCreationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="testpass1")

    def test_create_match_hotseat(self):
        res = self.client.post("/api/matches/", {
            "target_points": 5,
            "player1_name": "Alice",
            "player2_name": "Bob",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["target_points"], 5)
        self.assertEqual(data["player1_score"], 0)
        self.assertEqual(data["player2_score"], 0)
        self.assertEqual(data["status"], "active")
        self.assertIsNotNone(data["current_game_id"])
        game = Game.objects.get(pk=data["current_game_id"])
        self.assertEqual(game.status, "active")
        self.assertEqual(game.match_id, data["id"])

    def test_create_match_authenticated_uses_username(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/matches/", {"target_points": 3, "player2_name": "Bob"}, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["player1_name"], "alice")

    def test_invalid_target_points(self):
        res = self.client.post("/api/matches/", {
            "target_points": 4,
            "player1_name": "Alice",
            "player2_name": "Bob",
        }, format="json")
        self.assertEqual(res.status_code, 400)

    def test_online_match_creates_waiting_game(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post("/api/matches/", {"target_points": 5}, format="json")
        self.assertEqual(res.status_code, 201)
        game = Game.objects.get(pk=res.json()["current_game_id"])
        self.assertEqual(game.status, "waiting")


class MatchScoreUpdateTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _game_with_board_state_near_win(self, winner, win_type_expected):
        """
        Create an active game in a match one bear-off move away from a win.
        P1: last checker on point 24 (index 23), die=1 → from_point=24, to_point=25.
        P2: last checker on point 1 (index 0), die=1 → from_point=1, to_point=25.
        """
        match = make_match(target_points=5)

        board = empty_board()
        if winner == "p1":
            board["off"]["p1"] = 14
            board["points"][23] = 1   # last p1 checker on point 24
            board["points"][0] = -15  # all p2 checkers on point 1 (p2's home, not p1's)
        else:
            board["off"]["p2"] = 14
            board["points"][0] = -1   # last p2 checker on point 1
            board["points"][23] = 15  # all p1 checkers on point 24

        game = Game.objects.create(
            match=match,
            player1_name="Alice",
            player2_name="Bob",
            board_state=board,
            current_turn=winner,
            dice_values=[1],
            status="active",
        )
        return game, match

    def test_win_updates_match_score(self):
        game, match = self._game_with_board_state_near_win("p1", "gammon")
        res = self.client.post(f"/api/games/{game.id}/confirm_turn/", {
            "moves": [{"from_point": 24, "to_point": 25}]
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "finished")
        self.assertIsNotNone(data["win_type"])
        self.assertIsNotNone(data["points_value"])

        match.refresh_from_db()
        self.assertEqual(match.player1_score, data["points_value"])
        self.assertEqual(match.player2_score, 0)

    def test_match_finishes_when_target_reached(self):
        match = make_match(target_points=3)
        # Pre-set score so one more gammon (2 pts) will finish the match
        match.player1_score = 2
        match.save()

        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1   # p1's last checker on point 24
        # p2 has 0 borne off, 0 on bar, not in p1's home board → gammon
        board["points"][0] = -15

        game = Game.objects.create(
            match=match,
            player1_name="Alice",
            player2_name="Bob",
            board_state=board,
            current_turn="p1",
            dice_values=[1],
            status="active",
        )

        res = self.client.post(f"/api/games/{game.id}/confirm_turn/", {
            "moves": [{"from_point": 24, "to_point": 25}]
        }, format="json")
        self.assertEqual(res.status_code, 200)

        match.refresh_from_db()
        self.assertEqual(match.status, "finished")
        self.assertEqual(match.winner, "p1")

    def test_game_stores_win_type_and_points_value(self):
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1   # last p1 checker on point 24
        board["points"][0] = -15  # p2 has 0 off, 0 bar, not in p1 home → gammon

        game = Game.objects.create(
            player1_name="Alice",
            player2_name="Bob",
            board_state=board,
            current_turn="p1",
            dice_values=[1],
            status="active",
        )
        res = self.client.post(f"/api/games/{game.id}/confirm_turn/", {
            "moves": [{"from_point": 24, "to_point": 25}]
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "gammon")
        self.assertEqual(data["points_value"], 2)

    def test_backgammon_detected_when_loser_on_bar(self):
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1  # last p1 checker on point 24
        board["bar"]["p2"] = 1   # p2 on bar → backgammon

        game = Game.objects.create(
            player1_name="Alice",
            player2_name="Bob",
            board_state=board,
            current_turn="p1",
            dice_values=[1],
            status="active",
        )
        res = self.client.post(f"/api/games/{game.id}/confirm_turn/", {
            "moves": [{"from_point": 24, "to_point": 25}]
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "backgammon")
        self.assertEqual(data["points_value"], 3)

    def test_normal_win_when_loser_has_borne_off(self):
        board = empty_board()
        board["off"]["p1"] = 14
        board["points"][23] = 1  # last p1 checker on point 24
        board["off"]["p2"] = 3   # p2 has borne off some → normal win

        game = Game.objects.create(
            player1_name="Alice",
            player2_name="Bob",
            board_state=board,
            current_turn="p1",
            dice_values=[1],
            status="active",
        )
        res = self.client.post(f"/api/games/{game.id}/confirm_turn/", {
            "moves": [{"from_point": 24, "to_point": 25}]
        }, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["win_type"], "normal")
        self.assertEqual(data["points_value"], 1)


class MatchNextGameTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_next_game_creates_new_game(self):
        match = make_match()
        make_finished_game("p1", "normal", 1, match=match)

        res = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["current_turn"], "p1")  # winner of last game goes first
        self.assertEqual(data["match"], match.id)

    def test_next_game_winner_goes_first(self):
        match = make_match()
        make_finished_game("p2", "gammon", 2, match=match)

        res = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["current_turn"], "p2")

    def test_next_game_blocked_if_match_finished(self):
        match = make_match()
        match.status = "finished"
        match.winner = "p1"
        match.save()

        res = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_next_game_blocked_if_game_in_progress(self):
        match = make_match()
        Game.objects.create(
            match=match,
            player1_name="Alice",
            player2_name="Bob",
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status="active",
        )
        res = self.client.post(f"/api/matches/{match.id}/next_game/", {}, format="json")
        self.assertEqual(res.status_code, 400)


# ---------------------------------------------------------------------------
# User stats tests
# ---------------------------------------------------------------------------

class UserStatsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="alice", password="testpass1")
        self.client.force_authenticate(user=self.user)

    def test_stats_empty_for_new_user(self):
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["wins"], 0)
        self.assertEqual(data["losses"], 0)
        self.assertEqual(data["total_games"], 0)
        self.assertEqual(data["total_gammons"], 0)
        self.assertEqual(data["total_backgammons"], 0)
        self.assertEqual(data["total_points_won"], 0)
        self.assertEqual(data["total_points_lost"], 0)
        self.assertEqual(data["win_percentage"], 0.0)
        self.assertEqual(data["gammon_rate"], 0.0)

    def test_stats_counts_wins_and_gammons(self):
        make_finished_game("p1", "gammon", 2, p1_user=self.user)
        make_finished_game("p1", "normal", 1, p1_user=self.user)
        make_finished_game("p2", "normal", 1, p1_user=self.user)  # loss

        res = self.client.get("/api/auth/me/")
        data = res.json()
        self.assertEqual(data["total_games"], 3)
        self.assertEqual(data["wins"], 2)
        self.assertEqual(data["losses"], 1)
        self.assertEqual(data["total_gammons"], 1)
        self.assertEqual(data["total_backgammons"], 0)
        self.assertEqual(data["total_points_won"], 3)
        self.assertEqual(data["total_points_lost"], 1)
        self.assertAlmostEqual(data["win_percentage"], 66.7)
        self.assertAlmostEqual(data["gammon_rate"], 50.0)

    def test_stats_counts_backgammons_as_p2(self):
        make_finished_game("p2", "backgammon", 3, p2_user=self.user)
        make_finished_game("p1", "normal", 1, p2_user=self.user)  # loss as p2

        res = self.client.get("/api/auth/me/")
        data = res.json()
        self.assertEqual(data["wins"], 1)
        self.assertEqual(data["total_backgammons"], 1)
        self.assertEqual(data["total_points_won"], 3)
        self.assertEqual(data["total_points_lost"], 1)

    def test_stats_ignores_games_without_win_type(self):
        # Old games (win_type=None) still count toward wins/losses but not gammons
        Game.objects.create(
            player1_user=self.user,
            player1_name="alice",
            player2_name="bob",
            board_state=empty_board(),
            status="finished",
            winner="p1",
            win_type=None,
            points_value=None,
        )
        res = self.client.get("/api/auth/me/")
        data = res.json()
        self.assertEqual(data["wins"], 1)
        self.assertEqual(data["total_gammons"], 0)
        self.assertEqual(data["total_points_won"], 0)  # None coalesced to 0
