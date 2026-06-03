from django.db import models


class Game(models.Model):
    # -------------------------------------------------------------------------
    # TODO: Define the fields for the Game model.
    #
    # Here's what a complete backgammon game needs to track:
    #
    #   player1_name  — CharField, the name of player 1 (white/light checkers)
    #   player2_name  — CharField, the name of player 2 (black/dark checkers)
    #
    #   board_state   — JSONField storing the 24 points + bar + off for each
    #                   player. One suggested shape:
    #                   {
    #                     "points": [int, ...],   # length 24, positive = p1,
    #                                             # negative = p2, 0 = empty
    #                     "bar":    {"p1": int, "p2": int},
    #                     "off":    {"p1": int, "p2": int},
    #                   }
    #                   Use default=dict so Django doesn't share a mutable default.
    #
    #   current_turn  — CharField with choices: ("p1", "Player 1") /
    #                   ("p2", "Player 2"). Whose turn is it?
    #
    #   dice_values   — JSONField: a list of ints representing the dice that
    #                   haven't been used yet this turn, e.g. [3, 5].
    #                   Doubles give four values: [4, 4, 4, 4].
    #
    #   status        — CharField with choices:
    #                     "waiting"  — created but second player hasn't joined
    #                     "active"   — game is in progress
    #                     "finished" — game is over
    #
    #   winner        — CharField, nullable/blank — filled in when status becomes
    #                   "finished". Store "p1" or "p2".
    #
    #   created_at    — DateTimeField(auto_now_add=True)
    #   updated_at    — DateTimeField(auto_now=True)
    # -------------------------------------------------------------------------

    def __str__(self):
        # Update this once player1_name and player2_name fields exist:
        # return f"Game {self.pk}: {self.player1_name} vs {self.player2_name}"
        return f"Game {self.pk}"

    class Meta:
        # TODO: change to ["-created_at"] once you add that field
        ordering = ["-pk"]
