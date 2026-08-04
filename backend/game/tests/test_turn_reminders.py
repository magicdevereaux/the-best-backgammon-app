"""
Tests for ``manage.py send_turn_reminders``.

The command exists because nothing else in this stack can tell a player their
inactivity clock is running (no Celery, no in-process scheduler, and mailing
from a GET would fire on the *opponent's* poll). A platform cron invokes it,
which makes two properties load-bearing and both are pinned here:

  **Exactly once per turn, even under overlapping runs.**  A cron every ten
  minutes must not mail every ten minutes, and two crons that overlap must not
  mail twice. ``Game.turn_reminder_sent_at`` is the whole mechanism: it is
  *claimed* by a conditional UPDATE before the send, and it is only correct if
  ``_begin_turn`` clears it on every path that starts a clock — so the "a fresh
  turn earns a fresh reminder" tests matter as much as the "a second run is
  silent" and "a claimed row is not mailed again" ones.

  **Never a lie.** A reminder about a deadline nobody could enforce is worse
  than silence, so eligibility is deferred wholesale to
  ``Game.timeout_deadline()``. The guest / closed-seat / same-account /
  no-clock cases are re-checked here against the command rather than trusted
  from the model's own tests, because the command narrows in SQL first and that
  copy of the rules is exactly the thing that could drift. The same principle
  is why the row and the clock are re-read per row: see ``StaleSnapshotTest``.

  **Never unsolicited, and never dead on arrival.** An address is collected for
  password reset, so game mail needs an opt-out
  (``UserPreferences.turn_reminder_emails``) and a footer pointing at it; and a
  cron scheduled before ``FRONTEND_BASE_URL`` / ``DEFAULT_FROM_EMAIL`` are set
  must refuse rather than blast localhost links. See ``OptOutTest`` and
  ``DevDefaultsTest``.

  **Only to confirmed addresses.** This command is the app's entire bulk sender,
  so an unconfirmed address here is a bounce, and enough bounces sink the
  sending domain for everybody (ADR-003). ``make_user`` below therefore mints a
  *verified* account, because that is the state every test in this module is
  about — the skip itself, and the fact that it does not burn the turn's
  reminder, belong to ``test_email_verification.RemindersRequireVerificationTest``
  and are asserted there rather than duplicated here.

Mail lands in ``django.core.mail.outbox`` — the test runner swaps in the locmem
backend, so nothing here needs (or touches) real mail configuration. It does
*not* swap the two settings above, which still hold their dev defaults under
test, so every class that expects mail to go out wears ``@PRODUCTION_MAIL``.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_turn_reminders
"""

from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from game.game_logic import get_initial_board_state
from game.management.commands.send_turn_reminders import Command
from game.models import EmailVerification, Game, UserPreferences


PASSWORD = "securepass123"

# What a *configured* deployment looks like. The command refuses to send while
# either of these is at its dev default (that refusal is the subject of
# `DevDefaultsTest`), so every class here that asserts on delivered mail has to
# stand in for a real deployment rather than the repo's zero-config state.
PRODUCTION_MAIL = override_settings(
    FRONTEND_BASE_URL="https://play.example.com",
    DEFAULT_FROM_EMAIL="Backgammon <no-reply@play.example.com>",
)

# 48h timeout, 12h lead: a turn started 40 hours ago has 8 hours left and is
# inside the reminder window; one started an hour ago is not.
INSIDE_WINDOW_HOURS = 40
OUTSIDE_WINDOW_HOURS = 1


def verify(user):
    """
    Stamp ``user``'s current address as confirmed.

    Written directly rather than driven through
    ``POST /api/auth/verify-email/confirm/`` on purpose: this module is about
    the reminder command, and routing every fixture through a second endpoint
    would make a bug in *that* endpoint fail thirty tests over here with a
    misleading message. The confirm flow has its own module.

    ``verified_email`` must be the live address, not merely a timestamp —
    ``EmailVerification.is_verified`` compares the two, which is what makes an
    email change self-invalidating.
    """
    row = EmailVerification.for_user(user)
    row.verified_email = (user.email or "").strip()
    row.verified_at = timezone.now()
    row.save(update_fields=["verified_email", "verified_at", "updated_at"])
    return user


