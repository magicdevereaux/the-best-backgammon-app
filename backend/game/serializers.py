from django.contrib.auth.models import User
from django.db.models import Q
from rest_framework import serializers

from .models import Game


class GameSerializer(serializers.ModelSerializer):
    class Meta:
        model = Game
        fields = "__all__"
        read_only_fields = [
            "player1_user", "player2_user", "board_state", "current_turn",
            "dice_values", "status", "winner", "created_at", "updated_at",
        ]
        extra_kwargs = {
            "player1_name": {"required": False, "allow_blank": True},
            "player2_name": {"required": False, "allow_blank": True},
        }


class UserSerializer(serializers.ModelSerializer):
    wins = serializers.SerializerMethodField()
    losses = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "wins", "losses"]

    def get_wins(self, obj):
        return Game.objects.filter(
            Q(player1_user=obj, winner="p1") | Q(player2_user=obj, winner="p2")
        ).count()

    def get_losses(self, obj):
        return Game.objects.filter(
            Q(player1_user=obj, winner="p2") | Q(player2_user=obj, winner="p1")
        ).count()


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already taken.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)
