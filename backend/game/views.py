import copy
import logging

from django.conf import settings
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, mixins, viewsets, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import Game, Match
from .serializers import (
    AccountDeleteSerializer,
    GameSerializer,
    MatchSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .game_logic import (
    roll_dice,
    get_initial_board_state,
    get_legal_moves,
    max_moves_usable,
    higher_die_required_moves,
    apply_move,
    check_winner,
    detect_win_type,
    win_points,
    opponent,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared infrastructure: pagination + throttling
# ---------------------------------------------------------------------------

class BareListPagination(PageNumberPagination):
    """
    Bounds every list response to a fixed page size while still returning a
    **bare JSON array**, not DRF's ``{count, next, previous, results}`` envelope.

    The envelope is deliberately avoided: both clients consume these endpoints
    as arrays. ``frontend/src/pages/LobbyPage.jsx`` does
    ``fetchLobby().then(setOpenGames)`` and maps over the result (an envelope
    would throw ``.map is not a function``), and ``mobile/app/index.jsx``
    discards anything failing ``Array.isArray`` (an envelope would silently
    render an empty lobby). Paginating without reshaping fixes the unbounded
    response without requiring a client change.

    Later pages are reachable with ``?page=N``; ``?page_size=`` may lower or
    raise the size up to ``max_page_size``.
    """

    page_size = 100
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data):
        return Response(data)


class OptionalScopedRateThrottle(ScopedRateThrottle):
    """
    ``ScopedRateThrottle`` that reads its rate from ``api_settings`` live and
    treats a missing scope as "unthrottled" instead of an error.

    Two reasons not to use the stock class:

    1. Stock ``get_rate`` raises ``ImproperlyConfigured`` (a 500) for a scope
       absent from ``DEFAULT_THROTTLE_RATES``, so a settings typo or a dropped
       key becomes a total login/registration outage. Missing rate should fail
       the same way as having no throttle attached: allow the request.
    2. ``SimpleRateThrottle.THROTTLE_RATES`` is a *class* attribute bound to the
       rates dict at import time, so ``@override_settings(REST_FRAMEWORK=...)``
       silently has no effect on it. Reading ``api_settings`` per call makes the
       rates overridable, which is what lets the throttle tests run at all.
    """

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(getattr(self, "scope", None))


class RowLockingMixin:
    """
    Gives a viewset ``_locked_object()`` — the detail action's target row,
    re-read with ``SELECT … FOR UPDATE``.

    **Why every mutating action needs it.** Each one is a read-modify-write:
    read the game, check some guards against it, compute a new board/score,
    write the whole row back with ``save()``. Two requests that read before
    either writes both pass the guards, and the second ``save()`` overwrites
    the first — a double-tapped Confirm, a retried POST or two browser tabs is
    all it takes. SQLite made this *narrow* rather than impossible: it
    serializes writers, but readers run concurrently, so the read-then-write
    gap is real there too. Postgres with several gunicorn workers widens it to
    the whole request.

    The shape is the same everywhere::

        with transaction.atomic():
            obj = self._locked_object()
            ...guards, mutation, save...

    Note the guards run **after** the lock, against the freshly-read row. A
    guard evaluated before the lock proves nothing — the row can change between
    the check and the write, which is exactly the bug. Locking first also means
    the existing guards need no re-ordering: they simply become the recheck.

    ``get_object()`` still runs first, so 404 / lookup behaviour is unchanged;
    the second query re-reads that same row under the lock. ``select_for_update``
    is a no-op on SQLite (``has_select_for_update`` is False, and the whole
    database takes one write lock anyway), so this costs dev and the test suite
    one extra primary-key SELECT and nothing else.
    """

    def _locked_object(self):
        obj = self.get_object()
        return self.get_queryset().model.objects.select_for_update().get(pk=obj.pk)


# ---------------------------------------------------------------------------
# Auth views
# ---------------------------------------------------------------------------

class LoginView(TokenObtainPairView):
    """
    SimpleJWT's token endpoint with a scoped rate limit. Unlimited attempts on
    an internet-facing login is open credential stuffing; the "login" rate is
    configured in ``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]``.
    """

    throttle_classes = [OptionalScopedRateThrottle]
    throttle_scope = "login"


class RefreshView(TokenRefreshView):
    """
    SimpleJWT's refresh endpoint with a scoped rate limit.

    Unthrottled, a single stolen refresh token can be spun indefinitely — and
    with ``ROTATE_REFRESH_TOKENS`` on, each spin mints a brand-new token, so
    there is no natural stopping point. The ``refresh`` rate is deliberately
    much looser than ``login``: both clients call this automatically whenever an
    access token 401s, so the limit has to sit well above legitimate use.
    """

    throttle_classes = [OptionalScopedRateThrottle]
    throttle_scope = "refresh"


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    throttle_classes = [OptionalScopedRateThrottle]
    throttle_scope = "register"

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


def _blacklist_refresh_tokens(user):
    """
    Blacklist every outstanding refresh token issued to `user`.

    Access tokens die on their own the moment the row disappears:
    ``JWTAuthentication`` resolves the token's ``user_id`` against the database
    and 401s when there is no such user. Refresh tokens do **not** — SimpleJWT's
    ``TokenRefreshSerializer`` mints a new access token straight from the
    refresh payload without ever touching the user table, so an un-blacklisted
    refresh token would keep returning 200s after the account is gone.

    This survives the deletion because ``OutstandingToken.user`` is
    ``on_delete=SET_NULL`` (see the token_blacklist app's models): the row is
    orphaned rather than cascaded away, and the ``BlacklistedToken`` pointing at
    it — which is what ``RefreshToken.verify()`` actually consults — stays put.
    Call this *before* ``user.delete()``; afterwards the tokens are no longer
    reachable by user.
    """
    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)