def make_user(username, email=None):
    """
    A registered player with a **confirmed** address, which is the ordinary
    state of an account that can receive turn reminders at all.

    Callers that pass an empty ``email`` still get a row stamped against that
    empty string, and ``is_verified`` answers False for it — an address-less
    account is unverifiable by construction, so the two cases stay distinct
    without the fixture needing a second flag.
    """
    user = User.objects.create_user(
        username=username,
        password=PASSWORD,
        email=f"{username}@example.com" if email is None else email,
    )
    return verify(user)


def auth(username):
    client = APIClient()
    token = client.post(
        "/api/auth/login/", {"username": username, "password": PASSWORD}, format="json"
    ).json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


def make_game(p1_user=None, p2_user=None, **kwargs):
    fields = {
        "player1_user": p1_user,
        "player2_user": p2_user,
        "player1_name": p1_user.username if p1_user else "Guest 1",
        "player2_name": p2_user.username if p2_user else "Guest 2",
        "board_state": get_initial_board_state(),
        "current_turn": "p1",
        "dice_values": [],
        "status": "active",
        "turn_started_at": timezone.now(),
    }
    fields.update(kwargs)
    return Game.objects.create(**fields)


def age_turn(game, hours=INSIDE_WINDOW_HOURS):
    """Backdate the clock without touching anything else on the row."""
    Game.objects.filter(pk=game.pk).update(
        turn_started_at=timezone.now() - timedelta(hours=hours)
    )
    game.refresh_from_db()
    return game


def run(*args):
    out = StringIO()
    call_command("send_turn_reminders", *args, stdout=out)
    return out.getvalue()


@PRODUCTION_MAIL
class SendsAReminderTest(TestCase):
    """The happy path, and what the mail actually has to say."""

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = age_turn(make_game(self.alice, self.bob, current_turn="p1"))

    def test_the_waiting_player_gets_exactly_one_mail(self):
        run()
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])

    def test_the_send_is_recorded_on_the_game(self):
        self.assertIsNone(self.game.turn_reminder_sent_at)
        run()
        self.game.refresh_from_db()
        self.assertIsNotNone(self.game.turn_reminder_sent_at)

    def test_it_uses_the_configured_from_address(self):
        """Same plumbing as the password-reset mail, not a second convention."""
        with override_settings(DEFAULT_FROM_EMAIL="Test <bg@example.com>"):
            run()
        self.assertEqual(mail.outbox[0].from_email, "Test <bg@example.com>")

    def test_the_body_names_the_opponent_the_time_left_and_the_stake(self):
        run()
        body = mail.outbox[0].body
        self.assertIn("bob", body)
        self.assertIn("alice", body)              # greeted by name
        self.assertIn("claim the win", body)
        # 48h timeout, 40h elapsed — about 8h left, floored to the minute (and
        # the minutes are dropped when they land on zero), so the shape is
        # asserted rather than an exact string.
        self.assertRegex(body, r"You have \d+h(?: \d+m)? left to play")

    def test_the_body_links_to_the_game(self):
        with override_settings(FRONTEND_BASE_URL="https://play.example.com"):
            run()
        self.assertIn(
            f"https://play.example.com/game/{self.game.pk}", mail.outbox[0].body
        )

    def test_the_subject_names_the_opponent(self):
        run()
        self.assertIn("bob", mail.outbox[0].subject)

    def test_an_overdue_turn_is_told_the_time_is_already_up(self):
        """
        The claim is pull-based, so a passed deadline can sit unclaimed. "0h 0m
        left" would be both confusing and wrong.
        """
        age_turn(self.game, hours=60)
        run()
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        self.assertIn("run out", body)
        self.assertNotIn("0h 0m", body)

    def test_the_responder_is_reminded_while_a_double_is_pending(self):
        """
        The seat on the clock is `waiting_seat`, not `current_turn` — with an
        offer outstanding it is the responder who is stalling the game.
        """
        Game.objects.filter(pk=self.game.pk).update(double_offered_by="p1")
        run()
        self.assertEqual(mail.outbox[0].to, ["bob@example.com"])

    def test_the_summary_line_reports_what_happened(self):
        output = run()
        self.assertIn("1 candidate(s)", output)
        self.assertIn("1 reminder(s) sent", output)


