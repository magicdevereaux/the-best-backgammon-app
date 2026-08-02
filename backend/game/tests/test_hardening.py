"""
Security-hardening tests: the holes closed before hosting this app publicly.

Covers six fixes, one class group each:

  1. PUT / PATCH / DELETE are off the routed surface for games and matches
     (they used to be live and unguarded on a plain ModelViewSet).
  2. `next_game` enforces match participation, like the five gameplay actions.
  3. Registration runs Django's AUTH_PASSWORD_VALIDATORS.
  4. List endpoints are paginated — while still returning a bare JSON array,
     because both clients consume them as arrays.
  5. Login, register and refresh carry scoped rate limits.
  6. The admin mount point is env-driven (ADMIN_URL), defaulting to "admin".

Throttle rates are disabled for the test suite in settings, so the throttling
tests re-enable them with @override_settings. That only works because
`OptionalScopedRateThrottle.get_rate` reads `api_settings` per request instead
of the import-time class attribute DRF's SimpleRateThrottle uses.
"""
import copy
import importlib
import os
from contextlib import contextmanager
from unittest import mock

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import clear_url_caches
from rest_framework.test import APIClient

import backgammon.urls as root_urlconf
from backgammon.settings import env_url_path

from game.game_logic import get_initial_board_state
from game.models import Game, Match


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def empty_board():
    return {"points": [0] * 24, "bar": {"p1": 0, "p2": 0}, "off": {"p1": 0, "p2": 0}}


def make_game(status="active", p1_user=None, p2_user=None, p1="Alice", p2="Bob"):
    return Game.objects.create(
        player1_user=p1_user,
        player2_user=p2_user,
        player1_name=p1,
        player2_name=p2,
        board_state=get_initial_board_state(),
        current_turn="p1",
        dice_values=[],
        status=status,
    )


def make_match_with_finished_game(p1_user=None, p2_user=None, target_points=5):
    """A match whose only game is finished — i.e. ready for next_game."""
    match = Match.objects.create(
        target_points=target_points,
        player1_name="Alice",
        player2_name="Bob",
        player1_user=p1_user,
        player2_user=p2_user,
    )
    board = empty_board()
    board["off"]["p1"] = 15
    Game.objects.create(
        match=match,
        player1_user=p1_user,
        player2_user=p2_user,
        player1_name="Alice",
        player2_name="Bob",
        board_state=board,
        current_turn="p1",
        dice_values=[],
        status="finished",
        winner="p1",
        win_type="normal",
        points_value=1,
    )
    return match


def rest_framework_with_rates(**rates):
    """settings.REST_FRAMEWORK with specific throttle scopes re-enabled."""
    conf = copy.deepcopy(settings.REST_FRAMEWORK)
    conf["DEFAULT_THROTTLE_RATES"] = {
        **conf.get("DEFAULT_THROTTLE_RATES", {}),
        **rates,
    }
    return conf


# ---------------------------------------------------------------------------
# 1. Unguarded write verbs are gone
# ---------------------------------------------------------------------------

class WriteVerbsRemovedTest(TestCase):
    """
    /api/games/{id}/ and /api/matches/{id}/ used to accept PUT/PATCH/DELETE with
    no permission check whatsoever — anyone could rewrite a board or delete
    another player's game. All legitimate mutation goes through the seat-checked
    custom actions, so the generic verbs are no longer routed at all.
    """

    def setUp(self):
        self.client = APIClient()
        self.game = make_game()
        self.match = make_match_with_finished_game()

    def test_game_put_returns_405(self):
        res = self.client.put(
            f"/api/games/{self.game.id}/", {"player1_name": "Mallory"}, format="json"
        )
        self.assertEqual(res.status_code, 405)

    def test_game_patch_returns_405(self):
        res = self.client.patch(
            f"/api/games/{self.game.id}/", {"player1_name": "Mallory"}, format="json"
        )
        self.assertEqual(res.status_code, 405)

    def test_game_delete_returns_405_and_game_survives(self):
        res = self.client.delete(f"/api/games/{self.game.id}/")
        self.assertEqual(res.status_code, 405)
        self.assertTrue(Game.objects.filter(pk=self.game.pk).exists())

    def test_game_delete_by_authenticated_owner_also_405(self):
        """Not even the owner gets the generic delete — nothing needs it."""
        user = User.objects.create_user(username="alice", password="s3cure-pass-xyz")
        self.game.player1_user = user
        self.game.save()
        self.client.force_authenticate(user=user)
        res = self.client.delete(f"/api/games/{self.game.id}/")
        self.assertEqual(res.status_code, 405)

    def test_match_put_returns_405(self):
        res = self.client.put(
            f"/api/matches/{self.match.id}/", {"player1_name": "Mallory"}, format="json"
        )
        self.assertEqual(res.status_code, 405)

    def test_match_patch_score_returns_405(self):
        res = self.client.patch(
            f"/api/matches/{self.match.id}/", {"player1_score": 99}, format="json"
        )
        self.assertEqual(res.status_code, 405)
        self.match.refresh_from_db()
        self.assertEqual(self.match.player1_score, 0)

    def test_match_delete_returns_405_and_match_survives(self):
        res = self.client.delete(f"/api/matches/{self.match.id}/")
        self.assertEqual(res.status_code, 405)
        self.assertTrue(Match.objects.filter(pk=self.match.pk).exists())