def _purge_unjoined_lobby_entries(user):
    """
    Remove the deleted account's *unstarted* public listings.

    A "waiting" game is a lobby advert nobody has joined yet, so deleting it
    destroys no one's history — and leaving it would keep a deleted account's
    username on the unauthenticated ``GET /api/games/?status=waiting`` list
    forever, attached to a seat that can never be played. The same goes for a
    match whose second seat was never filled.

    Everything else is deliberately left alone: see ``AccountDeleteView``.
    """
    Game.objects.filter(player1_user=user, status="waiting").delete()
    Match.objects.filter(player1_user=user, player2_name="").delete()


def _close_deleted_account_seats(user):
    """
    Flag every seat this account holds as **closed** before the FK is nulled.

    ``on_delete=SET_NULL`` anonymises a seat rather than destroying it, which
    is what preserves the opponent's history — but it also makes the seat
    indistinguishable from a *guest* seat, and guest seats are deliberately
    playable by anonymous callers (there is no identity to verify). Without a
    marker, deleting your account hands your live games to whoever finds the
    id: ``_seat_permission_error`` would read the null FK as "guest, allow".

    The flags are the missing bit of state: null FK **+ flag** means "a
    registered player was here and is gone", which both permission helpers
    treat as closed to everyone. Genuine guest seats keep their flag False and
    behave exactly as before.

    Must run *before* ``user.delete()`` — afterwards the rows are no longer
    reachable by user.
    """
    Game.objects.filter(player1_user=user).update(player1_deleted=True)
    Game.objects.filter(player2_user=user).update(player2_deleted=True)
    Match.objects.filter(player1_user=user).update(player1_deleted=True)
    Match.objects.filter(player2_user=user).update(player2_deleted=True)


class MeView(generics.RetrieveUpdateDestroyAPIView):
    """
    ``GET /api/auth/me/``    — the current user's profile + computed stats.
    ``PATCH /api/auth/me/``  — set or change the current user's email address.
    ``DELETE /api/auth/me/`` — permanently delete the current user's account.

    **Why PATCH lives here.** Email is optional at registration, so an account
    created before this field existed — or by someone who skipped it — needs a
    way to add one later, otherwise password reset is permanently out of reach
    for exactly the users who need it. ``UserSerializer`` marks every field but
    ``email`` read-only, so this cannot become a general profile-rewrite hole.

    Deletion is hung off the existing "me" resource rather than a new
    ``/api/auth/delete-account/`` route for three reasons: it is the plain REST
    spelling of "destroy this resource", it adds no new URL surface, and
    ``get_object`` already pins the target to ``request.user`` so the endpoint
    is structurally incapable of naming someone else's account. The confirming
    password travels in the DELETE body — legal HTTP, and accepted verbatim by
    ``fetch`` on both clients.

    **What happens to the account's games.** Nothing is cascaded. Every user FK
    on ``Game`` and ``Match`` is ``on_delete=SET_NULL`` while the seat's display
    name is a plain ``CharField``, so ``user.delete()`` *anonymises* each seat:
    the FK goes null, ``player1_name``/``player2_name``, board, winner, score and
    match history all survive intact. An opponent keeps their full record and
    their stats are unchanged, and ``GameSerializer.get_viewer_seat`` already
    handles a null seat FK (it compares ``player*_user_id`` to the viewer's id),
    so nothing downstream breaks. The only records removed are unjoined lobby
    adverts — see ``_purge_unjoined_lobby_entries``.

    Anonymising a seat would, on its own, make it look like a *guest* seat and
    therefore open it to anonymous play, so each surviving seat is also flagged
    closed — see ``_close_deleted_account_seats``.
    """

    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "DELETE":
            return AccountDeleteSerializer
        return UserSerializer

    def get_object(self):
        return self.request.user

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # One transaction for the four writes. They are not independent: the
        # seat flags are the only thing keeping an orphaned seat from reading
        # as an anonymously-playable guest seat, so a deletion that committed
        # `user.delete()` without them would silently open every game this
        # account was in. All four land, or none do.
        with transaction.atomic():
            _blacklist_refresh_tokens(user)
            _purge_unjoined_lobby_entries(user)
            _close_deleted_account_seats(user)
            user.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

