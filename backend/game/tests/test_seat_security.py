"""
Server-side seat/turn enforcement on the gameplay actions
(roll_dice / move_checker / confirm_turn).

Policy under test (see _seat_permission_error in views.py):
  - A seat owned by a registered user may only be played by that user.
  - The other participant acting on it gets 403 "not your turn".
  - Non-participants (authenticated or anonymous) get 403.
  - Guest (unowned) seats stay playable by anonymous devices and by this
    game's own participants (hotseat), but not by other logged-in accounts.
  - Fully-guest games are unrestricted (no identity to verify).
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


class SeatSecurityBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(username="alice", password="password123")
        self.bob = User.objects.create_user(username="bob", password="password123")
        self.mallory = User.objects.create_user(username="mallory", password="password123")

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def as_anonymous(self):
        self.client.force_authenticate(user=None)


class OwnedSeatEnforcementTest(SeatSecurityBase):
    """Both seats owned by distinct accounts — the fully-enforceable case."""

    def _game(self, **kwargs):
        return make_game(
            player1_user=self.alice, player2_user=self.bob,
            player1_name="alice", player2_name="bob",
            **kwargs,
        )

    # -- wrong user rejected -------------------------------------------------

    def test_non_participant_cannot_roll_dice(self):
        game = self._game()
        self.as_user(self.mallory)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not a participant", res.json()["error"])

    def test_non_participant_cannot_confirm_turn(self):
        game = self._game(dice_values=[1, 2])
        self.as_user(self.mallory)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 1, "to_point": 2}, {"from_point": 2, "to_point": 4}]},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")
        self.assertEqual(game.dice_values, [1, 2])
        self.assertEqual(game.board_state, get_initial_board_state())

    def test_non_participant_cannot_move_checker(self):
        game = self._game(dice_values=[1])
        self.as_user(self.mallory)
        res = self.client.post(
            f"/api/games/{game.pk}/move_checker/",
            {"from_point": 1, "to_point": 2},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_anonymous_cannot_act_on_owned_seat(self):
        game = self._game()
        self.as_anonymous()
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("registered player", res.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.dice_values, [])

    # -- out-of-turn rejected ------------------------------------------------

    def test_opponent_cannot_act_out_of_turn(self):
        game = self._game(current_turn="p1", dice_values=[1, 2])
        self.as_user(self.bob)  # participant, but it's alice's turn
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": []},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("not your turn", res.json()["error"])
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p1")

    def test_opponent_cannot_roll_out_of_turn(self):
        game = self._game(current_turn="p2")
        self.as_user(self.alice)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not your turn", res.json()["error"])

    # -- right user accepted -------------------------------------------------

    def test_seat_owner_can_roll_dice(self):
        game = self._game()
        self.as_user(self.alice)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)
        self.assertIn(len(res.json()["dice_values"]), [2, 4])

    def test_seat_owner_can_confirm_turn(self):
        game = self._game(dice_values=[1, 2])
        self.as_user(self.alice)
        res = self.client.post(
            f"/api/games/{game.pk}/confirm_turn/",
            {"moves": [{"from_point": 1, "to_point": 2}, {"from_point": 2, "to_point": 4}]},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.current_turn, "p2")

    def test_each_owner_acts_on_their_own_turn(self):
        game = self._game(current_turn="p2")
        self.as_user(self.bob)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)


class GuestSeatEnforcementTest(SeatSecurityBase):
    """Seats without a user FK: guests have no server identity to verify."""

    def test_fully_guest_game_stays_open_to_anonymous(self):
        game = make_game()  # no user FKs at all
        self.as_anonymous()
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)

    def test_hotseat_creator_can_play_the_guest_seat(self):
        # alice created a hotseat game: p1 is her account, p2 is a guest name
        # on the same device. She must be able to act on p2's turn.
        game = make_game(
            player1_user=self.alice, player1_name="alice", current_turn="p2"
        )
        self.as_user(self.alice)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)

    def test_anonymous_can_play_a_guest_seat_in_a_mixed_game(self):
        # alice (account) vs an online guest joiner (anonymous device): the
        # guest's requests carry no identity and must stay allowed on p2's turn.
        game = make_game(
            player1_user=self.alice, player1_name="alice", current_turn="p2"
        )
        self.as_anonymous()
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 200)

    def test_other_account_cannot_play_a_guest_seat(self):
        # mallory is logged in and provably not a participant — rejected even
        # though the seat itself is a guest seat.
        game = make_game(
            player1_user=self.alice, player1_name="alice", current_turn="p2"
        )
        self.as_user(self.mallory)
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not a participant", res.json()["error"])

    def test_owned_seat_still_enforced_in_mixed_game(self):
        # In the same mixed game, when it's alice's (owned) turn, anonymous
        # requests are rejected — the guest can't act on her seat.
        game = make_game(
            player1_user=self.alice, player1_name="alice", current_turn="p1"
        )
        self.as_anonymous()
        res = self.client.post(f"/api/games/{game.pk}/roll_dice/")
        self.assertEqual(res.status_code, 403)
