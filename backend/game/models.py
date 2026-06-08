from django.db import models


class Game(models.Model):
    player1_name = models.CharField(max_length=200)
    player2_name = models.CharField(max_length=200)
    board_state = models.JSONField(default=dict)
    current_turn = models.CharField(max_length=100, choices=[("p1", "Player 1"), ("p2", "Player 2")])
    dice_values = models.JSONField(default=list)
    status = models.CharField(
        max_length=200,
        choices=[("waiting", "Waiting"), ("active", "Active"), ("finished", "Finished")],
        default="waiting",
    )
    winner = models.CharField(max_length=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self.status == "finished":
            self.winner = self.current_turn
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Game {self.pk}: {self.player1_name} vs {self.player2_name}"

    class Meta:
        ordering = ["-created_at"]
