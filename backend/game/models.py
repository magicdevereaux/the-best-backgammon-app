from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


class UserPreferences(models.Model):
    """
    Per-account settings that are not part of *identity*.

    This is the first of these, and it exists because `AUTH_USER_MODEL` is
    Django's stock `User`: there is nowhere to hang a column without swapping
    the user model out from under six migrations' worth of FKs, which is a far
    larger change than one boolean is worth. A `OneToOneField` is the standard
    answer and the least invasive one — nothing that reads a `User` today has
    to change.

    **The row is optional.** Every account predating this table has none, and
    `User.objects.create_user` (used directly all over the tests, and by
    `RegisterSerializer`) does not make one. Absence therefore has to *mean*
    something, and it means "all defaults" — which is why every field here must
    keep a sensible default, and why `reminders_enabled` answers True for a user
    with no row at all. `UserSerializer` reads the field back through that same
    helper in `to_representation` — a declared `default=` does **not** do this,
    because DRF applies defaults on the way *in*, so a dotted source with no row
    serialises as `None` and the clients' checkbox would show "off" for every
    account that had never opened its settings.
    The row is created lazily by the first PATCH that changes something
    (`UserSerializer.update` → `for_user`), so no data migration has to walk
    the user table and a plain GET of a profile stays a read.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="preferences"
    )
    # Turn-reminder mail from `manage.py send_turn_reminders`.
    #
    # **Default on, deliberately.** This is transactional in character — it is
    # about a live game the recipient is already playing, on a clock that can
    # forfeit their position while they are not looking — and it is how
    # correspondence chess sites behave. But an address is collected as
    # *optional, for password reset*, so silently treating "gave us an email"
    # as "wants game mail" would be an unsolicited enrolment with no way out.
    # This field is the way out: writable on /api/auth/me/, and named in the
    # footer of every reminder so the mail itself says where the switch is.
    turn_reminder_emails = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Preferences for {self.user}"

    class Meta:
        verbose_name_plural = "user preferences"

    @classmethod
    def for_user(cls, user):
        """The user's row, created with defaults if this is the first look."""
        prefs, _ = cls.objects.get_or_create(user=user)
        return prefs

    @staticmethod
    def reminders_enabled(user):
        """
        Whether `user` wants turn-reminder mail. Never creates a row.

        Read on a hot path (once per candidate game, on every cron tick), so it
        must not write, and it must survive a null user. A missing row is the
        default-on case; `User.preferences` raises `RelatedObjectDoesNotExist`
        for it, which is what is caught here.
        """
        if user is None:
            return False
        try:
            return user.preferences.turn_reminder_emails
        except UserPreferences.DoesNotExist:
            return True


