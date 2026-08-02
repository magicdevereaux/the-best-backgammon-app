from django.contrib.auth import password_validation
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Sum
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers

from .models import Game, Match


def normalise_email(value):
    """
    Trim an address and lowercase its domain half.

    Django's ``BaseUserManager.normalize_email`` is deliberately conservative:
    the domain is case-insensitive per RFC 1034 so it is safe to fold, but the
    local part is *not*, and lowercasing it wholesale would silently rewrite
    addresses that some (rare, real) mail servers treat as distinct. Reset
    lookups therefore use ``email__iexact`` rather than relying on this to make
    stored values comparable.
    """
    return User.objects.normalize_email((value or "").strip())


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
        # player1_deleted / player2_deleted are exposed (via "__all__") so a
        # client can say "this player deleted their account" instead of leaving
        # the opponent staring at a turn that will never come — but they are
        # read-only, like every other server-owned field here. Writable, a
        # caller could close a seat at create time and grief the other player.
        read_only_fields = [
            "match", "player1_user", "player2_user", "board_state", "current_turn",
            "player1_deleted", "player2_deleted",
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
            "player1_deleted", "player2_deleted",
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
    # Optional, and writable via PATCH /api/auth/me/ — an address is the only
    # way to recover a forgotten password, but requiring one would lock out
    # every account registered before this field existed and would tax the
    # guest-friendly "pick a name, start playing" path this app is built around.
    email = serializers.EmailField(required=False, allow_blank=True)

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
            "id", "username", "email",
            "wins", "losses", "total_games",
            "total_gammons", "total_backgammons",
            "total_points_won", "total_points_lost",
            "win_percentage", "gammon_rate",
        ]
        # `email` is the *only* writable field. Username is identity here —
        # games and matches carry a denormalised copy of it in
        # player1_name/player2_name, so letting a PATCH rewrite it would put
        # the profile and every historical scoresheet out of step.
        read_only_fields = ["username"]

    def validate_email(self, value):
        return normalise_email(value)

    def _stats(self, obj):
        if not hasattr(obj, "_serializer_stats_cache"):
            # Abandoned games are excluded from every stat. They are finished
            # but were never played to a result: `abandon` deliberately awards
            # no winner and no points, so counting one would put it in the
            # survivor's *loss* column via `total - wins` — inventing exactly
            # the result the endpoint refuses to invent. Leaving it out of
            # `total` too keeps wins + losses == total_games, which is what
            # win_percentage assumes.
            p1 = Game.objects.filter(player1_user=obj, status="finished").exclude(
                win_type="abandoned"
            )
            p2 = Game.objects.filter(player2_user=obj, status="finished").exclude(
                win_type="abandoned"
            )

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


class AccountDeleteSerializer(serializers.Serializer):
    """
    Confirms an irreversible account deletion by re-checking the requester's
    own password.

    A bearer token proves only that *a session* is open — a borrowed laptop or
    a leaked access token would otherwise be enough to destroy an account and
    everything attached to it. Re-entering the password proves the *person*.
    This is also what the App Store / Play Store reviewers look for: the
    in-app deletion path must be deliberate, not a single stray tap.

    The requesting user comes from ``context["request"]``, never from the
    payload, so this serializer can only ever confirm deletion of the caller.
    """

    password = serializers.CharField(
        write_only=True, style={"input_type": "password"}
    )

    def validate_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Password is incorrect.")
        return value


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    # Optional on purpose: registration with username + password alone must keep
    # working byte-for-byte as it always has. Supplying an address is what buys
    # you password recovery — and, because account deletion re-checks the
    # password, self-service deletion after a forgotten one.
    #
    # Not unique-checked: Django's `User.email` has no unique constraint, and
    # adding one here would both need a migration and turn registration into an
    # "is this address already registered?" oracle. A shared address simply
    # means the reset flow mails every account that uses it.
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already taken.")
        return value

    def validate_email(self, value):
        return normalise_email(value)

    def validate(self, attrs):
        """
        Run Django's AUTH_PASSWORD_VALIDATORS. `create_user` does not call them,
        so without this the settings-level validators are dead configuration and
        the only rule is this serializer's own min_length=8 — "password" and
        "12345678" both registered fine.

        Validated here rather than in `validate_password` so the username is
        available: UserAttributeSimilarityValidator needs a user instance to
        reject passwords that echo the username. Django's error list is
        re-raised keyed on "password" so it surfaces as a normal DRF field
        error, matching the shape clients already handle.
        """
        password = attrs.get("password")
        if password:
            try:
                password_validation.validate_password(
                    password, user=User(username=attrs.get("username", ""))
                )
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class PasswordResetRequestSerializer(serializers.Serializer):
    """
    Input for ``POST /api/auth/password-reset/``.

    Validates the *shape* of the address and nothing else. Whether it matches
    an account is decided in the view, and never reflected in the response —
    see ``PasswordResetRequestView``.
    """

    email = serializers.EmailField()

    def validate_email(self, value):
        return normalise_email(value)


class PasswordResetConfirmSerializer(serializers.Serializer):
    """
    Input for ``POST /api/auth/password-reset/confirm/``.

    ``uid`` is the base64url-encoded user pk and ``token`` comes from Django's
    ``default_token_generator``. That generator hashes the user's current
    password hash and ``last_login`` into the token, which gives single-use
    semantics for free: the moment ``save()`` writes a new password, every
    token minted against the old one stops verifying. Nothing needs to be
    stored or expired by hand.

    A bad uid and a bad token are deliberately indistinguishable in the error
    response — either one means "this link is no good", and splitting them
    would let a caller probe which user ids exist.
    """

    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    @staticmethod
    def _user_from_uid(uid):
        try:
            pk = urlsafe_base64_decode(uid).decode()
            return User.objects.get(pk=pk)
        except (TypeError, ValueError, OverflowError, UnicodeDecodeError,
                User.DoesNotExist):
            return None

    def validate(self, attrs):
        """
        Check the link first, then the password.

        Order matters: validating the password against a link we are about to
        reject would hand an attacker free password-policy feedback on a token
        they do not hold. It also mirrors ``RegisterSerializer.validate`` —
        Django's ``AUTH_PASSWORD_VALIDATORS`` are run explicitly, with the real
        ``User`` instance so ``UserAttributeSimilarityValidator`` can reject a
        password that echoes the username, and the resulting messages are
        re-raised keyed on the field so clients see an ordinary DRF field error.
        """
        user = self._user_from_uid(attrs["uid"])
        if user is None or not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError(
                {"token": "This password reset link is invalid or has expired."}
            )

        try:
            password_validation.validate_password(attrs["new_password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})

        attrs["user"] = user
        return attrs

    def save(self, **kwargs):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user
