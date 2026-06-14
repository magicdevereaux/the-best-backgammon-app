import copy

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


def _apply_single_move(board, player, dice, from_point, to_point):
    """
    Validate (from_point, to_point) against the legal moves for `player` given
    `board`/`dice`, then apply it in place.

    Returns the updated dice list (with the consumed die removed). Raises
    ValueError("Illegal move.") if the move isn't legal.
    """
    legal_moves = get_legal_moves(board, player, dice)
    matches = [m for m in legal_moves if m[0] == from_point and m[1] == to_point]
    if not matches:
        raise ValueError("Illegal move.")

    die_used = matches[0][2]
    dice = list(dice)
    dice.remove(die_used)

    apply_move(board, player, from_point, to_point)
    return dice


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
      POST   /api/games/{id}/confirm_turn/
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

        The rolled values are always recorded, even if they leave the player
        with no legal moves at all. In that case the player sees the roll,
        finds no destinations highlighted, and calls confirm_turn with no
        moves to pass the turn to the opponent.
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

        game.dice_values = roll_dice()
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

        try:
            dice = _apply_single_move(board, player, dice, from_point, to_point)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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

    @action(detail=True, methods=["post"], url_path="confirm_turn")
    def confirm_turn(self, request, pk=None):
        """
        Commit a sequence of staged moves for the current player's turn and
        pass the turn to the opponent.

        Expected request body:
          { "moves": [{ "from_point": int, "to_point": int }, ...] }

        The moves are applied in order against the current board state and
        remaining dice, using the same validation as `move_checker`. If any
        move in the sequence is illegal, the whole request is rejected with a
        400 response and nothing is saved. On success, the turn always passes
        to the opponent (or the game finishes if the moves bear off a
        player's last checker), regardless of whether dice remain unused.
        """
        game = self.get_object()

        if game.status != "active":
            return Response(
                {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
            )

        if not game.dice_values:
            return Response(
                {"error": "No dice rolled for this turn."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        moves = request.data.get("moves", [])
        if not isinstance(moves, list):
            return Response(
                {"error": "moves must be a list."}, status=status.HTTP_400_BAD_REQUEST
            )

        player = game.current_turn
        board = copy.deepcopy(game.board_state)
        dice = list(game.dice_values)

        for move in moves:
            from_point = move.get("from_point")
            to_point = move.get("to_point")
            if from_point is None or to_point is None:
                return Response(
                    {"error": "Each move requires from_point and to_point."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                dice = _apply_single_move(board, player, dice, from_point, to_point)
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        game.board_state = board

        winner = check_winner(board)
        if winner:
            game.status = "finished"
            game.winner = winner
        else:
            game.current_turn = opponent(player)
        game.dice_values = []

        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)
