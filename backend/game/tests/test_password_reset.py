"""
Optional account email, and the API-shaped password reset built on top of it.

The flow under test is deliberately *not* Django's HTML password-reset views:
this backend has no session login and no server-rendered pages, so reset is two
JSON endpoints and the client owns the page the link lands on.

Django's test runner swaps EMAIL_BACKEND for the locmem backend, so
``mail.outbox`` is the sent-mail assertion surface throughout.
"""

import re

from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

RESET_URL = "/api/auth/password-reset/"
CONFIRM_URL = "/api/auth/password-reset/confirm/"
ME_URL = "/api/auth/me/"

PASSWORD = "securepass123"
NEW_PASSWORD = "brandnewpass456"


def make_user(username="alice", password=PASSWORD, email="alice@example.com"):
    return User.objects.create_user(username=username, password=password, email=email)


def link_from_outbox(index=0):
    """Pull the reset URL out of a sent message body."""
    match = re.search(r"(https?://\S+)", mail.outbox[index].body)
    assert match, f"no URL in email body: {mail.outbox[index].body!r}"
    return match.group(1)


def uid_token_from_outbox(index=0):
    """Split ``.../reset-password/<uid>/<token>`` back into its two params."""
    uid, token = link_from_outbox(index).rstrip("/").split("/")[-2:]
    return uid, token