@PRODUCTION_MAIL
class IdempotencyTest(TestCase):
    """A cron every ten minutes must not mail every ten minutes."""

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = age_turn(make_game(self.alice, self.bob, current_turn="p1"))

    def test_a_second_run_sends_nothing(self):
        run()
        run()
        run()
        self.assertEqual(len(mail.outbox), 1)

    def test_a_reminded_game_is_not_even_a_candidate_on_the_next_run(self):
        run()
        mail.outbox.clear()
        output = run()
        self.assertIn("0 candidate(s)", output)
        self.assertEqual(mail.outbox, [])

    def test_a_fresh_turn_earns_a_fresh_reminder(self):
        """
        The stamp is scoped to one turn by `_begin_turn` clearing it. If that
        clear were ever dropped, this game would go permanently silent — which
        is why it is asserted through the real API rather than by writing the
        field by hand.
        """
        run()
        self.assertEqual(len(mail.outbox), 1)

        Game.objects.filter(pk=self.game.pk).update(dice_values=[3, 4])
        confirmed = auth("alice").post(
            f"/api/games/{self.game.pk}/confirm_turn/",
            {"moves": [{"from_point": 1, "to_point": 4},
                       {"from_point": 1, "to_point": 5}]},
            format="json",
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.json())

        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)

        # bob is now on the clock; age his turn into the window.
        age_turn(self.game)
        run()
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[1].to, ["bob@example.com"])

    def test_offering_a_double_also_clears_the_stamp(self):
        """`_begin_turn` runs on every waiting-seat change, not just turn flips."""
        run()
        self.game.refresh_from_db()
        self.assertIsNotNone(self.game.turn_reminder_sent_at)

        offered = auth("alice").post(
            f"/api/games/{self.game.pk}/offer_double/", {}, format="json"
        )
        self.assertEqual(offered.status_code, 200, offered.json())
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)


@PRODUCTION_MAIL
class NotEligibleTest(TestCase):
    """
    Every case `Game.timeout_deadline()` refuses is a case the command must
    refuse too — it narrows in SQL first, and that copy could drift.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def assert_silent(self):
        run()
        self.assertEqual(mail.outbox, [])

    def test_no_games_at_all_is_a_no_op(self):
        output = run()
        self.assertIn("0 candidate(s)", output)
        self.assertEqual(mail.outbox, [])

    def test_a_turn_outside_the_lead_window_is_left_alone(self):
        game = make_game(self.alice, self.bob)
        age_turn(game, hours=OUTSIDE_WINDOW_HOURS)
        self.assert_silent()
        game.refresh_from_db()
        self.assertIsNone(game.turn_reminder_sent_at)

    def test_a_guest_opponent_gets_no_reminder(self):
        """Guest games are not claimable, so there is no deadline to warn about."""
        age_turn(make_game(self.alice, None))
        self.assert_silent()

    def test_a_guest_on_the_clock_gets_no_reminder(self):
        age_turn(make_game(None, self.bob))
        self.assert_silent()

    def test_a_closed_seat_gets_no_reminder(self):
        """That is `abandon`'s deadlock, and it is not a timeout."""
        game = age_turn(make_game(self.alice, self.bob))
        Game.objects.filter(pk=game.pk).update(player2_user=None, player2_deleted=True)
        self.assert_silent()

    def test_one_account_in_both_seats_gets_no_reminder(self):
        """Nobody is being stalled when you are your own opponent."""
        age_turn(make_game(self.alice, self.alice))
        self.assert_silent()

    def test_a_seat_with_no_email_gets_no_reminder(self):
        """An address is optional at registration; this is ordinary, not an error."""
        carol = make_user("carol", email="")
        age_turn(make_game(carol, self.bob, current_turn="p1"))
        self.assert_silent()

    def test_a_blank_email_is_treated_as_no_email(self):
        dave = make_user("dave", email="   ")
        age_turn(make_game(dave, self.bob, current_turn="p1"))
        self.assert_silent()

    def test_a_game_with_no_clock_gets_no_reminder(self):
        make_game(self.alice, self.bob, turn_started_at=None)
        self.assert_silent()

    def test_a_waiting_game_gets_no_reminder(self):
        make_game(self.alice, None, status="waiting", turn_started_at=None)
        self.assert_silent()

    def test_a_finished_game_gets_no_reminder(self):
        game = make_game(
            self.alice, self.bob, status="finished", winner="p2",
            win_type="timeout", points_value=1,
        )
        age_turn(game)
        self.assert_silent()

    @override_settings(TURN_REMINDER_LEAD_HOURS=1)
    def test_the_lead_window_follows_the_setting(self):
        game = age_turn(make_game(self.alice, self.bob))  # 8h left, lead now 1h
        self.assert_silent()

        age_turn(game, hours=47.5)  # 30m left
        run()
        self.assertEqual(len(mail.outbox), 1)

    @override_settings(TURN_TIMEOUT_HOURS=6)
    def test_a_shorter_timeout_moves_the_window_with_it(self):
        """40h elapsed is far past a 6h deadline — overdue, but still one mail."""
        age_turn(make_game(self.alice, self.bob))
        run()
        self.assertEqual(len(mail.outbox), 1)


