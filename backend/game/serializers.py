from rest_framework import serializers
from .models import Game


class GameSerializer(serializers.ModelSerializer):
    # -------------------------------------------------------------------------
    # TODO: Implement the serializer.
    #
    # A ModelSerializer needs a Meta inner class that specifies:
    #   model  — the model class to serialize (Game)
    #   fields — either "__all__" or an explicit list of field names
    #
    # Once the Game model has fields, "__all__" is fine to start with.
    # Later you may want to make board_state and dice_values read-only so
    # clients can't directly overwrite game state without going through
    # validated game logic.
    #
    # Example shape of the expected JSON response for a single game:
    # {
    #   "id": 1,
    #   "player1_name": "Alice",
    #   "player2_name": "Bob",
    #   "status": "active",
    #   "current_turn": "p1",
    #   "dice_values": [3, 5],
    #   "board_state": { ... },
    #   "winner": null,
    #   "created_at": "2026-06-02T00:00:00Z",
    #   "updated_at": "2026-06-02T00:01:00Z"
    # }
    # -------------------------------------------------------------------------
    pass
