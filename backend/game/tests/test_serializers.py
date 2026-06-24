from django.test import TestCase
from game.models import Game
from game.serializers import GameSerializer
from game.game_logic import get_initial_board_state


class GameSerializerTest(TestCase):
    """
    These tests FAIL until you:
      1. Add fields to Game in models.py  (setUp will TypeError otherwise)
      2. Add a Meta class to GameSerializer in serializers.py

    Run with:
        python manage.py test game.tests.test_serializers
    """

    def setUp(self):
        self.game = Game.objects.create(
            player1_name="Alice",
            player2_name="Bob",
            status="active",
            current_turn="p1",
            dice_values=[3, 5],
            board_state=get_initial_board_state(),
        )

    def test_serializer_has_meta_class(self):
        # GameSerializer(pass) has no Meta — this will AssertionError until you add it
        s = GameSerializer(self.game)
        self.assertIsNotNone(s.data)

    def test_serialized_data_includes_id(self):
        s = GameSerializer(self.game)
        self.assertIn("id", s.data)
        self.assertEqual(s.data["id"], self.game.pk)

    def test_serialized_data_includes_player1_name(self):
        s = GameSerializer(self.game)
        self.assertIn("player1_name", s.data)
        self.assertEqual(s.data["player1_name"], "Alice")

    def test_serialized_data_includes_player2_name(self):
        s = GameSerializer(self.game)
        self.assertEqual(s.data["player2_name"], "Bob")

    def test_serialized_data_includes_status(self):
        s = GameSerializer(self.game)
        self.assertEqual(s.data["status"], "active")

    def test_serialized_data_includes_current_turn(self):
        s = GameSerializer(self.game)
        self.assertEqual(s.data["current_turn"], "p1")

    def test_serialized_data_includes_dice_values(self):
        s = GameSerializer(self.game)
        self.assertIn("dice_values", s.data)
        self.assertEqual(list(s.data["dice_values"]), [3, 5])

    def test_serialized_data_includes_board_state(self):
        s = GameSerializer(self.game)
        self.assertIn("board_state", s.data)
        self.assertIn("points", s.data["board_state"])
        self.assertEqual(len(s.data["board_state"]["points"]), 24)

    def test_serialized_data_winner_is_null_when_game_active(self):
        s = GameSerializer(self.game)
        self.assertIsNone(s.data.get("winner"))

    def test_serializer_includes_created_at(self):
        s = GameSerializer(self.game)
        self.assertIn("created_at", s.data)

    def test_serializer_includes_updated_at(self):
        s = GameSerializer(self.game)
        self.assertIn("updated_at", s.data)

    def test_viewer_seat_null_without_request_context(self):
        # No request in context (e.g. a guest, or serialization outside a view)
        # → no server-side ownership signal.
        s = GameSerializer(self.game)
        self.assertIn("viewer_seat", s.data)
        self.assertIsNone(s.data["viewer_seat"])
        self.assertFalse(s.data["viewer_is_participant"])