class SurvivingEndpointsSmokeTest(TestCase):
    """Everything the two clients actually call still works after the trim."""

    def setUp(self):
        self.client = APIClient()

    def test_game_list_retrieve_create_join_and_roll(self):
        create = self.client.post(
            "/api/games/", {"player1_name": "Alice"}, format="json"
        )
        self.assertEqual(create.status_code, 201)
        game_id = create.json()["id"]

        self.assertEqual(self.client.get("/api/games/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/games/{game_id}/").status_code, 200)

        join = self.client.post(
            f"/api/games/{game_id}/join/", {"player2_name": "Bob"}, format="json"
        )
        self.assertEqual(join.status_code, 200)

        roll = self.client.post(f"/api/games/{game_id}/roll_dice/")
        self.assertEqual(roll.status_code, 200)

    def test_match_list_retrieve_create_and_join(self):
        create = self.client.post(
            "/api/matches/", {"player1_name": "Alice", "target_points": 5}, format="json"
        )
        self.assertEqual(create.status_code, 201)
        match_id = create.json()["id"]

        self.assertEqual(self.client.get("/api/matches/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/matches/{match_id}/").status_code, 200)

        join = self.client.post(
            f"/api/matches/{match_id}/join/", {"player2_name": "Bob"}, format="json"
        )
        self.assertEqual(join.status_code, 200)


# ---------------------------------------------------------------------------
# 2. next_game participation check
# ---------------------------------------------------------------------------

class NextGamePermissionTest(TestCase):
    """
    next_game was the one match/game action with no ownership check: any caller,
    anonymous included, could advance any match. It now applies the match-level
    lift of the seat policy — allowed if the requester could act for either seat.
    """

    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(username="alice", password="s3cure-pass-xyz")
        self.bob = User.objects.create_user(username="bob", password="s3cure-pass-xyz")
        self.mallory = User.objects.create_user(username="mallory", password="s3cure-pass-xyz")

    def test_participant_may_advance_the_match(self):
        match = make_match_with_finished_game(p1_user=self.alice, p2_user=self.bob)
        self.client.force_authenticate(user=self.alice)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 201)

    def test_other_participant_may_also_advance_the_match(self):
        """It isn't a per-seat action — either player may start the next game."""
        match = make_match_with_finished_game(p1_user=self.alice, p2_user=self.bob)
        self.client.force_authenticate(user=self.bob)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 201)

    def test_stranger_gets_403(self):
        match = make_match_with_finished_game(p1_user=self.alice, p2_user=self.bob)
        self.client.force_authenticate(user=self.mallory)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not a participant", res.json()["error"])
        self.assertEqual(match.games.count(), 1)

    def test_anonymous_gets_403_when_both_seats_are_registered(self):
        match = make_match_with_finished_game(p1_user=self.alice, p2_user=self.bob)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("registered players", res.json()["error"])
        self.assertEqual(match.games.count(), 1)

    def test_anonymous_may_advance_a_fully_guest_match(self):
        """Hotseat/guest play has no server identity to verify — still allowed."""
        match = make_match_with_finished_game()
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 201)

    def test_anonymous_may_advance_a_match_with_one_guest_seat(self):
        """A logged-in host playing a guest opponent must keep working."""
        match = make_match_with_finished_game(p1_user=self.alice)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 201)

    def test_permission_is_checked_before_match_state(self):
        """A stranger gets 403, not a 400 that leaks the match's state."""
        match = make_match_with_finished_game(p1_user=self.alice, p2_user=self.bob)
        match.status = "finished"
        match.save()
        self.client.force_authenticate(user=self.mallory)
        res = self.client.post(f"/api/matches/{match.id}/next_game/")
        self.assertEqual(res.status_code, 403)


