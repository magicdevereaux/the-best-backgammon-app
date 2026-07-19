from django.contrib.auth.models import User
from django.db.models import Sum
from rest_framework import serializers

from .models import Game, Match


class GameSerializer(serializers.ModelSerializer):
    # Which seat(s) the *requesting* authenticated user owns in this game:
    # "p1", "p2", "p1p2", or null (guest / not a participant). This is an
    # authoritative, server-side ownership signal the client uses to gate turns
    # even on a fresh device with no local seat record (e.g. a deep link opened
    # for the first time). Guests have no server identity, so it's null for them
    # and the client falls back to its device-local seat registry.
    viewer_seat = serializers.SerializerMethodField()
    viewer_is_participant = serializers.SerializerMethodField()

    class Meta:
        model = Game
        fields = "__all__"
        read_only_fields = [
            "match", "player1_user", "player2_user", "board_state", "current_turn",
            "dice_values", "status", "winner", "win_type", "points_value",
            "cube_value", "cube_owner", "double_offered_by", "crawford_game",
            "created_at", "updated_at",
        ]
        extra_kwargs = {
            "player1_name": {"required": False, "allow_blank": True},
            "player2_name": {"required": False, "allow_blank": True},
        }

    def get_viewer_seat(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        seats = []
        if obj.player1_user_id == user.id:
            seats.append("p1")
        if obj.player2_user_id == user.id:
            seats.append("p2")
        if not seats:
            return None
        return "p1p2" if len(seats) == 2 else seats[0]

    def get_viewer_is_participant(self, obj):
        return self.get_viewer_seat(obj) is not None


class MatchSerializer(serializers.ModelSerializer):
    current_game_id = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = "__all__"
        read_only_fields = [
            "player1_user", "player2_user", "player1_score", "player2_score",
            "status", "winner", "created_at", "updated_at",
        ]
        extra_kwargs = {
            "player1_name": {"required": False, "allow_blank": True},
            "player2_name": {"required": False, "allow_blank": True},
        }

    def get_current_game_id(self, obj):
        game = obj.games.filter(status="active").first()
        if game:
            return game.id
        game = obj.games.first()
        return game.id if game else None


class UserSerializer(serializers.ModelSerializer):
    wins = serializers.SerializerMethodField()
    losses = serializers.SerializerMethodField()
    total_games = serializers.SerializerMethodField()
    total_gammons = serializers.SerializerMethodField()
    total_backgammons = serializers.SerializerMethodField()
    total_points_won = serializers.SerializerMethodField()
    total_points_lost = serializers.SerializerMethodField()
    win_percentage = serializers.SerializerMethodField()
    gammon_rate = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username",
            "wins", "losses", "total_games",
            "total_gammons", "total_backgammons",
            "total_points_won", "total_points_lost",
            "win_percentage", "gammon_rate",
        ]

    def _stats(self, obj):
        if not hasattr(obj, "_serializer_stats_cache"):
            p1 = Game.objects.filter(player1_user=obj, status="finished")
            p2 = Game.objects.filter(player2_user=obj, status="finished")

            total = p1.count() + p2.count()

            wins = (p1.filter(winner="p1").count() + p2.filter(winner="p2").count())
            losses = total - wins

            gammons = (
                p1.filter(winner="p1", win_type="gammon").count()
                + p2.filter(winner="p2", win_type="gammon").count()
            )
            backgammons = (
                p1.filter(winner="p1", win_type="backgammon").count()
                + p2.filter(winner="p2", win_type="backgammon").count()
            )

            pts_won = (
                (p1.filter(winner="p1").aggregate(s=Sum("points_value"))["s"] or 0)
                + (p2.filter(winner="p2").aggregate(s=Sum("points_value"))["s"] or 0)
            )
            pts_lost = (
                (p1.filter(winner="p2").aggregate(s=Sum("points_value"))["s"] or 0)
                + (p2.filter(winner="p1").aggregate(s=Sum("points_value"))["s"] or 0)
            )

            obj._serializer_stats_cache = {
                "wins": wins,
                "losses": losses,
                "total_games": total,
                "total_gammons": gammons,
                "total_backgammons": backgammons,
                "total_points_won": pts_won,
                "total_points_lost": pts_lost,
                "win_percentage": round(100 * wins / total, 1) if total else 0.0,
                "gammon_rate": round(100 * gammons / wins, 1) if wins else 0.0,
            }
        return obj._serializer_stats_cache

    def get_wins(self, obj):
        return self._stats(obj)["wins"]

    def get_losses(self, obj):
        return self._stats(obj)["losses"]

    def get_total_games(self, obj):
        return self._stats(obj)["total_games"]

    def get_total_gammons(self, obj):
        return self._stats(obj)["total_gammons"]

    def get_total_backgammons(self, obj):
        return self._stats(obj)["total_backgammons"]

    def get_total_points_won(self, obj):
        return self._stats(obj)["total_points_won"]

    def get_total_points_lost(self, obj):
        return self._stats(obj)["total_points_lost"]

    def get_win_percentage(self, obj):
        return self._stats(obj)["win_percentage"]

    def get_gammon_rate(self, obj):
        return self._stats(obj)["gammon_rate"]


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already taken.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)
