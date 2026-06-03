from django.test import TestCase
from game.models import Game


class GameModelFieldsTest(TestCase):
    """
    All tests here FAIL until you add the corresponding fields to Game in models.py.

    Run with:
        python manage.py test game.tests.test_models
    """

    # --- Player name fields --------------------------------------------------

    def test_game_has_player1_name_field(self):
        # Needs: player1_name = models.CharField(max_length=...)
        game = Game.objects.create(player1_name="Alice")
        self.assertEqual(game.player1_name, "Alice")

    def test_game_has_player2_name_field(self):
        # Needs: player2_name = models.CharField(max_length=...)
        game = Game.objects.create(player2_name="Bob")
        self.assertEqual(game.player2_name, "Bob")

    # --- Status field --------------------------------------------------------

    def test_game_status_defaults_to_waiting(self):
        # Needs: status = models.CharField(choices=..., default="waiting", ...)
        game = Game.objects.create()
        self.assertEqual(game.status, "waiting")

    def test_game_status_can_be_set_to_active(self):
        game = Game.objects.create(status="active")
        self.assertEqual(game.status, "active")

    def test_game_status_can_be_set_to_finished(self):
        game = Game.objects.create(status="finished")
        self.assertEqual(game.status, "finished")

    # --- Turn field ----------------------------------------------------------

    def test_game_has_current_turn_field(self):
        # Needs: current_turn = models.CharField(choices=..., ...)
        game = Game.objects.create(current_turn="p1")
        self.assertEqual(game.current_turn, "p1")

    def test_current_turn_can_be_p2(self):
        game = Game.objects.create(current_turn="p2")
        self.assertEqual(game.current_turn, "p2")

    # --- Dice values field ---------------------------------------------------

    def test_game_has_dice_values_field(self):
        # Needs: dice_values = models.JSONField(default=list, ...)
        game = Game.objects.create(dice_values=[3, 5])
        self.assertEqual(game.dice_values, [3, 5])

    def test_dice_values_supports_doubles(self):
        # Doubles: the player gets to move four times
        game = Game.objects.create(dice_values=[4, 4, 4, 4])
        self.assertEqual(len(game.dice_values), 4)
        self.assertTrue(all(v == 4 for v in game.dice_values))

    def test_dice_values_defaults_to_empty_list(self):
        game = Game.objects.create()
        self.assertEqual(game.dice_values, [])

    # --- Board state field ---------------------------------------------------

    def test_game_has_board_state_field(self):
        # Needs: board_state = models.JSONField(default=dict, ...)
        board = {
            "points": [0] * 24,
            "bar": {"p1": 0, "p2": 0},
            "off": {"p1": 0, "p2": 0},
        }
        game = Game.objects.create(board_state=board)
        self.assertEqual(len(game.board_state["points"]), 24)

    def test_board_state_stores_bar_counts(self):
        board = {"points": [0] * 24, "bar": {"p1": 2, "p2": 1}, "off": {"p1": 0, "p2": 0}}
        game = Game.objects.create(board_state=board)
        self.assertEqual(game.board_state["bar"]["p1"], 2)

    # --- Winner field --------------------------------------------------------

    def test_winner_is_null_by_default(self):
        # Needs: winner = models.CharField(null=True, blank=True, ...)
        game = Game.objects.create()
        self.assertIsNone(game.winner)

    def test_winner_can_be_set_to_p1(self):
        game = Game.objects.create(status="finished", winner="p1")
        self.assertEqual(game.winner, "p1")

    def test_winner_can_be_set_to_p2(self):
        game = Game.objects.create(status="finished", winner="p2")
        self.assertEqual(game.winner, "p2")

    # --- Timestamp fields ----------------------------------------------------

    def test_game_has_created_at_field(self):
        # Needs: created_at = models.DateTimeField(auto_now_add=True)
        game = Game.objects.create()
        self.assertIsNotNone(game.created_at)

    def test_game_has_updated_at_field(self):
        # Needs: updated_at = models.DateTimeField(auto_now=True)
        game = Game.objects.create()
        self.assertIsNotNone(game.updated_at)

    def test_updated_at_changes_on_save(self):
        game = Game.objects.create()
        first = game.updated_at
        game.save()
        self.assertGreaterEqual(game.updated_at, first)

    # --- Ordering ------------------------------------------------------------

    def test_meta_ordering_is_by_created_at_descending(self):
        # Meta.ordering should be ["-created_at"] once the field exists.
        # Right now it's ["-pk"] as a placeholder — change it after adding the field.
        self.assertIn("-created_at", Game._meta.ordering)

    def test_newest_game_is_first_in_queryset(self):
        g1 = Game.objects.create()
        g2 = Game.objects.create()
        games = list(Game.objects.all())
        self.assertEqual(games[0].pk, g2.pk)
        self.assertEqual(games[1].pk, g1.pk)

    # --- __str__ -------------------------------------------------------------

    def test_str_includes_both_player_names(self):
        # The commented-out __str__ in models.py shows the target format.
        # Uncomment it once the name fields exist.
        game = Game.objects.create(player1_name="Alice", player2_name="Bob")
        self.assertIn("Alice", str(game))
        self.assertIn("Bob", str(game))