# ---------------------------------------------------------------------------
# 3. Password validators actually run
# ---------------------------------------------------------------------------

class RegisterPasswordValidationTest(TestCase):
    """
    RegisterSerializer called create_user directly, so the four configured
    AUTH_PASSWORD_VALIDATORS never ran and only min_length=8 applied.
    """

    def setUp(self):
        self.client = APIClient()

    def _register(self, username, password):
        return self.client.post(
            "/api/auth/register/",
            {"username": username, "password": password},
            format="json",
        )

    def test_strong_password_still_registers(self):
        res = self._register("alice", "quiet-harbour-97")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(User.objects.filter(username="alice").exists())

    def test_common_password_is_rejected(self):
        res = self._register("alice", "password")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(User.objects.filter(username="alice").exists())

    def test_all_numeric_password_is_rejected(self):
        res = self._register("alice", "9284756103")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.json())

    def test_password_similar_to_username_is_rejected(self):
        res = self._register("bartholomew", "bartholomew1")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.json())

    def test_errors_are_returned_as_drf_field_errors(self):
        """Clients read {field: [messages]}; Django's ValidationError shape isn't that."""
        res = self._register("alice", "password")
        body = res.json()
        self.assertIn("password", body)
        self.assertIsInstance(body["password"], list)
        self.assertTrue(all(isinstance(msg, str) for msg in body["password"]))

    def test_short_password_still_rejected_by_field_min_length(self):
        res = self._register("alice", "short")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.json())


# ---------------------------------------------------------------------------
# 4. Pagination (bare-array shape preserved)
# ---------------------------------------------------------------------------

class PaginationTest(TestCase):
    """
    GET /api/games/ returned the entire table. It is now capped at 100 rows per
    page — but still serialised as a bare array, because LobbyPage.jsx maps over
    the response and mobile's index.jsx drops anything failing Array.isArray.
    """

    PAGE_SIZE = 100

    def setUp(self):
        self.client = APIClient()

    def _bulk_games(self, count, status="waiting"):
        Game.objects.bulk_create([
            Game(
                player1_name=f"P{i}",
                player2_name="",
                board_state={},
                dice_values=[],
                status=status,
            )
            for i in range(count)
        ])

    def test_list_is_a_bare_array_not_an_envelope(self):
        self._bulk_games(3)
        body = self.client.get("/api/games/").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 3)

    def test_list_is_capped_at_one_page(self):
        self._bulk_games(self.PAGE_SIZE + 5)
        body = self.client.get("/api/games/").json()
        self.assertEqual(len(body), self.PAGE_SIZE)

    def test_second_page_returns_the_remainder(self):
        self._bulk_games(self.PAGE_SIZE + 5)
        body = self.client.get("/api/games/?page=2").json()
        self.assertEqual(len(body), 5)

    def test_pages_do_not_overlap(self):
        self._bulk_games(self.PAGE_SIZE + 5)
        page1 = {g["id"] for g in self.client.get("/api/games/").json()}
        page2 = {g["id"] for g in self.client.get("/api/games/?page=2").json()}
        self.assertEqual(len(page1 | page2), self.PAGE_SIZE + 5)
        self.assertEqual(page1 & page2, set())

    def test_page_size_query_param_is_honoured(self):
        self._bulk_games(10)
        body = self.client.get("/api/games/?page_size=4").json()
        self.assertEqual(len(body), 4)

    def test_page_size_is_capped_at_max_page_size(self):
        self._bulk_games(self.PAGE_SIZE + 5)
        body = self.client.get("/api/games/?page_size=100000").json()
        self.assertLessEqual(len(body), 200)

    def test_status_filter_still_applies_across_pages(self):
        self._bulk_games(4, status="waiting")
        self._bulk_games(3, status="active")
        body = self.client.get("/api/games/?status=waiting").json()
        self.assertEqual(len(body), 4)
        self.assertTrue(all(g["status"] == "waiting" for g in body))

    def test_match_list_is_paginated_and_still_an_array(self):
        Match.objects.bulk_create([
            Match(player1_name=f"P{i}", player2_name="Bob") for i in range(5)
        ])
        body = self.client.get("/api/matches/?page_size=2").json()
        self.assertIsInstance(body, list)
        self.assertEqual(len(body), 2)
        self.assertEqual(len(self.client.get("/api/matches/?page=3&page_size=2").json()), 1)

    def test_empty_list_is_still_an_empty_array(self):
        self.assertEqual(self.client.get("/api/games/").json(), [])


