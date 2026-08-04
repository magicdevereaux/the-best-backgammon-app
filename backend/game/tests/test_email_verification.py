"""
Email verification (ADR-003): proving that an account's address is real.

**What this feature is for is deliverability, not security.** Nothing here gates
login, play, password reset or deletion — an unverified account is a completely
working account, and that is the design, because a verification wall on a game
with a 48-hour forfeit clock would lock players out of live matches they are
losing on time. Exactly one thing consults it: ``manage.py send_turn_reminders``,
which is this app's only bulk, scheduled, unprompted sender. Mailing "move now or
lose" to every typo and abandoned mailbox earns bounces and spam complaints, and
those sink the sending domain for the players who *did* confirm. So the tests
that matter most are the two ends of that sentence — the confirm flow works, and
the cron respects it (``RemindersRequireVerificationTest``).

**The load-bearing design choice is that the address travels inside the token**,
not just the user id. A bare "user N asked to verify" token, followed after a
change of address, would stamp the *new* mailbox as proven on the strength of
mail delivered to the *old* one — a self-serve way to mark an address you do not
control as confirmed. ``ChangeOfAddressTest`` is that whole class of bug.

The mirror image is ``EmailVerification.verified_email``: a bare boolean would
stay True after ``PATCH /api/auth/me/`` moved the address, so the model stores
which address was proven and compares it to the live one on every read. Changing
your email un-verifies you with nothing to remember to call —
``ChangeOfAddressTest.test_changing_the_address_un_verifies_the_account``.

Django's test runner swaps in the locmem mail backend, so ``mail.outbox`` is the
assertion surface throughout, and throttling is off under test (see settings), so
the rate limits on these two endpoints are not what any 429 below is about — the
per-account ``last_sent_at`` cool-down is.

Run with:
    cd backend && venv/Scripts/python.exe manage.py test game.tests.test_email_verification
"""

import re
from datetime import timedelta
from io import StringIO

from django.conf import settings
from django.contrib.auth.models import User
from django.core import mail, signing
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from game.game_logic import get_initial_board_state
from game.models import EmailVerification, Game

CONFIRM_URL = "/api/auth/verify-email/confirm/"
RESEND_URL = "/api/auth/verify-email/resend/"
REGISTER_URL = "/api/auth/register/"
ME_URL = "/api/auth/me/"

PASSWORD = "securepass123"

# The one sentence every rejected token gets, whatever was wrong with it. Kept
# here as a constant so a test that expects a *different* message has to say so
# out loud — see BadTokenTest for why they are deliberately indistinguishable.
INVALID = "This verification link is invalid or has expired."

# What a configured deployment looks like. `send_turn_reminders` refuses to run
# while FRONTEND_BASE_URL / DEFAULT_FROM_EMAIL are at their dev defaults, so the
# class that drives the cron has to stand in for a real deployment. The
# verification endpoints have no such guard — they are user-initiated and
# one-at-a-time, not a scheduled blast — so only the reminder class wears this.
PRODUCTION_MAIL = override_settings(
    FRONTEND_BASE_URL="https://play.example.com",
    DEFAULT_FROM_EMAIL="Backgammon <no-reply@play.example.com>",
)


def register(client, username="alice", email=None, password=PASSWORD):
    """Create an account through the real front door, mail and all."""
    return client.post(
        REGISTER_URL,
        {
            "username": username,
            "password": password,
            "email": f"{username}@example.com" if email is None else email,
        },
        format="json",
    )


def make_user(username="alice", email=None):
    """
    An account created *around* the registration endpoint.

    Used wherever the test is not about registration itself, because
    ``RegisterView`` mails immediately and stamps ``last_sent_at``, which would
    silently put the very next send inside the cool-down and turn an assertion
    about some other behaviour into an assertion about timing.
    """
    return User.objects.create_user(
        username=username,
        password=PASSWORD,
        email=f"{username}@example.com" if email is None else email,
    )


def auth(user):
    """
    An authenticated client, on a **freshly loaded** copy of the user.

    ``force_authenticate`` pins one Python object as ``request.user`` for the
    life of the client, and ``EmailVerification.is_verified`` reads a reverse
    one-to-one, which Django caches on the instance the first time it is
    touched. A real request builds a new ``User`` from the token every time, so
    reusing a stale instance here would report a verification state the server
    would never actually report. See ``mark_verified``, which drops the same
    cache for clients that outlive the change.
    """
    client = APIClient()
    client.force_authenticate(user=User.objects.get(pk=user.pk))
    return client