class Match(models.Model):
    player1_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="matches_as_p1"
    )
    player2_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="matches_as_p2"
    )
    player1_name = models.CharField(max_length=200)
    player2_name = models.CharField(max_length=200, blank=True)
    # Seat closed because its registered owner deleted their account. The user
    # FK is SET_NULL, so after a deletion an owned seat is indistinguishable
    # from a guest seat — and guest seats are anonymous-playable by design.
    # These flags restore the distinction: null FK + flag = closed (nobody may
    # act), null FK + no flag = genuine guest. See _match_permission_error.
    player1_deleted = models.BooleanField(default=False)
    player2_deleted = models.BooleanField(default=False)
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
    # Seat closed because its registered owner deleted their account — see the
    # matching fields on Match. Set by _close_deleted_account_seats during
    # DELETE /api/auth/me/; consulted by _seat_permission_error, which refuses
    # every caller (anonymous or not) on a closed seat.
    player1_deleted = models.BooleanField(default=False)
    player2_deleted = models.BooleanField(default=False)
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
    # Doubling cube. cube_owner is a seat ("p1"/"p2"), not a user FK, matching
    # current_turn/winner — guests have no User row, so an FK could never
    # represent a guest owning the cube. Null = centered (either player may
    # double). double_offered_by holds the seat of a pending, unanswered offer.
    cube_value = models.PositiveIntegerField(default=1)
    cube_owner = models.CharField(max_length=2, null=True, blank=True)
    double_offered_by = models.CharField(max_length=2, null=True, blank=True)
    # True for the one game per match played with the cube disabled (the
    # Crawford game), triggered when a player first reaches match point.
    crawford_game = models.BooleanField(default=False)
    # When the seat that currently owes an action started owing it — the anchor
    # for the inactivity-forfeit deadline (see ADR-002 and `claim_timeout`).
    # `updated_at` cannot stand in for this: it is `auto_now`, so *any* write
    # bumps it and it cannot tell "idle for 20 hours" from "rolled 20 hours ago
    # then walked away". Null means no clock is running (a `waiting` game, or a
    # row created before this field existed). Always written together with
    # `current_turn` through `_begin_turn` in views.py, so the two cannot drift.
    turn_started_at = models.DateTimeField(null=True, blank=True)
    # When a "your clock is running" reminder was mailed for the turn that is
    # currently in progress. Null = none sent yet for this turn, and that is
    # the *only* thing stopping `manage.py send_turn_reminders` from mailing
    # the same player on every cron tick: the command's candidate query filters
    # on it being null and stamps it after a successful send. `_begin_turn`
    # clears it alongside `turn_started_at`, which is what scopes it to a
    # single turn — one reminder per turn, forever, without storing a log.
    turn_reminder_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Game {self.pk}: {self.player1_name} vs {self.player2_name}"

    class Meta:
        ordering = ["-created_at", "-id"]

    @property
    def waiting_seat(self):
        """
        The seat the game is waiting on — the one whose inactivity stalls it.

        Normally ``current_turn``, but a pending double blocks *all* play until
        the offerer's opponent answers, so while one is outstanding the seat on
        the clock is the responder, not the roller. This is the single source of
        that rule on the server: ``abandon`` derives its blocked seat from it,
        ``claim_timeout`` derives both the idle seat and (as its opponent) the
        claimant, and ``GameSerializer`` exposes it as ``turn_waiting_seat``.

        **Mirrored on both clients** — ``blockedSeat`` in
        ``mobile/src/game/gating.js`` and ``frontend/src/utils/seats.js`` compute
        exactly this. Change one, change all three.

        Deliberately unconditional on ``status``: it answers "who would owe the
        next action", which is what the callers above want to compare against
        their own guards. The serializer applies the "only while active" gate.
        """
        if self.double_offered_by:
            return "p2" if self.double_offered_by == "p1" else "p1"
        return self.current_turn

    def timeout_deadline(self):
        """
        The instant ``waiting_seat`` forfeits on time, or ``None`` when a
        timeout claim is impossible **in principle** for this game.

        The null cases are the whole point of computing this server-side: the
        clients render a live countdown by comparing their own clock to this
        value, and must never have to re-derive the eligibility rule (which
        would be a fourth copy of it, in two languages). No deadline means no
        countdown and no claim button. They are:

          - not ``active`` — nothing is owed;
          - either seat closed by account deletion — that is ``abandon``'s
            deadlock, and it is non-scoring on purpose;
          - either seat a guest (null user FK) — a guest seat is unverifiable,
            so anyone holding the game id could claim it, including a hotseat
            player farming their own second seat (ADR-002, "registered seats
            only");
          - **both seats the same account.** The rule above was written for
            exactly this threat but only tested for *null* FKs, so one user
            holding both seats slipped through every guard: the deadline was
            real and ``_seat_permission_error`` waved the claim through, since
            the claimant seat's owner genuinely *is* the requester. The result
            was a repeatable, self-serve scoring win — a rating farm. Nobody is
            being stalled when you are your own opponent, so there is nothing
            to forfeit. ``join`` now refuses to create such a row at all; this
            check is what protects the rows that already exist;
          - no ``turn_started_at`` — a row predating the clock, or a game that
            has never been activated.
        """
        if self.status != "active":
            return None
        if self.player1_deleted or self.player2_deleted:
            return None
        if self.player1_user_id is None or self.player2_user_id is None:
            return None
        if self.player1_user_id == self.player2_user_id:
            return None
        if self.turn_started_at is None:
            return None
        return self.turn_started_at + timedelta(hours=settings.TURN_TIMEOUT_HOURS)