@PRODUCTION_MAIL
class FlagsTest(TestCase):
    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.carol = make_user("carol")
        self.dave = make_user("dave")

    def test_dry_run_sends_nothing_and_records_nothing(self):
        game = age_turn(make_game(self.alice, self.bob))
        output = run("--dry-run")

        self.assertEqual(mail.outbox, [])
        game.refresh_from_db()
        self.assertIsNone(game.turn_reminder_sent_at)
        self.assertIn("dry run", output)
        self.assertIn("alice@example.com", output)

    def test_a_real_run_after_a_dry_run_still_mails(self):
        age_turn(make_game(self.alice, self.bob))
        run("--dry-run")
        run()
        self.assertEqual(len(mail.outbox), 1)

    def test_limit_caps_the_number_of_mails(self):
        for hours in (44, 42, 40):
            age_turn(make_game(self.alice, self.bob), hours=hours)
        run("--limit", "2")
        self.assertEqual(len(mail.outbox), 2)

    def test_the_games_left_by_a_limit_are_mailed_on_the_next_run(self):
        for hours in (44, 42, 40):
            age_turn(make_game(self.alice, self.bob), hours=hours)
        run("--limit", "2")
        run("--limit", "2")
        self.assertEqual(len(mail.outbox), 3)

    def test_limit_zero_sends_nothing(self):
        age_turn(make_game(self.alice, self.bob))
        run("--limit", "0")
        self.assertEqual(mail.outbox, [])

    def test_a_negative_limit_is_rejected(self):
        with self.assertRaises(CommandError):
            call_command("send_turn_reminders", "--limit", "-1", stdout=StringIO())