def token_from_outbox(index=-1):
    """
    Pull the token back out of a sent message.

    Deliberately parsed from the mail body rather than rebuilt with
    ``build_email_verification_token``: a token this suite minted itself would
    still pass every test if the link in the email were malformed, truncated or
    built from the wrong user, and that email is the only copy the player ever
    sees.
    """
    body = mail.outbox[index].body
    match = re.search(r"/verify-email/(\S+)", body)
    assert match, f"no verification link in email body: {body!r}"
    return match.group(1)


def mark_verified(user):
    """
    Stamp the current address as proven, without going through the endpoint.

    ``refresh_from_db`` at the end is not decoration: it drops the cached
    reverse one-to-one on the in-memory instance, which a client built by
    ``auth`` before this call is still holding as ``request.user``. Without it a
    test would be asserting against a snapshot of the row taken before it was
    written, and would read as an implementation bug rather than a fixture one.
    """
    row = EmailVerification.for_user(user)
    row.verified_email = (user.email or "").strip()
    row.verified_at = timezone.now()
    row.save(update_fields=["verified_email", "verified_at", "updated_at"])
    user.refresh_from_db()
    return user


def expire_cooldown(user):
    """Backdate ``last_sent_at`` past the resend cool-down."""
    EmailVerification.objects.filter(user=user).update(
        last_sent_at=timezone.now()
        - timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS + 60)
    )


class RegistrationTest(TestCase):
    """
    Registering asks for confirmation, and asks *once*.

    The account is usable straight away — tokens are returned, nothing is held
    back — so the only observable difference between a fresh account and a
    confirmed one is the ``email_verified`` flag and whether the cron will mail
    it. Both are pinned here.
    """

    def setUp(self):
        self.client = APIClient()

    def test_registering_sends_exactly_one_verification_mail(self):
        resp = register(self.client)
        self.assertEqual(resp.status_code, 201, resp.json())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])

    def test_the_mail_goes_to_the_address_that_was_registered(self):
        """
        Not to ``user.email`` as the test happens to know it — to the address in
        the payload, normalised the same way the account stored it. A mismatch
        here would mean confirming an address by mailing a different one.
        """
        register(self.client, email=" Alice@EXAMPLE.COM ")
        self.assertEqual(mail.outbox[0].to, ["Alice@example.com"])
        self.assertEqual(User.objects.get(username="alice").email, "Alice@example.com")

    def test_a_new_account_starts_unverified(self):
        resp = register(self.client)
        self.assertFalse(resp.json()["user"]["email_verified"])

        me = auth(User.objects.get(username="alice")).get(ME_URL)
        self.assertFalse(me.json()["email_verified"])

    def test_registration_still_returns_a_working_token_pair(self):
        """
        The half of ADR-003 that is easy to regress by "tightening" it: an
        unverified account is a *working* account. Gating play behind a click in
        a mailbox would strand players in live games on a 48-hour clock.
        """
        resp = register(self.client)
        self.assertIn("access", resp.json())

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.json()['access']}")
        self.assertEqual(client.get(ME_URL).status_code, 200)

    @override_settings(FRONTEND_BASE_URL="https://play.example.com")
    def test_the_mail_links_to_the_web_client_with_the_token_as_a_path_segment(self):
        """
        Shape: ``{FRONTEND_BASE_URL}/verify-email/{token}``, matching the reset
        link so a client router binds the token as an ordinary route param.
        There is still no mobile deep link, so this always lands on web.
        """
        register(self.client)
        body = mail.outbox[0].body
        token = token_from_outbox()
        self.assertIn(f"https://play.example.com/verify-email/{token}", body)

    def test_the_mail_says_how_long_the_link_is_good_for(self):
        """
        A link that expires silently is a support ticket. The number comes from
        the setting rather than a hardcoded sentence, so changing the window
        cannot leave the mail lying about it.
        """
        with override_settings(EMAIL_VERIFICATION_TIMEOUT_HOURS=6):
            register(self.client)
        self.assertIn("6 hours", mail.outbox[0].body)

    def test_a_rejected_registration_mails_nobody(self):
        """The send hangs off a successful save, not off the request arriving."""
        resp = register(self.client, password="short")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(mail.outbox, [])

    def test_registering_records_the_send_for_the_cool_down(self):
        """
        ``last_sent_at`` is stamped here, which is what makes an immediate
        Resend a 429 rather than a second identical mail — see ResendTest.
        """
        register(self.client)
        row = EmailVerification.objects.get(user__username="alice")
        self.assertIsNotNone(row.last_sent_at)
        self.assertIsNone(row.verified_at)


