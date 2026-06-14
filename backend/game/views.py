from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Game
from .serializers import GameSerializer
from .game_logic import (
    roll_dice,
    get_initial_board_state,
    get_legal_moves,
    apply_move,
    check_winner,
    opponent,
)


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

    def perform_create(self, serializer):
        """New games start active, with the standard starting position and p1 to move."""
        serializer.save(
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status="active",
        )

    @action(detail=True, methods=["post"], url_path="roll_dice")
    def roll_dice(self, request, pk=None):
        """
        Roll the dice for the current player's turn.

        If the resulting roll leaves the player with no legal moves at all,
        the turn passes immediately to the opponent.
        """
        game = self.get_object()

        if game.status != "active":
            return Response(
                {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
            )

        if game.dice_values:
            return Response(
                {"error": "Dice have already been rolled for this turn."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_dice = roll_dice()
        player = game.current_turn

        if get_legal_moves(game.board_state, player, new_dice):
            game.dice_values = new_dice
        else:
            game.dice_values = []
            game.current_turn = opponent(player)

        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="move_checker")
    def move_checker(self, request, pk=None):
        """
        Move a checker for the current player.

        Expected request body:
          { "from_point": int, "to_point": int }

        Points are 1-indexed (1-24). Use 0 for from_point to enter from the
        bar, and 25 for to_point to bear off.

        The move is validated against the current board state and remaining
        dice; illegal moves are rejected with a 400 response. After a legal
        move, the used die is consumed and, if no dice or legal moves remain,
        the turn passes to the opponent.
        """
        game = self.get_object()
        from_point = request.data.get("from_point")
        to_point = request.data.get("to_point")

        if from_point is None or to_point is None:
            return Response(
                {"error": "from_point and to_point are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if game.status != "active":
            return Response(
                {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
            )

        player = game.current_turn
        board = game.board_state
        dice = list(game.dice_values)

        legal_moves = get_legal_moves(board, player, dice)
        matches = [m for m in legal_moves if m[0] == from_point and m[1] == to_point]
        if not matches:
            return Response(
                {"error": "Illegal move."}, status=status.HTTP_400_BAD_REQUEST
            )

        die_used = matches[0][2]
        dice.remove(die_used)

        board = apply_move(board, player, from_point, to_point)
        game.board_state = board

        winner = check_winner(board)
        if winner:
            game.status = "finished"
            game.winner = winner
            game.dice_values = []
        elif not dice or not get_legal_moves(board, player, dice):
            game.current_turn = opponent(player)
            game.dice_values = []
        else:
            game.dice_values = dice

        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)