class RegistrationEmailTest(TestCase):
    """Email is optional; registration without one must behave as it always has."""

    def setUp(self):
        self.client = APIClient()

    def test_register_without_email_still_works(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(User.objects.get(username="alice").email, "")

    def test_register_with_email_stores_it(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": PASSWORD, "email": "alice@example.com"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(User.objects.get(username="alice").email, "alice@example.com")
        self.assertEqual(resp.json()["user"]["email"], "alice@example.com")

    def test_register_normalises_the_domain_half(self):
        self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": PASSWORD, "email": " Alice@EXAMPLE.COM "},
            format="json",
        )
        # Domain folded, local part left alone (it is case-sensitive per RFC).
        self.assertEqual(User.objects.get(username="alice").email, "Alice@example.com")

    def test_register_rejects_a_malformed_email(self):
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "alice", "password": PASSWORD, "email": "not-an-address"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("email", resp.json())
        self.assertFalse(User.objects.filter(username="alice").exists())

    def test_duplicate_email_is_allowed(self):
        make_user("alice")
        resp = self.client.post(
            "/api/auth/register/",
            {"username": "bob", "password": PASSWORD, "email": "alice@example.com"},
            format="json",
        )
        # Rejecting it would need a migration *and* would leak which addresses
        # are registered.
        self.assertEqual(resp.status_code, 201)


class MeEmailTest(TestCase):
    """Accounts created before this field existed need a way to add an address."""

    def setUp(self):
        self.client = APIClient()
        self.user = make_user(email="")
        self.client.force_authenticate(user=self.user)

    def test_get_me_exposes_email(self):
        resp = self.client.get(ME_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "")

    def test_patch_me_sets_email(self):
        resp = self.client.patch(ME_URL, {"email": "Alice@EXAMPLE.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "Alice@example.com")
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "Alice@example.com")

    def test_patch_me_can_clear_email(self):
        self.user.email = "alice@example.com"
        self.user.save()
        resp = self.client.patch(ME_URL, {"email": ""}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "")

    def test_patch_me_rejects_a_malformed_email(self):
        resp = self.client.patch(ME_URL, {"email": "nope"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_patch_me_cannot_change_username(self):
        resp = self.client.patch(ME_URL, {"username": "mallory"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "alice")

    def test_patch_me_requires_authentication(self):
        anon = APIClient()
        resp = anon.patch(ME_URL, {"email": "x@example.com"}, format="json")
        self.assertEqual(resp.status_code, 401)


class PasswordResetRequestTest(TestCase):
    """The request endpoint must be a flat wall: same answer, hit or miss."""

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_known_address_sends_mail(self):
        resp = self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])

    def test_unknown_address_returns_the_identical_response_and_sends_nothing(self):
        hit = self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        mail.outbox.clear()
        miss = self.client.post(RESET_URL, {"email": "nobody@example.com"}, format="json")

        self.assertEqual(miss.status_code, hit.status_code)
        self.assertEqual(miss.json(), hit.json())
        self.assertEqual(len(mail.outbox), 0)

    def test_address_with_no_account_at_all_still_200s(self):
        resp = self.client.post(RESET_URL, {"email": "ghost@example.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("detail", resp.json())

    def test_lookup_is_case_insensitive(self):
        resp = self.client.post(RESET_URL, {"email": "ALICE@example.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_accounts_with_no_email_are_not_matched_by_a_blank_request(self):
        User.objects.create_user(username="bob", password=PASSWORD)
        resp = self.client.post(RESET_URL, {"email": ""}, format="json")
        # EmailField rejects a blank; crucially it never reaches the query,
        # which would otherwise match every address-less account.
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_missing_email_field_is_a_400(self):
        resp = self.client.post(RESET_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_shared_address_mails_every_account(self):
        User.objects.create_user(
            username="bob", password=PASSWORD, email="alice@example.com"
        )
        self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        self.assertEqual(len(mail.outbox), 2)

    def test_inactive_account_is_not_mailed(self):
        self.user.is_active = False
        self.user.save()
        resp = self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(FRONTEND_BASE_URL="https://play.example.com")
    def test_email_contains_a_link_of_the_documented_shape(self):
        self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        link = link_from_outbox()

        uid, token = uid_token_from_outbox()
        self.assertEqual(
            link, f"https://play.example.com/reset-password/{uid}/{token}"
        )
        self.assertEqual(uid, urlsafe_base64_encode(force_bytes(self.user.pk)))
        self.assertTrue(default_token_generator.check_token(self.user, token))


class PasswordResetConfirmTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()
        self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        self.uid, self.token = uid_token_from_outbox()
        mail.outbox.clear()

    def confirm(self, **overrides):
        payload = {
            "uid": self.uid,
            "token": self.token,
            "new_password": NEW_PASSWORD,
        }
        payload.update(overrides)
        return self.client.post(CONFIRM_URL, payload, format="json")

    def login(self, password):
        return self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": password},
            format="json",
        )

    def test_valid_token_resets_the_password(self):
        resp = self.confirm()
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))

    def test_new_password_logs_in_and_old_one_stops_working(self):
        self.confirm()
        self.assertEqual(self.login(NEW_PASSWORD).status_code, 200)
        self.assertEqual(self.login(PASSWORD).status_code, 401)

    def test_token_is_single_use(self):
        self.assertEqual(self.confirm().status_code, 200)
        # The generator hashes the current password hash into the token, so
        # writing a new password retires every token minted against the old one.
        second = self.confirm(new_password="thirdpassword789")
        self.assertEqual(second.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))

    def test_tampered_token_is_rejected(self):
        resp = self.confirm(token=self.token[:-1] + ("a" if self.token[-1] != "a" else "b"))
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_garbage_uid_is_rejected(self):
        self.assertEqual(self.confirm(uid="!!!not-base64!!!").status_code, 400)

    def test_uid_for_a_nonexistent_user_is_rejected(self):
        resp = self.confirm(uid=urlsafe_base64_encode(force_bytes(999999)))
        self.assertEqual(resp.status_code, 400)

    def test_uid_and_token_from_different_users_are_rejected(self):
        other = User.objects.create_user(
            username="bob", password=PASSWORD, email="bob@example.com"
        )
        resp = self.confirm(uid=urlsafe_base64_encode(force_bytes(other.pk)))
        self.assertEqual(resp.status_code, 400)
        other.refresh_from_db()
        self.assertTrue(other.check_password(PASSWORD))

    @override_settings(PASSWORD_RESET_TIMEOUT=-1)
    def test_expired_token_is_rejected(self):
        resp = self.confirm()
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_short_password_is_rejected(self):
        resp = self.confirm(new_password="short")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())

    def test_common_password_is_rejected_by_the_validators(self):
        # `create_user` does not run AUTH_PASSWORD_VALIDATORS; the serializer
        # invokes them explicitly, exactly as RegisterSerializer does.
        resp = self.confirm(new_password="password")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_numeric_password_is_rejected_by_the_validators(self):
        resp = self.confirm(new_password="9182736450")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())

    def test_password_similar_to_the_username_is_rejected(self):
        # Proves the real User instance is handed to the validators —
        # UserAttributeSimilarityValidator is a no-op without one.
        user = User.objects.create_user(
            username="strawberry", password=PASSWORD, email="berry@example.com"
        )
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        resp = self.client.post(
            CONFIRM_URL,
            {"uid": uid, "token": token, "new_password": "strawberry1"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.json())

    def test_bad_token_is_checked_before_the_password(self):
        # A rejected link must not hand back password-policy feedback.
        resp = self.confirm(uid="!!!", new_password="password")
        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("new_password", resp.json())

    def test_reset_does_not_send_further_mail(self):
        self.confirm()
        self.assertEqual(len(mail.outbox), 0)


class PasswordResetBlacklistTest(TestCase):
    """A reset that leaves stolen sessions alive is not a reset."""

    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_outstanding_refresh_tokens_are_blacklisted(self):
        tokens = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": PASSWORD},
            format="json",
        ).json()
        refresh = tokens["refresh"]

        # Sanity: the token works before the reset.
        before = self.client.post(
            "/api/auth/refresh/", {"refresh": refresh}, format="json"
        )
        self.assertEqual(before.status_code, 200)

        self.client.post(RESET_URL, {"email": "alice@example.com"}, format="json")
        uid, token = uid_token_from_outbox()
        resp = self.client.post(
            CONFIRM_URL,
            {"uid": uid, "token": token, "new_password": NEW_PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        after = self.client.post(
            "/api/auth/refresh/", {"refresh": refresh}, format="json"
        )
        self.assertEqual(after.status_code, 401)

    def test_a_failed_reset_leaves_sessions_alone(self):
        refresh = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": PASSWORD},
            format="json",
        ).json()["refresh"]

        self.client.post(
            CONFIRM_URL,
            {"uid": "!!!", "token": "nope", "new_password": NEW_PASSWORD},
            format="json",
        )

        still_valid = self.client.post(
            "/api/auth/refresh/", {"refresh": refresh}, format="json"
        )
        self.assertEqual(still_valid.status_code, 200)
