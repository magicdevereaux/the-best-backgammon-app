from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Game
from .serializers import GameSerializer


class GameViewSet(viewsets.ModelViewSet):
    """
    Provides standard CRUD endpoints for Game:
      GET    /api/games/         — list all games
      POST   /api/games/         — create a new game
      GET    /api/games/{id}/    — retrieve a single game
      PUT    /api/games/{id}/    — full update
      PATCH  /api/games/{id}/    — partial update
      DELETE /api/games/{id}/    — delete

    Custom actions are wired below and live at:
      POST   /api/games/{id}/roll_dice/
      POST   /api/games/{id}/move_checker/
    """

    queryset = Game.objects.all()
    serializer_class = GameSerializer

    @action(detail=True, methods=["post"], url_path="roll_dice")
    def roll_dice(self, request, pk=None):
        """
        Roll the dice for the current player's turn.
        Calls game_logic.roll_dice() and saves the result to the game.
        Returns the updated game object.
        """
        game = self.get_object()

        from .game_logic import roll_dice
        new_dice = roll_dice()

        # TODO (stretch): validate that it's actually this player's turn
        #                 and that the previous dice have been used up.
        game.dice_values = new_dice
        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="move_checker")
    def move_checker(self, request, pk=None):
        """
        Move a checker for the current player.

        Expected request body:
          { "from_point": int, "to_point": int }

        Points are 1-indexed (1–24). Use 0 for the bar, 25 for bearing off.

        TODO (stretch): Validate the move against board_state and dice_values,
                        apply the move, flip current_turn, and check for a winner.
        """
        game = self.get_object()
        from_point = request.data.get("from_point")
        to_point = request.data.get("to_point")

        if from_point is None or to_point is None:
            return Response(
                {"error": "from_point and to_point are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # TODO: implement move validation and board mutation here

        serializer = self.get_serializer(game)
        return Response(serializer.data)