# ---------------------------------------------------------------------------
# 5. Auth throttling
# ---------------------------------------------------------------------------

class AuthThrottleConfigTest(TestCase):
    """The scope names are a contract with settings.DEFAULT_THROTTLE_RATES."""

    def test_login_view_declares_the_login_scope(self):
        from game.views import LoginView, OptionalScopedRateThrottle

        self.assertEqual(LoginView.throttle_scope, "login")
        self.assertIn(OptionalScopedRateThrottle, LoginView.throttle_classes)

    def test_register_view_declares_the_register_scope(self):
        from game.views import RegisterView, OptionalScopedRateThrottle

        self.assertEqual(RegisterView.throttle_scope, "register")
        self.assertIn(OptionalScopedRateThrottle, RegisterView.throttle_classes)

    def test_refresh_view_declares_the_refresh_scope(self):
        from game.views import RefreshView, OptionalScopedRateThrottle

        self.assertEqual(RefreshView.throttle_scope, "refresh")
        self.assertIn(OptionalScopedRateThrottle, RefreshView.throttle_classes)

    def test_refresh_url_is_wired_to_the_throttled_view(self):
        """
        The route used to point straight at SimpleJWT's TokenRefreshView, which
        carries no scope at all — an easy thing to regress back to.
        """
        from django.urls import resolve

        from game.views import RefreshView

        self.assertIs(resolve("/api/auth/refresh/").func.cls, RefreshView)

    def test_settings_define_all_three_scopes(self):
        rates = settings.REST_FRAMEWORK.get("DEFAULT_THROTTLE_RATES", {})
        self.assertIn("login", rates)
        self.assertIn("register", rates)
        self.assertIn("refresh", rates)

    def test_missing_rate_means_unthrottled_not_a_500(self):
        """A dropped rate key must not turn login into a server error."""
        with override_settings(REST_FRAMEWORK={"DEFAULT_THROTTLE_RATES": {}}):
            User.objects.create_user(username="alice", password="quiet-harbour-97")
            res = self.client.post(
                "/api/auth/login/",
                {"username": "alice", "password": "quiet-harbour-97"},
                format="json",
            )
            self.assertEqual(res.status_code, 200)


@override_settings(REST_FRAMEWORK=rest_framework_with_rates(login="3/min"))
class LoginThrottleTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        User.objects.create_user(username="alice", password="quiet-harbour-97")

    def tearDown(self):
        cache.clear()

    def _login(self, password="wrong-password-here"):
        return self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": password},
            format="json",
        )

    def test_repeated_failed_logins_are_throttled(self):
        for _ in range(3):
            self.assertEqual(self._login().status_code, 401)
        self.assertEqual(self._login().status_code, 429)

    def test_throttle_counts_successful_logins_too(self):
        for _ in range(3):
            self.assertEqual(self._login("quiet-harbour-97").status_code, 200)
        self.assertEqual(self._login("quiet-harbour-97").status_code, 429)


@override_settings(REST_FRAMEWORK=rest_framework_with_rates(register="2/min"))
class RegisterThrottleTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def test_bulk_account_creation_is_throttled(self):
        for i in range(2):
            res = self.client.post(
                "/api/auth/register/",
                {"username": f"user{i}", "password": "quiet-harbour-97"},
                format="json",
            )
            self.assertEqual(res.status_code, 201)

        res = self.client.post(
            "/api/auth/register/",
            {"username": "user99", "password": "quiet-harbour-97"},
            format="json",
        )
        self.assertEqual(res.status_code, 429)
        self.assertFalse(User.objects.filter(username="user99").exists())


