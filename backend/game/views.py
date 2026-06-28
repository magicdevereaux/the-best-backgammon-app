import copy

from rest_framework import generics, viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Game, Match
from .serializers import GameSerializer, MatchSerializer, RegisterSerializer, UserSerializer
from .game_logic import (
    roll_dice,
    get_initial_board_state,
    get_legal_moves,
    max_moves_usable,
    apply_move,
    check_winner,
    detect_win_type,
    win_points,
    opponent,
)


# ---------------------------------------------------------------------------
# Auth views
# ---------------------------------------------------------------------------

class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "user": UserSerializer(user).data,
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            },
            status=status.HTTP_201_CREATED,
        )


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


# ---------------------------------------------------------------------------
# Game helpers
# ---------------------------------------------------------------------------

def _apply_single_move(board, player, dice, from_point, to_point):
    """
    Validate and apply one move in place. Returns the updated dice list.
    Raises ValueError("Illegal move.") if the move isn't legal.
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


def _finish_game(game, board, winner):
    """
    Set finished-game fields and update the linked match's score.
    Does NOT call game.save() — the caller is responsible.
    """
    wtype = detect_win_type(board, winner)
    pts = win_points(wtype)

    game.status = "finished"
    game.winner = winner
    game.win_type = wtype
    game.points_value = pts
    game.dice_values = []

    if game.match_id:
        match = game.match
        if winner == "p1":
            match.player1_score += pts
            if match.player1_score >= match.target_points:
                match.status = "finished"
                match.winner = "p1"
        else:
            match.player2_score += pts
            if match.player2_score >= match.target_points:
                match.status = "finished"
                match.winner = "p2"
        match.save()


# ---------------------------------------------------------------------------
# Match viewset
# ---------------------------------------------------------------------------

class MatchViewSet(viewsets.ModelViewSet):
    serializer_class = MatchSerializer

    def get_queryset(self):
        return Match.objects.all()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user if request.user.is_authenticated else None
        player1_name = (
            serializer.validated_data.get("player1_name")
            or (user.username if user else "Player 1")
        )
        player2_name = serializer.validated_data.get("player2_name", "")

        target_points = serializer.validated_data.get("target_points", 5)
        if target_points not in (3, 5, 7, 9):
            return Response(
                {"error": "target_points must be 3, 5, 7, or 9."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match = serializer.save(
            player1_user=user,
            player1_name=player1_name,
            player2_name=player2_name,
        )

        # Create the first game of this match
        game_status = "active" if player2_name else "waiting"
        Game.objects.create(
            match=match,
            player1_user=match.player1_user,
            player2_user=match.player2_user,
            player1_name=match.player1_name,
            player2_name=match.player2_name,
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status=game_status,
        )

        return Response(self.get_serializer(match).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="next_game")
    def next_game(self, request, pk=None):
        """Start the next game in the match after the previous one has finished."""
        match = self.get_object()

        if match.status == "finished":
            return Response(
                {"error": "Match is already finished."}, status=status.HTTP_400_BAD_REQUEST
            )

        if match.games.filter(status__in=["active", "waiting"]).exists():
            return Response(
                {"error": "A game is already in progress."}, status=status.HTTP_400_BAD_REQUEST
            )

        last_game = match.games.filter(status="finished").first()
        next_turn = last_game.winner if last_game else "p1"

        game = Game.objects.create(
            match=match,
            player1_user=match.player1_user,
            player2_user=match.player2_user,
            player1_name=match.player1_name,
            player2_name=match.player2_name,
            board_state=get_initial_board_state(),
            current_turn=next_turn,
            dice_values=[],
            status="active",
        )

        return Response(GameSerializer(game).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="join")
    def join(self, request, pk=None):
        """Join a match as player 2 (for online match links)."""
        match = self.get_object()

        if match.player2_name:
            return Response(
                {"error": "Match already has two players."}, status=status.HTTP_400_BAD_REQUEST
            )

        user = request.user if request.user.is_authenticated else None
        player2_name = request.data.get("player2_name") or (user.username if user else None)

        if not player2_name:
            return Response(
                {"error": "player2_name is required for guest join."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.player2_user = user
        match.player2_name = player2_name
        match.save()

        waiting_game = match.games.filter(status="waiting").first()
        if waiting_game:
            waiting_game.player2_user = user
            waiting_game.player2_name = player2_name
            waiting_game.status = "active"
            waiting_game.save()

        return Response(self.get_serializer(match).data)


# ---------------------------------------------------------------------------
# Game viewset
# ---------------------------------------------------------------------------

class GameViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD for Game plus custom actions:
      POST /api/games/{id}/roll_dice/
      POST /api/games/{id}/move_checker/
      POST /api/games/{id}/confirm_turn/
      POST /api/games/{id}/join/
    """

    serializer_class = GameSerializer

    def get_queryset(self):
        qs = Game.objects.all()
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None

        player1_name = (
            serializer.validated_data.get("player1_name")
            or (user.username if user else "Player 1")
        )
        player2_name = serializer.validated_data.get("player2_name", "")

        # Hotseat / guest: both names provided → start immediately active.
        # Lobby: only player1 → start waiting for an opponent.
        game_status = "active" if player2_name else "waiting"

        serializer.save(
            player1_user=user,
            player1_name=player1_name,
            player2_name=player2_name,
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status=game_status,
        )

    @action(detail=True, methods=["post"], url_path="join")
    def join(self, request, pk=None):
        """
        Join an open (waiting) game as player 2.

        Authenticated users use their username automatically.
        Guests must supply { "player2_name": "..." }.
        """
        game = self.get_object()

        if game.status != "waiting":
            return Response(
                {"error": "Game is not open to join."}, status=status.HTTP_400_BAD_REQUEST
            )

        user = request.user if request.user.is_authenticated else None
        player2_name = request.data.get("player2_name") or (user.username if user else None)

        if not player2_name:
            return Response(
                {"error": "player2_name is required when joining as a guest."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        game.player2_user = user
        game.player2_name = player2_name
        game.status = "active"
        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)

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

        Expected body: { "from_point": int, "to_point": int }
        Points are 1-indexed (1-24); use 0 for bar entry, 25 for bear-off.
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
            _finish_game(game, board, winner)
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
        Commit a sequence of staged moves and pass the turn to the opponent.

        Expected body: { "moves": [{ "from_point": int, "to_point": int }, ...] }

        If any move is illegal the whole request is rejected and nothing is
        saved. The player must also use the maximum number of dice legally
        possible: if a longer legal sequence exists than the one staged, the
        confirmation is rejected (e.g. only one die played when both could be).
        On success the turn passes to the opponent (or the game finishes if the
        last checker is borne off).
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

        # Enforce maximal dice usage: the player must consume as many dice as is
        # legally possible. If a longer sequence exists than the one they staged,
        # reject the turn so they can't pass up a forced move. (game.board_state
        # is still the pre-turn position here — the loop mutated only `board`.)
        dice_used = len(game.dice_values) - len(dice)
        max_usable = max_moves_usable(game.board_state, player, list(game.dice_values))
        if dice_used < max_usable:
            return Response(
                {
                    "error": (
                        "You must use as many dice as possible. "
                        "A legal move remains for an unused die."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        game.board_state = board

        winner = check_winner(board)
        if winner:
            _finish_game(game, board, winner)
        else:
            game.current_turn = opponent(player)
            game.dice_values = []

        game.save()

        serializer = self.get_serializer(game)
        return Response(serializer.data)