# One fixed sentence, returned for a hit and a miss alike. See
# PasswordResetRequestView for why it can never vary.
PASSWORD_RESET_REQUEST_DETAIL = (
    "If an account with that email address exists, a password reset link has "
    "been sent to it."
)


def build_password_reset_url(user):
    """
    The link that goes in the email.

    Shape: ``{FRONTEND_BASE_URL}/reset-password/{uid}/{token}``.

    The server cannot know where the client is served from — web is a separate
    origin and mobile is a deep link — so the origin comes from the
    ``FRONTEND_BASE_URL`` setting (defaulting to the React dev server). The uid
    and token are path segments rather than a query string so a client router
    can bind them as ordinary route params.
    """
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{settings.FRONTEND_BASE_URL}/reset-password/{uid}/{token}"


def send_password_reset_email(user):
    """
    Mail one account its reset link. Never raises.

    Swallowing send failures is a security requirement, not laziness: if a dead
    SMTP host turned this request into a 500 while a miss stayed a 200, the
    status code itself would become the account-enumeration oracle the flat
    response text is designed to prevent. The failure is logged instead.
    """
    try:
        send_mail(
            subject="Reset your Backgammon password",
            message=(
                f"Hi {user.username},\n\n"
                "Someone asked to reset the password on your Backgammon "
                "account. Open the link below to choose a new one:\n\n"
                f"{build_password_reset_url(user)}\n\n"
                "If that wasn't you, you can ignore this email — your password "
                "will not change until the link is used.\n"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:  # pragma: no cover - depends on a live mail backend
        logger.exception("Failed to send password reset email to user %s", user.pk)


class PasswordResetRequestView(generics.GenericAPIView):
    """
    ``POST /api/auth/password-reset/`` — ``{"email": "..."}``.

    **Always 200, always the same body**, whether or not the address is
    registered. A response that differed turns this unauthenticated endpoint
    into a membership oracle: feed it a list of addresses and it tells you which
    of them have accounts here. The throttle (scope ``password_reset``) caps
    how fast that could be probed by timing instead.

    Django's HTML ``PasswordResetView`` is deliberately not used — this project
    has no session login, no templates and no server-rendered pages, so the
    HTML flow would be a second, unreachable auth surface.

    Multiple accounts may share an address (``User.email`` is not unique); each
    one gets its own mail with its own token.
    """

    serializer_class = PasswordResetRequestSerializer
    throttle_classes = [OptionalScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # `email__iexact` because only the domain half is normalised on write;
        # `is_active` because a disabled account should not be recoverable.
        # An empty address can't reach here — EmailField rejects blanks — which
        # matters, since it would otherwise match every account that never set
        # one.
        for user in User.objects.filter(email__iexact=email, is_active=True):
            send_password_reset_email(user)

        return Response(
            {"detail": PASSWORD_RESET_REQUEST_DETAIL}, status=status.HTTP_200_OK
        )


class PasswordResetConfirmView(generics.GenericAPIView):
    """
    ``POST /api/auth/password-reset/confirm/`` —
    ``{"uid": "...", "token": "...", "new_password": "..."}``.

    On success the account's outstanding refresh tokens are blacklisted. A
    reset is usually a response to a compromise, and without this the attacker's
    existing session survives the very act meant to end it — SimpleJWT mints
    access tokens straight from a refresh payload without consulting the
    password. The legitimate user simply logs in again with their new password.
    """

    serializer_class = PasswordResetConfirmSerializer
    throttle_classes = [OptionalScopedRateThrottle]
    throttle_scope = "password_reset_confirm"

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        _blacklist_refresh_tokens(user)
        return Response(
            {"detail": "Your password has been reset. You can now log in."},
            status=status.HTTP_200_OK,
        )


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

    # A bear-off (to_point 25) can match more than one die (exact + oversized).
    # get_legal_moves returns a set, so pick deterministically: consume the
    # smallest matching die, keeping larger dice available for later oversized
    # bear-offs.
    die_used = min(m[2] for m in matches)
    dice = list(dice)
    dice.remove(die_used)

    apply_move(board, player, from_point, to_point)
    return dice


def _seat_permission_error(game, user, seat=None):
    """
    Server-side seat/turn enforcement for gameplay actions (roll_dice,
    confirm_turn, cube actions). Returns an error message if the
    requester may not act for `seat` (default: game.current_turn — the seat a
    double responder acts for is passed explicitly), or None if allowed.

    Seat identity is only as strong as the player user FKs: a seat with a null
    FK belongs to a guest, who has no server identity to verify. Policy:

      - Seat owned by a registered user → only that user may act. The other
        participant gets "not your turn"; anyone else isn't a participant.
      - **Closed seat** (``player*_deleted``) → nobody may act, ever. The FK is
        null because the owner deleted their account, not because a guest sat
        there; without this branch the seat would fall through to the guest
        rule below and become anonymously playable by anyone holding the game
        id. The surviving opponent is refused too — they satisfy
        ``is_participant`` on the orphaned seat and would otherwise be able to
        play both sides of the board.
      - Guest (unowned) seat → anonymous requests and this game's registered
        participants may act (participants cover hotseat games, where one
        account plays both seats on one device). Other logged-in accounts are
        rejected: they are identifiable and provably not this game's guest.
      - Fully-guest games (no FKs at all) are therefore unrestricted — there is
        nothing to verify against.
    """
    if seat is None:
        seat = game.current_turn
    seat_user_id = game.player1_user_id if seat == "p1" else game.player2_user_id
    seat_closed = game.player1_deleted if seat == "p1" else game.player2_deleted
    user_id = user.id if user is not None and user.is_authenticated else None
    is_participant = user_id is not None and user_id in (
        game.player1_user_id,
        game.player2_user_id,
    )

    if seat_closed and seat_user_id is None:
        return "This player deleted their account — their seat is closed."

    if seat_user_id is not None:
        if user_id == seat_user_id:
            return None
        if is_participant:
            return "It's not your turn."
        if user_id is not None:
            return "You are not a participant in this game."
        return "This seat belongs to a registered player. Log in as them to play it."

    if user_id is None or is_participant:
        return None
    return "You are not a participant in this game."


def _match_permission_error(match, user):
    """
    Participant check for match-level actions (next_game). Returns an error
    message if the requester may not act on this match, or None if allowed.

    A match-level action isn't tied to one seat, so the rule is the natural
    lift of _seat_permission_error: the requester is allowed if they could act
    for *either* seat. Concretely, and consistently with the gameplay actions:

      - A registered participant (owns either seat) may act.
      - Any other logged-in account is identifiable and provably not a player →
        rejected.
      - An anonymous requester is allowed only when at least one seat is a
        guest seat (null user FK). Guest seats carry no server identity to
        verify, so this is the same unverifiable-but-allowed hole the gameplay
        actions already accept, and it is what keeps hotseat/guest matches
        playable without an account. A match whose seats are *both* registered
        has no guest to impersonate, so anonymous callers are rejected.
      - A **closed** seat (``player*_deleted``: the owner deleted their
        account) does not count as a guest seat, even though its FK is null.
        Otherwise deleting an account would silently open every match you were
        in to anonymous callers. The surviving registered opponent still
        qualifies on their own seat.
    """
    user_id = user.id if user is not None and user.is_authenticated else None
    seat_user_ids = (match.player1_user_id, match.player2_user_id)
    seat_closed = (match.player1_deleted, match.player2_deleted)

    if user_id is not None:
        if user_id in seat_user_ids:
            return None
        return "You are not a participant in this match."

    if any(
        seat_user_id is None and not closed
        for seat_user_id, closed in zip(seat_user_ids, seat_closed)
    ):
        return None
    return "This match belongs to registered players. Log in to continue it."


def _list_scope_q(user):
    """
    The rows ``GET /api/games/`` may show `user` (anonymous or not).

    The list used to be ``Game.objects.all()`` on an ``AllowAny`` view with a
    ``fields = "__all__"`` serializer, so an anonymous caller could page through
    every row in the table: live board states, both usernames, both user ids.
    Scoping it to the *requester* fixes that. Three disjunctive rules, unioned:

      1. **Open games** (``status="waiting"``) with neither seat closed — this
         is the public lobby. Its whole purpose is to advertise a seat to
         strangers, so it stays visible to everyone. A deleted account's
         unjoined adverts are already removed outright (see
         ``_purge_unjoined_lobby_entries``), so the closure check here is
         belt-and-braces: it means the lobby cannot advertise an unjoinable
         seat even if a closed-seat row ever survives that purge.
      2. **Your own games** — either seat's user FK is the requester. Registered
         players get their full history back regardless of status. Anonymous
         requesters have no identity, so this rule contributes nothing for them.
      3. **Fully-guest games** — *both* seat FKs null and *neither* seat closed.
         Guest/hotseat resume depends on finding your game in the list with no
         account to scope by, and such a row carries no PII: no usernames tied to
         accounts, no user ids. Requiring both ``player*_deleted`` False keeps a
         seat orphaned by account deletion (null FK + flag) out of this rule —
         the same distinction ``_seat_permission_error`` draws.

    Scoping applies to ``list`` only. ``retrieve`` by id stays open to everyone
    because link/code sharing is how online games are joined at all.

    Note the deliberate consequence for a *mixed* game (one guest seat, one
    registered seat) past the waiting stage: the guest can no longer find it in
    the list and needs the id/link. Nothing else can be done without a guest
    identity — see "Guest seats are unverifiable" in the root ``CLAUDE.md``.
    """
    scope = Q(status="waiting", player1_deleted=False, player2_deleted=False) | Q(
        player1_user__isnull=True,
        player2_user__isnull=True,
        player1_deleted=False,
        player2_deleted=False,
    )
    if user is not None and user.is_authenticated:
        scope |= Q(player1_user=user) | Q(player2_user=user)
    return scope


def _match_list_scope_q(user):
    """
    The rows ``GET /api/matches/`` may show `user` (anonymous or not).

    Same bug and same fix as ``_list_scope_q``: the list was
    ``Match.objects.all()`` on an ``AllowAny`` view whose serializer exposes
    both seat user ids and both display names, so an anonymous caller could
    page the whole match table. The rule is the *match* analogue of the games
    rule, and it is deliberately one clause shorter:

      1. **Fully-guest matches** — *both* seat FKs null and *neither* seat
         closed. Guest/hotseat resume depends on finding your match with no
         account to scope by, and such a row carries no PII: no user ids, no
         names tied to accounts. Requiring both ``player*_deleted`` False keeps
         a seat orphaned by account deletion (null FK + flag) out of this rule,
         exactly as ``_list_scope_q`` and ``_match_permission_error`` do.
      2. **Your own matches** — either seat's user FK is the requester,
         whichever seat and whatever the status, so registered players keep
         their full match history. Anonymous requesters have no identity, so
         this rule contributes nothing for them.

    **There is no public-lobby clause, because a match has no lobby state.**
    ``Game.status`` has a ``"waiting"`` value whose entire purpose is to
    advertise an open seat to strangers; ``Match.status`` is only
    ``active``/``finished`` (see ``Match`` in models.py) and has no such value.
    Joinability is instead implied by an empty ``player2_name``, and open
    matches are advertised through their *first game*, which sits in the
    ``waiting`` lobby carrying a ``match`` id — so the lobby already works
    without listing matches at all. Inventing a "player2_name is blank" clause
    here would re-expose exactly the registered-player rows this fix is closing,
    for no flow that needs them.

    Scoping applies to ``list`` only. ``retrieve`` by id stays open to everyone,
    just as it does for games: link/code sharing is how an online match is
    joined and resumed, and both clients fetch a match by id. This bounds
    *enumeration* of the table, not access to a match you have the id for.
    """
    scope = Q(
        player1_user__isnull=True,
        player2_user__isnull=True,
        player1_deleted=False,
        player2_deleted=False,
    )
    if user is not None and user.is_authenticated:
        scope |= Q(player1_user=user) | Q(player2_user=user)
    return scope


def _finish_game(game, board, winner):
    """
    Finish a game won on the board: classify the win from the final position
    and award win_points × the doubling-cube value.
    Does NOT call game.save() — the caller is responsible.
    """
    wtype = detect_win_type(board, winner)
    _apply_game_result(game, winner, wtype, win_points(wtype) * game.cube_value)


def _apply_game_result(game, winner, win_type, points):
    """
    Set finished-game fields and update the linked match's score. Shared by
    board wins (_finish_game) and doubling-cube drops, where the game ends by
    concession with no board-derived win type.
    Does NOT call game.save() — the caller is responsible.

    **Must be called from inside the caller's transaction, with the game row
    already locked** (confirm_turn and respond_to_double both do). The score
    update below is a read-modify-write and ``match.save()`` rewrites every
    column, so the match row is locked here too — see the comment on that line.
    The helper deliberately opens no ``atomic()`` of its own: a nested block
    would only add a pointless savepoint, and a helper that locked outside its
    caller's transaction would be a deadlock source.
    """
    pts = points

    game.status = "finished"
    game.winner = winner
    game.win_type = win_type
    game.points_value = pts
    game.dice_values = []
    game.double_offered_by = None

    if game.match_id:
        # Locked, not `game.match`: the score is incremented in Python and
        # written back as a whole row, so a concurrent writer on the same match
        # (a sibling game's abandon, a second confirm) could otherwise resurrect
        # a stale score. Lock order is game → match, matching `abandon`; the
        # only action that takes the match lock first is `next_game`, which
        # never goes on to lock a game row, so the two cannot deadlock.
        match = Match.objects.select_for_update().get(pk=game.match_id)
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

class MatchViewSet(
    RowLockingMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    List / retrieve / create only, plus the custom actions:
      POST /api/matches/{id}/next_game/
      POST /api/matches/{id}/join/

    Deliberately **not** a ModelViewSet: PUT/PATCH/DELETE were routed with no
    permission check at all, letting anyone rewrite a score or delete a match.
    Nothing in either client uses them, so they are off the routed surface
    entirely (405) rather than guarded.

    ``list`` is scoped to the requester by ``_match_list_scope_q``; ``retrieve``
    and the detail actions deliberately are not (sharing a match by id/link is
    how an online match is joined and resumed).
    """

    serializer_class = MatchSerializer
    pagination_class = BareListPagination

    def get_queryset(self):
        qs = Match.objects.all()
        if self.action == "list":
            qs = qs.filter(_match_list_scope_q(self.request.user))
        return qs

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

        # Two inserts, one transaction: a match whose first game failed to
        # write would be permanently unplayable (next_game refuses to run on a
        # match that has never had a finished game) and would sit in the lobby
        # advertising nothing.
        with transaction.atomic():
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
        """
        Start the next game in the match after the previous one has finished.

        The riskiest action in the app to run twice: unlike the gameplay
        actions, whose damage is a lost update, a raced ``next_game`` *inserts*
        a second game and there is no unique constraint to stop it. A match
        with two active games is permanently broken — every later ``next_game``
        then trips the in-progress guard, and both clients fetch "the" current
        game and disagree about which one it is. So the match row is locked for
        the whole action and the "a game is already in progress" guard is
        evaluated under that lock: the second of two simultaneous submissions
        blocks on the lock, then reads the game the first one just inserted and
        is refused with the ordinary 400. Nothing about the responses changes —
        the guard simply stops being skippable.
        """
        with transaction.atomic():
            match = self._locked_object()

            perm_error = _match_permission_error(match, request.user)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            if match.status == "finished":
                return Response(
                    {"error": "Match is already finished."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Re-checked under the lock — this is the duplicate-game guard.
            if match.games.filter(status__in=["active", "waiting"]).exists():
                return Response(
                    {"error": "A game is already in progress."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            last_game = match.games.filter(status="finished").first()
            next_turn = last_game.winner if last_game else "p1"

            # Crawford rule: the first game after either player reaches match
            # point (target − 1) is played with the doubling cube disabled.
            # Exactly one such game per match — afterwards doubling resumes.
            at_match_point = (match.target_points - 1) in (
                match.player1_score, match.player2_score
            )
            crawford_played = match.games.filter(crawford_game=True).exists()

            game = Game.objects.create(
                match=match,
                player1_user=match.player1_user,
                player2_user=match.player2_user,
                player1_name=match.player1_name,
                player2_name=match.player2_name,
                # Carry seat closure forward, or the surviving opponent could
                # advance the match into a fresh game whose orphaned seat looks
                # like a guest seat again.
                player1_deleted=match.player1_deleted,
                player2_deleted=match.player2_deleted,
                board_state=get_initial_board_state(),
                current_turn=next_turn,
                dice_values=[],
                status="active",
                crawford_game=at_match_point and not crawford_played,
            )

        return Response(GameSerializer(game).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="join")
    def join(self, request, pk=None):
        """
        Join a match as player 2 (for online match links).

        The empty-``player2_name`` check is the "seat still free" test, so it
        has to be read under the match lock — two people opening the same link
        at once would otherwise both pass it and the second would silently
        overwrite the first, who has already been told they are in. The waiting
        game is locked too, since it is written from the same decision.

        Lock order here is match → game, the reverse of the gameplay actions.
        That is safe because the two orders can never overlap: this action only
        runs on a match with no second player, whose game is therefore still
        ``waiting``, while the game → match order is only taken by an action
        finishing an ``active`` game.
        """
        with transaction.atomic():
            match = self._locked_object()

            if match.player2_name:
                return Response(
                    {"error": "Match already has two players."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = request.user if request.user.is_authenticated else None
            player2_name = request.data.get("player2_name") or (
                user.username if user else None
            )

            if not player2_name:
                return Response(
                    {"error": "player2_name is required for guest join."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            match.player2_user = user
            match.player2_name = player2_name
            match.save()

            waiting_game = (
                match.games.select_for_update().filter(status="waiting").first()
            )
            if waiting_game:
                waiting_game.player2_user = user
                waiting_game.player2_name = player2_name
                waiting_game.status = "active"
                waiting_game.save()

        return Response(self.get_serializer(match).data)


# ---------------------------------------------------------------------------
# Game viewset
# ---------------------------------------------------------------------------

class GameViewSet(
    RowLockingMixin,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    List / retrieve / create only, plus the custom actions:
      POST /api/games/{id}/roll_dice/
      POST /api/games/{id}/confirm_turn/
      POST /api/games/{id}/join/
      POST /api/games/{id}/offer_double/
      POST /api/games/{id}/respond_to_double/
      POST /api/games/{id}/abandon/

    Deliberately **not** a ModelViewSet: PUT/PATCH/DELETE were routed with no
    permission check at all, so any caller could overwrite a board mid-game or
    delete someone else's game. All state changes go through the custom actions,
    which enforce seat ownership, so the generic write verbs are off the routed
    surface entirely (405).

    ``list`` is scoped to the requester by ``_list_scope_q``; ``retrieve`` and
    the detail actions deliberately are not (link sharing depends on fetching a
    game by id).
    """

    serializer_class = GameSerializer
    pagination_class = BareListPagination

    def get_queryset(self):
        qs = Game.objects.all()
        if self.action == "list":
            qs = qs.filter(_list_scope_q(self.request.user))
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

        The ``status == "waiting"`` check is what claims the seat, so it is read
        under the row lock: a lobby game two people click at the same moment
        would otherwise hand both of them a 200, with the second write quietly
        evicting the first player from a game they think they joined.
        """
        with transaction.atomic():
            game = self._locked_object()

            if game.status != "waiting":
                return Response(
                    {"error": "Game is not open to join."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = request.user if request.user.is_authenticated else None
            player2_name = request.data.get("player2_name") or (
                user.username if user else None
            )

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

        The ``dice_values`` guard is the anti-reroll rule, and it only holds if
        it is read under the lock: two rolls in flight together would otherwise
        both see an empty ``dice_values`` and the loser's roll would be the one
        the player is stuck with.
        """
        with transaction.atomic():
            game = self._locked_object()

            perm_error = _seat_permission_error(game, request.user)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            if game.status != "active":
                return Response(
                    {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
                )

            if game.double_offered_by:
                return Response(
                    {"error": "A double has been offered. The opponent must accept or drop first."},
                    status=status.HTTP_400_BAD_REQUEST,
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

        This is the action most likely to arrive twice — a double-tapped
        Confirm, an impatient retry, two open tabs — and the whole body is a
        read-modify-write over the board, so it runs with the game row locked.
        The replay is then rejected by the guards rather than applied on top of
        itself: committing clears ``dice_values`` and flips ``current_turn``, so
        the second request reads the *post*-turn row and fails "No dice rolled
        for this turn." (or the seat check, from the opponent's side). Reading
        those fields before the lock is what would let the same moves be applied
        to the already-advanced board.
        """
        with transaction.atomic():
            game = self._locked_object()

            perm_error = _seat_permission_error(game, request.user)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            if game.status != "active":
                return Response(
                    {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
                )

            if game.double_offered_by:
                return Response(
                    {"error": "A double has been offered. The opponent must accept or drop first."},
                    status=status.HTTP_400_BAD_REQUEST,
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

            # Higher-die rule: when only one die can be played but either die
            # individually has a legal move, the higher die must be the one played.
            # Applies anywhere on the board (bar entry, mid-board, bear-off). The
            # maximal-usage check above guarantees exactly one staged move whenever
            # this rule is active (max_usable == 1).
            required = higher_die_required_moves(
                game.board_state, player, list(game.dice_values)
            )
            if required is not None:
                allowed = {(m[0], m[1]) for m in required}
                staged = (moves[0].get("from_point"), moves[0].get("to_point"))
                if staged not in allowed:
                    high = next(iter(required))[2]
                    return Response(
                        {
                            "error": (
                                f"When only one die can be played, you must play "
                                f"the higher die ({high})."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            game.board_state = board

            winner = check_winner(board)
            if winner:
                # Scores the match too, on the locked match row — see
                # _apply_game_result.
                _finish_game(game, board, winner)
            else:
                game.current_turn = opponent(player)
                game.dice_values = []

            game.save()

            serializer = self.get_serializer(game)
            return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="offer_double")
    def offer_double(self, request, pk=None):
        """
        Offer to double the stakes. Legal only on your turn, before rolling,
        when you own the cube or it's centered, outside the Crawford game, and
        below the cube's 64 cap. Sets a pending offer the opponent must answer
        (via respond_to_double) before play can continue.

        Locked because the offer has to be mutually exclusive with a roll: the
        "before rolling" and "no offer pending" guards are read from the same
        row this action writes, so a double racing a roll_dice would otherwise
        produce a game that is both rolled and awaiting an answer — a state
        neither client knows how to render.
        """
        with transaction.atomic():
            game = self._locked_object()

            perm_error = _seat_permission_error(game, request.user)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            if game.status != "active":
                return Response(
                    {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
                )

            if game.crawford_game:
                return Response(
                    {"error": "The doubling cube is disabled during the Crawford game."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if game.double_offered_by:
                return Response(
                    {"error": "A double has already been offered."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if game.dice_values:
                return Response(
                    {"error": "You can only double before rolling."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            player = game.current_turn
            if game.cube_owner is not None and game.cube_owner != player:
                return Response(
                    {"error": "Your opponent owns the cube — only they may double."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if game.cube_value >= 64:
                return Response(
                    {"error": "The cube is already at its maximum value (64)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            game.double_offered_by = player
            game.save()

            serializer = self.get_serializer(game)
            return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="respond_to_double")
    def respond_to_double(self, request, pk=None):
        """
        Answer a pending double as the offerer's opponent.

        Expected body: { "accept": true | false }
        Accept: the cube doubles and passes to the acceptor; the offerer then
        rolls as normal. Drop: the responder concedes immediately and the
        offerer scores the *current* (pre-double) cube value.

        Both branches must happen exactly once, and neither is idempotent: a
        replayed accept would double the cube twice, and a replayed drop would
        award the match points twice. The ``double_offered_by`` guard is what
        prevents that, so it is read with the row locked — answering clears the
        field, so a second request reads the cleared row and gets the ordinary
        "No double has been offered." 400.
        """
        with transaction.atomic():
            game = self._locked_object()

            if game.status != "active":
                return Response(
                    {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
                )

            if not game.double_offered_by:
                return Response(
                    {"error": "No double has been offered."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            responder = opponent(game.double_offered_by)
            perm_error = _seat_permission_error(game, request.user, seat=responder)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            accept = request.data.get("accept")
            if not isinstance(accept, bool):
                return Response(
                    {"error": "accept must be true or false."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if accept:
                game.cube_value *= 2
                game.cube_owner = responder
                game.double_offered_by = None
            else:
                # Dropping concedes the game at the pre-double stakes. Scores
                # the match on its locked row — see _apply_game_result.
                _apply_game_result(
                    game, game.double_offered_by, "drop", game.cube_value
                )

            game.save()

            serializer = self.get_serializer(game)
            return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="abandon")
    def abandon(self, request, pk=None):
        """
        Close out a game that is **deadlocked** by a closed seat.

        This is not a resign button. Resigning has scoring semantics (you
        concede points to your opponent); this endpoint exists only for the
        one position the seat rules can produce but not escape: the player who
        owes the next action deleted their account, so
        ``_seat_permission_error`` refuses that seat to *everyone* — including
        the surviving opponent, who would otherwise get to play both sides —
        and the game can never advance again. See the "closed seat deadlocks
        its game" gap in the root ``CLAUDE.md``.

        Preconditions, in the order they are checked:

          1. The game is ``active``. A ``finished`` game has nothing to close
             out; a ``waiting`` game has no seat that owes an action yet.
          2. The seat that owes the next action is closed. That seat is
             normally ``current_turn``, but a pending double is answered by the
             *offerer's opponent*, exactly as ``respond_to_double`` computes it.
          3. The caller may act for the surviving seat, judged by the same
             ``_seat_permission_error`` every gameplay action uses. A registered
             survivor must be logged in as themselves; a guest survivor is
             anonymous-playable, the documented guest-seat trade-off. If *both*
             seats are closed the survivor seat check fails too, and nobody can
             abandon — correct, since there is no survivor to act for.

        The outcome invents nothing. The game finishes with no winner and a
        non-scoring ``win_type="abandoned"``, and the match score is left
        untouched — writing points nobody won is precisely why auto-forfeit was
        rejected. The match is finished as well (again with no winner and no
        score change), because ``next_game`` copies the seat-closure flags onto
        the game it creates: leaving the match open would let the survivor mint
        an endless series of games that are dead on arrival.

        Locked, and the game and match writes share one transaction: finishing
        the game without finishing the match is the exact half-state this
        endpoint exists to prevent, since the survivor could then mint another
        dead game from it.
        """
        with transaction.atomic():
            game = self._locked_object()

            if game.status == "finished":
                return Response(
                    {"error": "Game is already finished."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if game.status != "active":
                return Response(
                    {"error": "Game is not active."}, status=status.HTTP_400_BAD_REQUEST
                )

            # Whose action is the game waiting on? A pending double blocks all play
            # until the offerer's opponent answers it.
            blocked = (
                opponent(game.double_offered_by) if game.double_offered_by else game.current_turn
            )
            blocked_closed = game.player1_deleted if blocked == "p1" else game.player2_deleted
            if not blocked_closed:
                return Response(
                    {
                        "error": "This game is not abandoned — the player to act "
                                 "still has an open seat."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            survivor = opponent(blocked)
            perm_error = _seat_permission_error(game, request.user, seat=survivor)
            if perm_error:
                return Response({"error": perm_error}, status=status.HTTP_403_FORBIDDEN)

            game.status = "finished"
            game.winner = None
            game.win_type = "abandoned"
            game.points_value = 0
            game.dice_values = []
            game.double_offered_by = None
            game.save()

            if game.match_id:
                # Locked in the same game → match order _apply_game_result uses.
                # `match.save()` rewrites every column including the scores, so
                # an unlocked read here could write back a score a sibling
                # game's confirm_turn had just incremented.
                match = Match.objects.select_for_update().get(pk=game.match_id)
                # No winner, no score change — only the match's ability to spawn
                # another dead game is revoked.
                match.status = "finished"
                match.save()

            serializer = self.get_serializer(game)
            return Response(serializer.data)
