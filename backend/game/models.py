from django.contrib.auth.models import User
from django.db import models


class Match(models.Model):
    player1_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="matches_as_p1"
    )
    player2_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="matches_as_p2"
    )
    player1_name = models.CharField(max_length=200)
    player2_name = models.CharField(max_length=200, blank=True)
    target_points = models.PositiveIntegerField(default=5)
    player1_score = models.PositiveIntegerField(default=0)
    player2_score = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=[("active", "Active"), ("finished", "Finished")],
        default="active",
    )
    winner = models.CharField(max_length=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Match {self.pk}: {self.player1_name} vs {self.player2_name} (to {self.target_points})"

    class Meta:
        ordering = ["-created_at", "-id"]


class Game(models.Model):
    match = models.ForeignKey(
        Match, null=True, blank=True, on_delete=models.SET_NULL, related_name="games"
    )
    player1_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="games_as_p1"
    )
    player2_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="games_as_p2"
    )
    player1_name = models.CharField(max_length=200)
    player2_name = models.CharField(max_length=200, blank=True)
    board_state = models.JSONField(default=dict)
    current_turn = models.CharField(
        max_length=100, choices=[("p1", "Player 1"), ("p2", "Player 2")], default="p1"
    )
    dice_values = models.JSONField(default=list)
    status = models.CharField(
        max_length=200,
        choices=[("waiting", "Waiting"), ("active", "Active"), ("finished", "Finished")],
        default="waiting",
    )
    winner = models.CharField(max_length=2, null=True, blank=True)
    win_type = models.CharField(max_length=15, null=True, blank=True)
    points_value = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Game {self.pk}: {self.player1_name} vs {self.player2_name}"

    class Meta:
        ordering = ["-created_at", "-id"]
