"""
``manage.py send_turn_reminders`` — mail the player a game is waiting on, once
per turn, when their inactivity deadline is close.

**Why a management command and not something automatic.** The gap this closes
is that nothing tells a player their clock is running: both clients show a
countdown, but only while the app is open, so the first a walked-away player
hears of a forfeit is the loss itself. Two obvious homes for the fix are both
wrong. There is no Celery and no in-process scheduler in this stack, so no
background job can exist. And mailing from inside a GET would be a write on a
read that fires only when the *opponent* happens to poll — the one person whose
behaviour has nothing to do with whether the reminder is due. A command is the
remaining shape: a platform cron (Railway supports these) invokes it, and the
thing that decides when mail goes out is a clock, which is what the feature is
about.

Safe to run every few minutes, **including concurrently with itself.**
``Game.turn_reminder_sent_at`` records that the turn in progress has already
been mailed and ``_begin_turn`` clears it when the turn flips, which scopes the
mail to one per turn. What makes that hold under overlapping runs is the
*order*: the row is **claimed before the mail is sent**, by a conditional
``UPDATE ... WHERE turn_reminder_sent_at IS NULL``, and only the process whose
update reported a matching row goes on to send. Two crons racing the same row
therefore produce one mail and one no-op, with no lock and no ``SELECT FOR
UPDATE`` to hold across an SMTP round trip.

**The trade-off that ordering buys, stated plainly.** A process that dies
between claiming and sending — an OOM kill, a container eviction mid-SMTP —
loses that reminder permanently: the stamp says mailed, and nothing clears it
until the turn flips. The alternative, stamping after the send, loses nothing
but *duplicates* whenever a run outlives the cron interval, which for bulk mail
is the worse failure. One player missing one warning beats every player getting
two, so the claim goes first. Note this applies to handled send failures too:
an SMTP error is logged and counted, but the row stays claimed and is **not**
retried on the next tick, for the same reason (the mail may well have been
delivered before the error surfaced).

Also safe to run against a system where nothing is configured, which is the
normal state of this repo: zero games is a no-op, no ``EMAIL_*`` means Django's
console backend prints the mail to stdout, and a row that blows up for any
reason is logged and stepped over rather than taking the run down with it — a
cron job that dies on one bad row stops mailing *everybody*.

**It refuses to send on dev defaults.** ``FRONTEND_BASE_URL`` and
``DEFAULT_FROM_EMAIL`` both have working localhost defaults, because dev needs
no ``.env`` — and a cron scheduled before the real values are set would mail
every waiting player a dead ``http://localhost:3000`` link from
``no-reply@localhost``, in bulk, unrecallably. So an unset var is a hard exit
naming it, not a warning. ``--dry-run`` still runs (it sends nothing, and being
able to rehearse the command locally is the point), and ``--allow-dev-defaults``
is the deliberate escape hatch for someone testing real delivery against a
local mail catcher.

Eligibility is **not reimplemented here.** ``Game.timeout_deadline()`` is the
single source of "could this game be claimed at all", and it already refuses
guest seats, seats closed by account deletion, one account holding both seats,
games that are not active, and rows with no clock. This command narrows to that
same set in SQL for efficiency and then defers to the method for the verdict,
so the two cannot drift — a reminder about a deadline that could never be
enforced would be a lie, and worse than silence.

**Every row is re-read, and re-timed, immediately before it is mailed.** The
candidate query is one snapshot taken at the top of a run that may take
minutes over a large backlog, so by the time a given row comes up its game may
have been won, claimed, abandoned or simply played on — and "your opponent can
claim the win, move now" about a finished board is the same lie in a different
costume. ``now`` is likewise recomputed per row rather than frozen at
``handle()``, or a slow run's "you have 7h 12m left" would over-report by its
own duration.

Recipients can opt out: ``UserPreferences.turn_reminder_emails`` (default on,
togglable at ``PATCH /api/auth/me/``) is honoured here, and every mail carries a
footer saying so. An address is collected for password reset, not for game
mail, so the opt-out is what makes sending this at all legitimate.

Usage:
    python manage.py send_turn_reminders
    python manage.py send_turn_reminders --dry-run
    python manage.py send_turn_reminders --limit 50
    python manage.py send_turn_reminders --allow-dev-defaults
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.db.models import F
from django.utils import timezone

from game.models import Game, UserPreferences
from game.views import build_game_url

logger = logging.getLogger(__name__)

# Closes every reminder. Two things it has to do, and both are the difference
# between this and spam: say *why* the recipient is getting mail from a game
# app they gave an address to for password reset, and name the exact place the
# switch lives. There is no tokenised unsubscribe link — the setting is one
# tap behind a login the recipient already has, and a token endpoint would be
# a new unauthenticated write surface for the sake of saving that tap.
REMINDER_FOOTER = (
    "--\n"
    "You're getting this because it's your turn in a Backgammon game you're "
    "playing, and your time to move is running out.\n"
    "To stop turn reminders, open your profile in the app and switch off "
    '"Turn reminder emails".\n'
)


def format_remaining(delta):
    """
    A deadline gap, in words a person can act on.

    Rounded down to the minute deliberately: "about 5h 0m" reads as more time
    than "5h 59m" does, and under-promising is the safe direction for a warning
    whose whole job is to get someone to move before a hard cutoff.
    """
    total_minutes = int(delta.total_seconds() // 60)
    if total_minutes <= 0:
        return "less than a minute"
    hours, minutes = divmod(total_minutes, 60)
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"


def build_reminder_email(game, seat, user, deadline, now):
    """
    ``(subject, body)`` for one reminder. Pure, so the wording is testable
    without a mail backend.

    The body has to answer three questions or it is noise: *which* game (there
    can be several in flight, and a match spawns a new one per game), *how
    long* is left, and *what happens* if they do nothing. The last one is the
    point — a deadline nobody was told about is not a deadline, and "your
    opponent can claim the win" is the consequence the countdown in the clients
    has never been able to say out loud.
    """
    opponent_name = game.player2_name if seat == "p1" else game.player1_name
    opponent_name = opponent_name or "your opponent"

    remaining = deadline - now
    if remaining.total_seconds() <= 0:
        # The cron may well be the first thing to look at this row since the
        # deadline passed — the claim is pull-based, so an expired game sits
        # there until the opponent asks. Saying "0h 0m left" would be both
        # confusing and wrong; the honest message is that it is already lost.
        timing = (
            "Your time to move has run out, and your opponent can claim the "
            "win at any moment. Move now and the claim is withdrawn "
            "automatically — the clock restarts the instant you play."
        )
    else:
        timing = (
            f"You have {format_remaining(remaining)} left to play. If you "
            f"don't move in time, {opponent_name} can claim the win."
        )

    subject = f"It's your move against {opponent_name}"
    body = (
        f"Hi {user.username},\n\n"
        f"You're on the clock in your Backgammon game against "
        f"{opponent_name}.\n\n"
        f"{timing}\n\n"
        f"Play your turn here:\n{build_game_url(game)}\n\n"
        f"{REMINDER_FOOTER}"
    )
    return subject, body


class Command(BaseCommand):
    help = (
        "Email a turn reminder to players whose inactivity deadline is within "
        "TURN_REMINDER_LEAD_HOURS. One mail per turn; safe to run on a cron."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help=(
                "Report what would be sent and send nothing. Leaves "
                "turn_reminder_sent_at untouched, so a real run afterwards "
                "still mails every game listed."
            ),
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            metavar="N",
            help=(
                "Stop after N reminders. Caps mail *sent*, not rows examined, "
                "so a first run against a large backlog can be spread over "
                "several invocations instead of arriving as one blast."
            ),
        )
        parser.add_argument(
            "--allow-dev-defaults",
            action="store_true",
            help=(
                "Send even though FRONTEND_BASE_URL and/or DEFAULT_FROM_EMAIL "
                "are still at their localhost dev defaults. For testing real "
                "delivery against a local mail catcher; never for a cron."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        limit = options["limit"]
        if limit is not None and limit < 0:
            raise CommandError("--limit must be zero or greater.")

        if not dry_run and not options["allow_dev_defaults"]:
            # Before a single row is touched. A partial blast is not better
            # than none, so this is a precondition on the run, not a per-row
            # check — and a hard exit, because the failure it prevents is
            # unrecallable mail to every waiting player at once.
            unset = self._dev_default_vars()
            if unset:
                raise CommandError(
                    "Refusing to send: "
                    + " and ".join(unset)
                    + (" is" if len(unset) == 1 else " are")
                    + " still at the dev default, so every reminder would "
                    "carry a dead link or a bogus sender. Set "
                    + " and ".join(unset)
                    + " in the environment, or pass --dry-run to rehearse or "
                    "--allow-dev-defaults to send anyway."
                )

        lead = timedelta(hours=settings.TURN_REMINDER_LEAD_HOURS)

        sent = 0
        skipped = 0
        errors = 0
        considered = 0

        for game_id in self._candidates():
            if limit is not None and sent >= limit:
                break
            considered += 1
            try:
                result = self._process(game_id, lead, dry_run)
            except Exception:
                # One malformed row must never end the run: this is a cron job,
                # and dying here silently stops reminders for every other game
                # too. Logged with the id so it can be chased down.
                errors += 1
                logger.exception("Turn reminder failed for game %s", game_id)
                continue
            if result:
                sent += 1
            else:
                skipped += 1

        summary = (
            f"send_turn_reminders: {considered} candidate(s), "
            f"{sent} reminder(s) {'to send' if dry_run else 'sent'}, "
            f"{skipped} skipped, {errors} error(s)."
        )
        if dry_run:
            # Plain ASCII on purpose: this goes to stdout, and a cron log on a
            # console that is not UTF-8 (a Windows dev box, notably) renders an
            # em dash as a replacement character.
            summary += " (dry run - no mail sent, nothing recorded.)"
        self.stdout.write(summary)

    def _dev_default_vars(self):
        """
        The names of the mail-critical settings still at their dev default.

        Compared against the constants ``settings.py`` builds them from, not
        against literals copied here — the point of the check is that the two
        modules can never disagree about what "unset" looks like.
        """
        unset = []
        if settings.FRONTEND_BASE_URL == settings.DEV_DEFAULT_FRONTEND_BASE_URL:
            unset.append("FRONTEND_BASE_URL")
        if settings.DEFAULT_FROM_EMAIL == settings.DEV_DEFAULT_FROM_EMAIL:
            unset.append("DEFAULT_FROM_EMAIL")
        return unset

    def _candidates(self):
        """
        Ids of the rows worth *looking* at: the SQL-expressible half of
        ``Game.timeout_deadline``'s null cases, plus "not already reminded".

        This is an optimisation, not the rule — every id it yields is re-read
        and put through ``timeout_deadline()`` in ``_process``. Filtering here
        only keeps the command from dragging every finished game in the table
        through Python on each cron tick.

        **Ids, not rows, on purpose.** This list is a snapshot, and a run over
        a large backlog can outlive the truth of it, so any field values
        carried out of here would be stale by the time they were used. Yielding
        only the primary key makes that structural: ``_process`` has nothing to
        work from *but* a fresh read.
        """
        return list(
            Game.objects.filter(
                status="active",
                turn_started_at__isnull=False,
                turn_reminder_sent_at__isnull=True,
                player1_user__isnull=False,
                player2_user__isnull=False,
                player1_deleted=False,
                player2_deleted=False,
            )
            .exclude(player1_user_id=F("player2_user_id"))
            .order_by("turn_started_at", "id")
            .values_list("pk", flat=True)
        )

    def _process(self, game_id, lead, dry_run):
        """
        Return True if a reminder was sent (or would be, under --dry-run).

        Everything this decides on is read *here*, not carried in from the
        candidate snapshot: the row, and the clock. See the module docstring —
        a run can take minutes, and a game that was won, claimed or played on
        in the meantime must not be mailed "move now or lose", nor should a
        countdown be quoted from a `now` that is minutes old.
        """
        game = (
            Game.objects.select_related("player1_user", "player2_user")
            .filter(pk=game_id)
            .first()
        )
        if game is None:
            # Deleted between the snapshot and now. Nothing to remind about.
            return False

        now = timezone.now()
        deadline = game.timeout_deadline()
        if deadline is None:
            # The authoritative check, against the *fresh* row. `_candidates`
            # mirrors the same rules, so reaching this means the game finished
            # (a win, a timeout claim, an abandon), a seat closed, or a rule
            # grew a case SQL cannot express — either way, no reminder.
            return False

        if deadline - now > lead:
            # Too early. The turn only just started; a reminder now would be
            # about a deadline the player has no reason to think about yet,
            # and it would burn this turn's one allowed mail.
            return False

        seat = game.waiting_seat
        user = game.player1_user if seat == "p1" else game.player2_user
        if user is None or not (user.email or "").strip():
            # A registered account with no address on file. Email is optional
            # at registration on purpose (see RegisterSerializer), so this is
            # an ordinary state, not an error.
            return False

        if not UserPreferences.reminders_enabled(user):
            # Opted out. Deliberately *not* stamped: the stamp means "already
            # mailed for this turn", and recording a mail that never happened
            # would silence the turn if they switched reminders back on a
            # minute later. Re-evaluating a skipped row on the next tick costs
            # one indexed read.
            return False

        subject, body = build_reminder_email(game, seat, user, deadline, now)

        if dry_run:
            self.stdout.write(
                f"  would remind {user.username} <{user.email}> "
                f"about game {game.pk} (deadline {deadline.isoformat()})"
            )
            return True

        # **Claim, then send.** A conditional UPDATE is the whole concurrency
        # story (see the module docstring): the WHERE clause re-asserts, in the
        # same statement that writes, everything that could have changed since
        # the read a few lines up — nobody else has claimed this turn, the turn
        # is still the one being mailed about, and the game is still live. The
        # database decides the winner; `.update()` returns how many rows it
        # matched, and a zero means some other process (or a `confirm_turn`, or
        # a `claim_timeout`) got there first, so this one sends nothing.
        #
        # `.update()` rather than `.save()` so the row is not written back
        # wholesale over whatever else changed concurrently.
        claimed = Game.objects.filter(
            pk=game.pk,
            turn_started_at=game.turn_started_at,
            turn_reminder_sent_at__isnull=True,
            status="active",
        ).update(turn_reminder_sent_at=now)
        if not claimed:
            return False

        # Past this point the row says "mailed" whether or not the send below
        # succeeds. That is the documented trade-off: at most one lost
        # reminder, never a duplicate.
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        return True