class ConfirmTest(TestCase):
    """The link works, and keeps working when it is clicked twice."""

    def setUp(self):
        self.client = APIClient()
        register(self.client)
        self.user = User.objects.get(username="alice")
        self.token = token_from_outbox()

    def confirm(self, token=None):
        return self.client.post(
            CONFIRM_URL, {"token": self.token if token is None else token},
            format="json",
        )

    def test_posting_the_token_confirms_the_address(self):
        resp = self.confirm()
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertTrue(resp.json()["email_verified"])
        self.assertEqual(resp.json()["email"], "alice@example.com")

    def test_the_profile_endpoint_reports_it_afterwards(self):
        """
        The response above is a courtesy; ``GET /api/auth/me/`` is what both
        clients actually re-read to decide whether to keep nagging.
        """
        self.assertFalse(auth(self.user).get(ME_URL).json()["email_verified"])
        self.confirm()
        # A fresh client, because a real client re-reads the profile over a new
        # request with a newly loaded user — see `auth`.
        self.assertTrue(auth(self.user).get(ME_URL).json()["email_verified"])

    def test_it_stamps_which_address_was_proven_not_just_that_one_was(self):
        """
        The stored address is the entire mechanism behind un-verification on
        change (see ChangeOfAddressTest). A row with a timestamp and a blank
        ``verified_email`` would read as verified forever and could never be
        invalidated.
        """
        self.confirm()
        row = EmailVerification.objects.get(user=self.user)
        self.assertEqual(row.verified_email, "alice@example.com")
        self.assertIsNotNone(row.verified_at)

    def test_confirming_needs_no_session(self):
        """
        The link is followed from a mail client, quite possibly on a device that
        has never logged in. Requiring auth would make the common case fail, and
        the token already proves the only thing this endpoint cares about.
        """
        anonymous = APIClient()
        resp = anonymous.post(CONFIRM_URL, {"token": self.token}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())

    def test_posting_the_same_token_twice_is_200_both_times(self):
        """
        Idempotence, and it is not a nicety: mail clients prefetch links, people
        double-click, and a browser back-button re-submits. If the second call
        were an error, the user would be told verification failed at the exact
        moment it had already worked, and would go round the loop again.
        """
        first = self.confirm()
        second = self.confirm()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200, second.json())
        self.assertTrue(second.json()["email_verified"])
        self.assertEqual(EmailVerification.objects.filter(user=self.user).count(), 1)

    def test_confirming_sends_no_further_mail(self):
        mail.outbox.clear()
        self.confirm()
        self.assertEqual(mail.outbox, [])

    def test_a_missing_token_field_is_a_400(self):
        resp = self.client.post(CONFIRM_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("token", resp.json())

    def test_confirming_does_not_disturb_the_password(self):
        """
        Unlike the password-reset confirm, nothing about a credential changed
        here, so no session is invalidated and no password is touched. Pinned
        because the two views are deliberately shaped alike and it would be easy
        to copy the blacklisting across.
        """
        self.confirm()
        login = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(login.status_code, 200)


class BadTokenTest(TestCase):
    """
    Every way a token can be bad answers with the *same* flat message.

    "Expired", "forged" and "wrong account" all mean "this link is no good, get
    another one" to the person reading it, and splitting them would tell someone
    probing the endpoint which of their guesses was structurally valid. Each
    test below therefore asserts the message as well as the status — a future
    change that helpfully distinguished them would pass a bare 400 assertion.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def confirm(self, token):
        return self.client.post(CONFIRM_URL, {"token": token}, format="json")

    def assert_refused(self, resp):
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["token"], [INVALID])
        self.assertFalse(EmailVerification.is_verified(self.user))

    def valid_payload(self):
        return {"uid": self.user.pk, "email": self.user.email}

    def test_garbage_is_refused(self):
        self.assert_refused(self.confirm("not-a-token-at-all"))

    def test_a_tampered_token_is_refused(self):
        good = signing.dumps(
            self.valid_payload(), salt=settings.EMAIL_VERIFICATION_SALT
        )
        flipped = good[:-1] + ("a" if good[-1] != "a" else "b")
        self.assert_refused(self.confirm(flipped))

    def test_a_token_signed_with_another_salt_is_refused(self):
        """
        The salt namespaces this token to this purpose. Without it, a signed
        value minted anywhere else in the app — by any feature that ever signs a
        dict with a ``uid`` — would be accepted here as a verification link.
        """
        forged = signing.dumps(self.valid_payload(), salt="some-other-salt")
        self.assert_refused(self.confirm(forged))

    @override_settings(EMAIL_VERIFICATION_TIMEOUT_HOURS=-1)
    def test_an_expired_token_is_refused(self):
        """
        A negative window rather than zero, and for a real reason: Django signs
        a whole-second timestamp, so a token minted and checked inside the same
        second has an age of ``0.0``, which is not ``> 0`` and would sail
        through a zero-hour window. The same trick is used for
        ``PASSWORD_RESET_TIMEOUT=-1`` in test_password_reset.
        """
        token = signing.dumps(
            self.valid_payload(), salt=settings.EMAIL_VERIFICATION_SALT
        )
        self.assert_refused(self.confirm(token))

    def test_a_token_within_the_window_is_still_good(self):
        """The control for the test above — proves it fails on age, not shape."""
        token = signing.dumps(
            self.valid_payload(), salt=settings.EMAIL_VERIFICATION_SALT
        )
        with override_settings(EMAIL_VERIFICATION_TIMEOUT_HOURS=72):
            self.assertEqual(self.confirm(token).status_code, 200)

    def test_a_token_for_a_deleted_account_is_refused(self):
        """The account can be gone by the time the mail is opened."""
        token = signing.dumps(
            {"uid": 999999, "email": "ghost@example.com"},
            salt=settings.EMAIL_VERIFICATION_SALT,
        )
        self.assert_refused(self.confirm(token))

    def test_a_correctly_signed_non_dict_payload_is_refused(self):
        """
        Ours, unexpired, and still nonsense. Reached if the payload shape ever
        changes and an old token is still in flight; without the isinstance
        guard this is an ``AttributeError`` and a 500 rather than a 400.
        """
        token = signing.dumps("just-a-string", salt=settings.EMAIL_VERIFICATION_SALT)
        self.assert_refused(self.confirm(token))

    def test_a_token_with_no_email_in_it_is_refused(self):
        """
        The address is what the token is *for*. A payload carrying only a uid
        would verify whatever address the account happens to hold when the link
        is opened — which is exactly the change-of-address hole below.
        """
        token = signing.dumps(
            {"uid": self.user.pk}, salt=settings.EMAIL_VERIFICATION_SALT
        )
        self.assert_refused(self.confirm(token))


class ChangeOfAddressTest(TestCase):
    """
    The class of bug the whole design is shaped around.

    Two halves, and they fail in opposite directions if either is dropped: a
    stale token must not confirm a *new* address (mail went to the old mailbox),
    and a confirmed account must stop counting as confirmed the moment the
    address moves (the proof was about a different mailbox). Neither needs a
    signal, a hook or anything to remember to call — the address is in the token,
    and the proven address is on the row.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = make_user("alice", email="a@example.com")
        self.auth = auth(self.user)

    def issue_link(self):
        """Ask for a fresh confirmation mail and return its token."""
        expire_cooldown(self.user)
        resp = self.auth.post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        return token_from_outbox()

    def patch_email(self, address):
        """
        Change the account's address, with the resend cool-down cleared first.

        The cool-down is per *account*, not per endpoint, so a link requested a
        moment ago suppresses the mail a change of address would otherwise send
        — and ``MeView.perform_update`` discards the return value, so nothing in
        the response says so. That interaction is real and deliberate (it is
        what keeps this endpoint from being a one-a-second mailer), but it is
        not what any test in this class is about: leaving it in place would make
        "did the change re-mail?" and "was the account inside a cool-down?"
        indistinguishable, and the assertions below would silently stop testing
        the thing they name.
        """
        expire_cooldown(self.user)
        resp = self.auth.patch(ME_URL, {"email": address}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        self.user.refresh_from_db()
        return resp

    def test_a_token_for_the_old_address_will_not_confirm_the_new_one(self):
        """
        Request a link for a@…, change to b@…, then click the old link. The
        token verifies — it is genuinely ours and unexpired — but it names an
        address the account no longer holds, so it is refused rather than
        marking b@… proven on the strength of mail delivered to a@….

        Without this, anyone could mark an address they do not control as
        confirmed: ask for a link at your own mailbox, then repoint the account.
        """
        stale = self.issue_link()
        self.patch_email("b@example.com")

        resp = self.client.post(CONFIRM_URL, {"token": stale}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["token"], [INVALID])
        self.assertFalse(EmailVerification.is_verified(self.user))

    def test_the_link_sent_for_the_new_address_does_confirm_it(self):
        """The control: changing the address is not a dead end, just a re-do."""
        self.issue_link()
        mail.outbox.clear()
        self.patch_email("b@example.com")

        self.assertEqual(mail.outbox[0].to, ["b@example.com"])
        resp = self.client.post(
            CONFIRM_URL, {"token": token_from_outbox()}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertTrue(EmailVerification.is_verified(self.user))

    def test_changing_the_address_un_verifies_the_account(self):
        """
        The reason ``verified_email`` exists instead of a boolean. A flag would
        stay True across the PATCH and the very next cron tick would mail an
        unproven mailbox, with the flag insisting it was fine.
        """
        mark_verified(self.user)
        self.assertTrue(self.auth.get(ME_URL).json()["email_verified"])

        self.patch_email("b@example.com")
        self.assertFalse(self.auth.get(ME_URL).json()["email_verified"])

    def test_changing_the_address_mails_the_new_one_a_fresh_link(self):
        """
        Un-verifying without re-mailing would leave the user stuck: confirmed
        yesterday, silently unconfirmed today, with nothing telling them so.
        """
        mark_verified(self.user)
        mail.outbox.clear()

        self.patch_email("b@example.com")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["b@example.com"])

    def test_the_old_row_is_kept_rather_than_deleted(self):
        """
        Un-verification is derived, not destructive — the stale
        ``verified_email`` simply stops matching. That keeps ``last_sent_at`` on
        the same row, so the cool-down survives an address change and cannot be
        reset by repeatedly re-pointing the account.
        """
        mark_verified(self.user)
        self.patch_email("b@example.com")

        row = EmailVerification.objects.get(user=self.user)
        self.assertEqual(row.verified_email, "a@example.com")
        self.assertIsNotNone(row.verified_at)
        self.assertFalse(EmailVerification.is_verified(self.user))

    def test_re_sending_the_same_address_in_a_different_case_changes_nothing(self):
        """
        Both the comparison in ``perform_update`` and the one in ``is_verified``
        are case-folded, and both have to be. A client that helpfully re-submits
        the whole profile on every save would otherwise un-verify the user and
        mail them a link on each PATCH, purely because the field round-tripped
        through a different capitalisation.
        """
        mark_verified(self.user)
        mail.outbox.clear()

        self.patch_email("A@EXAMPLE.com")

        self.assertEqual(mail.outbox, [])
        self.assertTrue(self.auth.get(ME_URL).json()["email_verified"])

    def test_a_change_inside_the_cool_down_is_silently_not_mailed(self):
        """
        The sharp edge of sharing one cool-down between Resend and a change of
        address, pinned so it is a known trade-off rather than a surprise.

        Ask for a link, then correct a typo in the address within the minute:
        the account is now unverified at the new address with **no mail on the
        way**, and the PATCH answers a plain 200 because ``perform_update``
        ignores what ``issue_email_verification`` returned. The user is not
        stuck — Resend is one screen away and works as soon as the minute is up
        — but nothing tells them to press it.

        The alternative is worse: dropping the cool-down here would make an
        authenticated PATCH loop into an unmetered mailer aimed at any address
        the caller can type. If this is ever softened, soften it by surfacing
        the fact in the response, not by removing the cap.
        """
        self.issue_link()
        mail.outbox.clear()

        # Deliberately not `patch_email`, which clears the cool-down.
        resp = self.auth.patch(ME_URL, {"email": "b@example.com"}, format="json")

        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(mail.outbox, [])
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "b@example.com")
        self.assertFalse(EmailVerification.is_verified(self.user))

    def test_the_resend_button_recovers_from_that(self):
        """The reason the case above is a rough edge and not a dead end."""
        self.issue_link()
        self.auth.patch(ME_URL, {"email": "b@example.com"}, format="json")
        mail.outbox.clear()

        expire_cooldown(self.user)
        resp = self.auth.post(RESEND_URL, {}, format="json")

        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(mail.outbox[0].to, ["b@example.com"])
        confirmed = self.client.post(
            CONFIRM_URL, {"token": token_from_outbox()}, format="json"
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.json())

    def test_an_unrelated_patch_neither_mails_nor_un_verifies(self):
        """A reminder opt-out sends no address, so nothing about it moved."""
        mark_verified(self.user)
        mail.outbox.clear()

        resp = self.auth.patch(
            ME_URL, {"turn_reminder_emails": False}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(mail.outbox, [])
        self.assertTrue(resp.json()["email_verified"])


class ResendTest(TestCase):
    """
    The escape hatch for a mail that never arrived — and the one endpoint here
    that can be made to send on demand, so the cool-down is the subject as much
    as the sending is.

    Authenticated, unlike every other mail-sending endpoint in this app, which
    is what spares it an anti-enumeration problem: it can only ever mail the
    address on the caller's own account. The abuse it *does* have is the owner
    hammering their own inbox, capped by ``EmailVerification.last_sent_at``
    rather than by the throttle alone — throttle counters live in ``CACHES``,
    which is per-gunicorn-worker ``LocMemCache`` unless ``REDIS_URL`` is set, so
    on the deployment as configured today the throttle is not actually a global
    limit. The row is.
    """

    def setUp(self):
        self.user = make_user()
        self.auth = auth(self.user)

    def test_anonymous_callers_are_refused(self):
        resp = APIClient().post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(mail.outbox, [])

    def test_an_account_with_no_address_is_told_to_add_one(self):
        """
        Registration requires an address now, but accounts predating that keep
        their blank one and this endpoint is reachable from their settings
        screen. Sending would be a no-op with a success message.
        """
        old = make_user("bob", email="")
        resp = auth(old).post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("detail", resp.json())
        self.assertEqual(mail.outbox, [])

    def test_a_first_resend_sends_exactly_one_mail(self):
        resp = self.auth.post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertFalse(resp.json()["email_verified"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])

    def test_an_immediate_second_resend_is_a_429_and_sends_nothing(self):
        """
        The cool-down, and the reason it answers 429 rather than a cheerful 200:
        a user who is told "sent!" and gets nothing will press the button again,
        and a silent no-op turns the retry into a loop.
        """
        self.auth.post(RESEND_URL, {}, format="json")
        resp = self.auth.post(RESEND_URL, {}, format="json")

        self.assertEqual(resp.status_code, 429)
        self.assertIn("detail", resp.json())
        self.assertEqual(len(mail.outbox), 1)

    def test_it_sends_again_once_the_cool_down_has_passed(self):
        self.auth.post(RESEND_URL, {}, format="json")
        expire_cooldown(self.user)

        resp = self.auth.post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(len(mail.outbox), 2)

    def test_the_second_mail_carries_a_working_token(self):
        """
        A resend that mailed a stale or unusable link would be worse than no
        resend at all, since it is the recovery path for the first one.
        """
        self.auth.post(RESEND_URL, {}, format="json")
        expire_cooldown(self.user)
        self.auth.post(RESEND_URL, {}, format="json")

        resp = APIClient().post(
            CONFIRM_URL, {"token": token_from_outbox()}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())

    def test_an_already_verified_account_gets_a_200_and_no_mail(self):
        """
        Not an error. Clicking Resend after the link already worked in another
        tab is not a mistake, and answering 4xx would suggest to a verified user
        that their account is not.
        """
        mark_verified(self.user)
        resp = self.auth.post(RESEND_URL, {}, format="json")

        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertTrue(resp.json()["email_verified"])
        self.assertEqual(mail.outbox, [])

    def test_the_already_verified_answer_beats_the_cool_down(self):
        """
        Order of the guards: verified is checked before the cool-down, so a
        verified user who taps Resend inside a minute is told they are done
        rather than told to wait for a mail they do not need.
        """
        self.auth.post(RESEND_URL, {}, format="json")
        mark_verified(self.user)

        # A fresh client: the first POST above cached the (then unverified) row
        # on this client's pinned user object, which a real request would have
        # rebuilt from the token. See `auth`.
        resp = auth(self.user).post(RESEND_URL, {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertTrue(resp.json()["email_verified"])
        self.assertEqual(len(mail.outbox), 1)

    def test_it_only_ever_mails_the_caller(self):
        """
        There is no body, deliberately. The address comes from
        ``request.user``, so this endpoint is structurally incapable of being
        pointed at a third party's inbox — which is the whole reason it can be a
        simple authenticated POST instead of the flat-wall shape
        ``PasswordResetRequestView`` needs.
        """
        make_user("bob")
        resp = self.auth.post(
            RESEND_URL, {"email": "bob@example.com"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.json())
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])


@PRODUCTION_MAIL
class RemindersRequireVerificationTest(TestCase):
    """
    The point of the whole feature: ``manage.py send_turn_reminders`` mails
    confirmed addresses only.

    This is the app's entire notification layer and its only bulk sender, so
    every unconfirmed address it touches is a probable bounce, and bounces at
    volume sink the sending domain for the players who did confirm. The gate
    lives in the command rather than in the candidate query on purpose — the SQL
    narrows, the per-row check decides — so it is asserted here against the
    command's actual behaviour.

    The second, subtler property is that a skip **does not stamp**
    ``turn_reminder_sent_at``. That field means "already mailed for this turn",
    and it is cleared only when the turn changes; recording a mail that never
    left would silence this turn for good, so a player who confirms their
    address five minutes later would get nothing until their *next* turn — on a
    48-hour clock, quite possibly never in time. Same reasoning as the opt-out
    skip in ``test_turn_reminders.OptOutTest``.
    """

    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.game = self.make_aged_game()

    def make_aged_game(self):
        """A live game whose clock has run 40 of its 48 hours — inside the lead."""
        game = Game.objects.create(
            player1_user=self.alice,
            player2_user=self.bob,
            player1_name="alice",
            player2_name="bob",
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status="active",
            turn_started_at=timezone.now(),
        )
        Game.objects.filter(pk=game.pk).update(
            turn_started_at=timezone.now() - timedelta(hours=40)
        )
        game.refresh_from_db()
        return game

    def run_command(self, *args):
        out = StringIO()
        call_command("send_turn_reminders", *args, stdout=out)
        return out.getvalue()

    def test_an_unverified_player_is_not_reminded(self):
        self.assertFalse(EmailVerification.is_verified(self.alice))
        self.run_command()
        self.assertEqual(mail.outbox, [])

    def test_the_skip_does_not_burn_the_turn_s_reminder(self):
        self.run_command()
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)

    def test_confirming_makes_the_next_tick_mail_them(self):
        """
        The pair that matters end to end: skipped while unverified, mailed on
        the very next run once confirmed, with no intervening turn. If the skip
        stamped the row, this second run would be silent.
        """
        self.run_command()
        self.assertEqual(mail.outbox, [])

        mark_verified(self.alice)
        self.run_command()

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])

    def test_a_verified_player_who_then_moves_address_stops_being_reminded(self):
        """
        The un-verification rule reaching the cron, which is the only place it
        has any consequences. Nothing clears a flag — the proven address simply
        stops matching the live one — so this is the test that would catch a
        "simplify it to a boolean" refactor.
        """
        mark_verified(self.alice)
        auth(self.alice).patch(ME_URL, {"email": "moved@example.com"}, format="json")
        mail.outbox.clear()

        self.run_command()

        self.assertEqual(mail.outbox, [])
        self.game.refresh_from_db()
        self.assertIsNone(self.game.turn_reminder_sent_at)

    def test_only_the_unverified_seat_is_skipped(self):
        """
        Per-recipient, not per-run. One unconfirmed player must not silence the
        cron for everybody else on the tick.
        """
        mark_verified(self.bob)
        other = Game.objects.create(
            player1_user=self.bob,
            player2_user=self.alice,
            player1_name="bob",
            player2_name="alice",
            board_state=get_initial_board_state(),
            current_turn="p1",
            dice_values=[],
            status="active",
            turn_started_at=timezone.now(),
        )
        Game.objects.filter(pk=other.pk).update(
            turn_started_at=timezone.now() - timedelta(hours=40)
        )

        output = self.run_command()

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["bob@example.com"])
        self.assertIn("2 candidate(s)", output)
        self.assertIn("1 reminder(s) sent", output)

    def test_a_dry_run_also_respects_the_gate(self):
        """
        --dry-run is how an operator sanity-checks a cron before scheduling it.
        If it listed unverified recipients it would report a blast that the real
        run would never send, which is the wrong direction for a rehearsal.
        """
        output = self.run_command("--dry-run")
        self.assertEqual(mail.outbox, [])
        self.assertNotIn("alice@example.com", output)