@override_settings(REST_FRAMEWORK=rest_framework_with_rates(refresh="3/min"))
class RefreshThrottleTest(TestCase):
    """
    Refresh rotates (ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION), so a
    single valid refresh token can be spun into an unbroken chain of new tokens
    forever. Unthrottled that is an unbounded session for whoever holds it; the
    `refresh` scope caps the rotation rate.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        User.objects.create_user(username="alice", password="quiet-harbour-97")
        res = self.client.post(
            "/api/auth/login/",
            {"username": "alice", "password": "quiet-harbour-97"},
            format="json",
        )
        self.refresh = res.json()["refresh"]

    def tearDown(self):
        cache.clear()

    def _refresh(self, token):
        return self.client.post(
            "/api/auth/refresh/", {"refresh": token}, format="json"
        )

    def test_token_rotation_chain_is_throttled(self):
        token = self.refresh
        for _ in range(3):
            res = self._refresh(token)
            self.assertEqual(res.status_code, 200)
            token = res.json()["refresh"]

        self.assertEqual(self._refresh(token).status_code, 429)

    def test_invalid_refresh_attempts_are_throttled_too(self):
        """Throttling happens before token validation, so guessing is capped."""
        for _ in range(3):
            self.assertEqual(self._refresh("not-a-token").status_code, 401)
        self.assertEqual(self._refresh("not-a-token").status_code, 429)


class RefreshUnthrottledByDefaultInTestsTest(TestCase):
    """The suite-wide rate disable must keep normal refresh usage working."""

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        User.objects.create_user(username="bob", password="quiet-harbour-97")

    def tearDown(self):
        cache.clear()

    def test_many_refreshes_succeed_when_no_rate_is_configured(self):
        res = self.client.post(
            "/api/auth/login/",
            {"username": "bob", "password": "quiet-harbour-97"},
            format="json",
        )
        token = res.json()["refresh"]
        for _ in range(6):
            res = self.client.post(
                "/api/auth/refresh/", {"refresh": token}, format="json"
            )
            self.assertEqual(res.status_code, 200)
            token = res.json()["refresh"]


# ---------------------------------------------------------------------------
# 6. Configurable admin URL
# ---------------------------------------------------------------------------

@contextmanager
def admin_mounted_at(value):
    """
    Rebuild the root URLconf with a different ADMIN_URL for the block's body.

    `backgammon.urls` reads `settings.ADMIN_URL` at import time, so overriding
    the setting alone changes nothing — the module has to be reloaded, and the
    resolver's caches cleared, both on the way in and on the way out.
    """
    try:
        with override_settings(ADMIN_URL=value):
            clear_url_caches()
            importlib.reload(root_urlconf)
            yield
    finally:
        clear_url_caches()
        importlib.reload(root_urlconf)


class AdminUrlConfigTest(TestCase):
    """ADMIN_URL moves the admin without breaking the no-.env-needed default."""

    def test_default_is_admin_so_dev_needs_no_env_file(self):
        self.assertEqual(settings.ADMIN_URL, "admin")

    def test_default_admin_path_still_resolves(self):
        # Anonymous GET /admin/ redirects to the admin login rather than 404ing.
        res = self.client.get("/admin/")
        self.assertEqual(res.status_code, 302)
        self.assertIn("/admin/login/", res["Location"])

    def test_overridden_value_is_honoured(self):
        with admin_mounted_at("ops-9c1f"):
            res = self.client.get("/ops-9c1f/")
            self.assertEqual(res.status_code, 302)
            self.assertIn("/ops-9c1f/login/", res["Location"])

    def test_overridden_value_unmounts_the_default_path(self):
        with admin_mounted_at("ops-9c1f"):
            self.assertEqual(self.client.get("/admin/").status_code, 404)

    def test_default_path_is_restored_after_the_override(self):
        with admin_mounted_at("ops-9c1f"):
            pass
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_slashes_are_stripped_from_the_env_value(self):
        for raw in ("/ops/", "ops/", "/ops", "  ops  "):
            with self.subTest(raw=raw), mock.patch.dict(
                os.environ, {"ADMIN_URL": raw}
            ):
                self.assertEqual(env_url_path("ADMIN_URL", "admin"), "ops")

    def test_blank_or_slash_only_value_falls_back_to_the_default(self):
        # A blank or slash-only value must never mount the admin at the site
        # root, which is what an unguarded "".strip("/") would produce.
        for raw in ("", "   ", "/", "///"):
            with self.subTest(raw=raw), mock.patch.dict(
                os.environ, {"ADMIN_URL": raw}
            ):
                self.assertEqual(env_url_path("ADMIN_URL", "admin"), "admin")

    def test_unset_value_falls_back_to_the_default(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("ADMIN_URL", None)
            self.assertEqual(env_url_path("ADMIN_URL", "admin"), "admin")