@PRODUCTION_MAIL
class ResilienceTest(TestCase):
    """
    A cron job that dies on one bad row stops mailing everybody, so a failure
    has to be survivable and visible rather than fatal.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def test_one_failing_send_does_not_stop_the_run(self):
        first = age_turn(make_game(self.alice, self.bob), hours=44)
        second = age_turn(make_game(self.bob, self.alice), hours=40)

        calls = []

        def flaky(**kwargs):
            calls.append(kwargs["recipient_list"])
            if len(calls) == 1:
                raise RuntimeError("SMTP exploded")
            return 1

        with patch(
            "game.management.commands.send_turn_reminders.send_mail", side_effect=flaky
        ):
            with self.assertLogs("game.management.commands.send_turn_reminders", "ERROR"):
                output = run()

        # Both rows were attempted; the second one succeeded.
        self.assertEqual(len(calls), 2)
        self.assertIn("1 error(s)", output)
        self.assertIn("1 reminder(s) sent", output)

    def test_a_failed_send_is_not_retried_on_the_next_tick(self):
        """
        The uncomfortable half of claim-then-send, pinned so nobody "fixes" it
        by accident.

        The row is claimed *before* the mail leaves, so a send that raises has
        already been recorded as reminded and the next cron tick will not try
        again — that reminder is simply lost. Un-claiming in the exception
        handler looks like an obvious improvement and is not: `send_mail` can
        raise after the message was accepted, and the retry would then be the
        duplicate the ordering exists to prevent. One lost warning beats every
        player getting two.
        """
        game = age_turn(make_game(self.alice, self.bob))

        with patch(
            "game.management.commands.send_turn_reminders.send_mail",
            side_effect=RuntimeError("SMTP exploded"),
        ):
            with self.assertLogs("game.management.commands.send_turn_reminders", "ERROR"):
                run()

        game.refresh_from_db()
        self.assertIsNotNone(game.turn_reminder_sent_at)

        run()
        self.assertEqual(mail.outbox, [])

    def test_a_turn_that_flips_before_the_claim_is_not_mailed_or_marked(self):
        """
        The claim is a compare-and-set on `turn_started_at`, `status` and the
        stamp itself. A `confirm_turn` landing between this run's read of the
        row and its UPDATE must lose the row entirely: no mail about a turn
        that is over, and no stamp on the brand-new turn (which would silence
        the incoming player's own reminder).
        """
        game = age_turn(make_game(self.alice, self.bob))
        moved_to = timezone.now()

        # `build_reminder_email` is the last thing the command calls before the
        # claiming UPDATE, which makes it the seam for "the world changed
        # between the read and the write".
        real_build = Command.__module__
        from game.management.commands import send_turn_reminders as cmd

        def flip_then_build(*args, **kwargs):
            Game.objects.filter(pk=game.pk).update(
                current_turn="p2", turn_started_at=moved_to
            )
            return cmd.build_reminder_email.__wrapped__(*args, **kwargs) \
                if hasattr(cmd.build_reminder_email, "__wrapped__") \
                else ("subject", "body")

        with patch.object(cmd, "build_reminder_email", side_effect=flip_then_build):
            output = run()

        self.assertEqual(mail.outbox, [])
        self.assertIn("0 reminder(s) sent", output)
        game.refresh_from_db()
        self.assertIsNone(game.turn_reminder_sent_at)
        self.assertEqual(real_build, cmd.__name__)

        game.refresh_from_db()
        self.assertIsNone(game.turn_reminder_sent_at)


@PRODUCTION_MAIL
class StaleSnapshotTest(TestCase):
    """
    ``_candidates`` is one query and a run over a backlog can outlive it, so
    every decision has to come from a *fresh* read inside ``_process``. The
    failure this prevents is a player being told "move now or lose" about a
    game they already lost minutes earlier, with a link to a finished board.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = age_turn(make_game(self.alice, self.bob, current_turn="p1"))

    def _candidates_then(self, mutate):
        """Yield the real candidate ids, then change the world behind them."""
        def stale(_cmd_self):
            ids = [self.game.pk]
            mutate()
            return ids
        return stale

    def test_a_game_claimed_between_snapshot_and_send_is_not_mailed(self):
        def claimed():
            Game.objects.filter(pk=self.game.pk).update(
                status="finished", winner="p2", win_type="timeout"
            )

        with patch.object(Command, "_candidates", self._candidates_then(claimed)):
            output = run()

        self.assertEqual(mail.outbox, [])
        self.assertIn("0 reminder(s) sent", output)

    def test_a_seat_closed_between_snapshot_and_send_is_not_mailed(self):
        """`timeout_deadline()` goes null, so the row stops being claimable."""
        def closed():
            Game.objects.filter(pk=self.game.pk).update(player2_deleted=True)

        with patch.object(Command, "_candidates", self._candidates_then(closed)):
            run()

        self.assertEqual(mail.outbox, [])

    def test_a_row_deleted_between_snapshot_and_send_is_survived(self):
        """A vanished id must be a skip, not a crash that ends the cron run."""
        def deleted():
            Game.objects.filter(pk=self.game.pk).delete()

        with patch.object(Command, "_candidates", self._candidates_then(deleted)):
            output = run()

        self.assertEqual(mail.outbox, [])
        self.assertIn("0 error(s)", output)

    def test_a_turn_played_between_snapshot_and_send_is_not_mailed(self):
        """The clock restarted, so this row is no longer inside the window."""
        def played():
            Game.objects.filter(pk=self.game.pk).update(
                current_turn="p2", turn_started_at=timezone.now()
            )

        with patch.object(Command, "_candidates", self._candidates_then(played)):
            run()

        self.assertEqual(mail.outbox, [])


@PRODUCTION_MAIL
class OptOutTest(TestCase):
    """
    An address is collected as *optional, for password reset*. Treating that as
    consent to game mail would be an unsolicited enrolment with no way out, so
    the opt-out is what makes sending this legitimate at all — and the footer is
    what makes it discoverable by someone reading the mail rather than the docs.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = age_turn(make_game(self.alice, self.bob, current_turn="p1"))

    def test_an_account_with_no_preferences_row_still_gets_mail(self):
        """Absence means "all defaults", and the default is on."""
        self.assertFalse(UserPreferences.objects.filter(user=self.alice).exists())
        run()
        self.assertEqual(len(mail.outbox), 1)

    def test_an_opted_out_player_gets_nothing(self):
        UserPreferences.objects.create(user=self.alice, turn_reminder_emails=False)
        run()
        self.assertEqual(mail.outbox, [])

    def test_an_opt_out_does_not_burn_the_turn_s_reminder(self):
        """
        Deliberately unstamped. Stamping a mail that never went out would
        silence this turn for good if they switched reminders back on a minute
        later — so the skip has to stay re-evaluable.
        """
        prefs = UserPreferences.objects.create(
            user=self.alice, turn_reminder_emails=False
        )
        run()
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)

        prefs.turn_reminder_emails = True
        prefs.save()
        run()
        self.assertEqual(len(mail.outbox), 1)

    def test_opting_out_is_per_account_not_global(self):
        UserPreferences.objects.create(user=self.alice, turn_reminder_emails=False)
        other = age_turn(make_game(self.bob, self.alice, current_turn="p1"))

        run()

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["bob@example.com"])
        self.assertEqual(other.pk, Game.objects.get(pk=other.pk).pk)

    def test_the_profile_endpoint_is_the_switch(self):
        """The opt-out is only real if the shipped clients can reach it."""
        resp = auth("alice").patch(
            "/api/auth/me/", {"turn_reminder_emails": False}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertFalse(resp.json()["turn_reminder_emails"])

        run()
        self.assertEqual(mail.outbox, [])

    def test_the_profile_endpoint_reports_the_default_without_a_row(self):
        resp = auth("alice").get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["turn_reminder_emails"])

    def test_switching_back_on_through_the_api_restores_mail(self):
        client = auth("alice")
        client.patch("/api/auth/me/", {"turn_reminder_emails": False}, format="json")
        client.patch("/api/auth/me/", {"turn_reminder_emails": True}, format="json")

        run()
        self.assertEqual(len(mail.outbox), 1)

    def test_every_reminder_says_how_to_stop_them(self):
        run()
        body = mail.outbox[0].body
        self.assertIn("Turn reminder emails", body)
        self.assertIn("profile", body)


class DevDefaultsTest(TestCase):
    """
    Note the missing ``@PRODUCTION_MAIL``: this class is the repo's zero-config
    state, which is exactly what it is about.

    A cron scheduled before ``FRONTEND_BASE_URL`` / ``DEFAULT_FROM_EMAIL`` are
    set would mail every waiting player a dead ``localhost`` link from a bogus
    sender — in bulk, and unrecallably. The refusal is a precondition on the
    whole run rather than a per-row skip, because a partial blast is no better
    than a full one.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = age_turn(make_game(self.alice, self.bob, current_turn="p1"))

    def test_it_refuses_to_send_on_dev_defaults(self):
        with self.assertRaises(CommandError) as ctx:
            run()
        message = str(ctx.exception)
        self.assertIn("FRONTEND_BASE_URL", message)
        self.assertIn("DEFAULT_FROM_EMAIL", message)
        self.assertEqual(mail.outbox, [])

    def test_a_refusal_records_nothing(self):
        with self.assertRaises(CommandError):
            run()
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)

    @override_settings(FRONTEND_BASE_URL="https://play.example.com")
    def test_it_names_only_the_var_still_unset(self):
        with self.assertRaises(CommandError) as ctx:
            run()
        message = str(ctx.exception)
        self.assertIn("DEFAULT_FROM_EMAIL", message)
        self.assertNotIn("FRONTEND_BASE_URL", message)

    def test_the_escape_hatch_sends_anyway(self):
        run("--allow-dev-defaults")
        self.assertEqual(len(mail.outbox), 1)

    def test_dry_run_still_rehearses_on_defaults(self):
        """
        Rehearsing locally is the point of --dry-run, so it must not be blocked
        by a guard that only exists to stop real mail leaving.
        """
        output = run("--dry-run")
        self.assertEqual(mail.outbox, [])
        self.assertIn("1 reminder(s) to send", output)
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)
