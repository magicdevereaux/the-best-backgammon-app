"""
Operational settings: the shared cache and error monitoring.

Two going-live items live here, and both are "off by default, on by env var":

  1. CACHES. DRF stores throttle counters in the default cache. With no
     CACHES setting Django used LocMemCache, which is per-process and wiped on
     restart — so with 3 gunicorn workers a 10/hour login limit really allowed
     ~30/hour and every deploy reset it. REDIS_URL now switches the default
     cache to Django's built-in RedisCache; unset still means LocMem, because
     local dev and CI must keep working with no configuration at all.

  2. Sentry. `sentry_sdk.init()` is called only when SENTRY_DSN is set, and
     never while running the test suite. No DSN means no init, no network.

Neither of these can be tested by re-importing settings (Django caches the
module and half the project reads from django.conf at import time), so the two
branch points are factored into pure functions in settings.py —
`cache_settings()` and `sentry_options()` — and tested directly. No live Redis
and no live Sentry DSN are needed.
"""
from django.conf import settings
from django.core.cache import cache, caches
from django.test import TestCase

from backgammon.settings import cache_settings, parse_admin, sentry_options

LOCMEM = "django.core.cache.backends.locmem.LocMemCache"
REDIS = "django.core.cache.backends.redis.RedisCache"


# ---------------------------------------------------------------------------
# 1. Cache backend selection
# ---------------------------------------------------------------------------

class CacheSettingsTest(TestCase):
    """cache_settings() is the whole of the REDIS_URL branch."""

    def test_no_redis_url_falls_back_to_locmem(self):
        conf = cache_settings("")
        self.assertEqual(conf["default"]["BACKEND"], LOCMEM)

    def test_none_redis_url_falls_back_to_locmem(self):
        """os.environ.get(...) can hand us None if the var is simply absent."""
        conf = cache_settings(None)
        self.assertEqual(conf["default"]["BACKEND"], LOCMEM)

    def test_redis_url_selects_the_redis_backend(self):
        conf = cache_settings("redis://localhost:6379/0")
        self.assertEqual(conf["default"]["BACKEND"], REDIS)

    def test_redis_url_is_passed_through_as_location(self):
        url = "rediss://default:hunter2@redis.internal:6380/1"
        self.assertEqual(cache_settings(url)["default"]["LOCATION"], url)

    def test_redis_config_is_namespaced(self):
        """A shared Redis must not have our throttle keys collide with others."""
        conf = cache_settings("redis://localhost:6379/0")
        self.assertEqual(conf["default"]["KEY_PREFIX"], "backgammon")

    def test_locmem_config_has_a_named_location(self):
        """An explicit LOCATION keeps this cache distinct from any other LocMem."""
        self.assertIn("LOCATION", cache_settings("")["default"])

    def test_redis_backend_exists_in_this_django_version(self):
        """
        django.core.cache.backends.redis landed in Django 4.0. The pin is 4.2,
        but this is the assumption that would break on a downgrade.
        """
        from django.core.cache.backends.redis import RedisCache  # noqa: F401


class ConfiguredCacheTest(TestCase):
    """The live CACHES setting, as the test suite / a bare dev env sees it."""

    def test_settings_define_a_default_cache(self):
        self.assertIn("default", settings.CACHES)

    def test_test_run_uses_locmem(self):
        """No REDIS_URL in the test environment, so this must be the fallback."""
        self.assertEqual(settings.CACHES["default"]["BACKEND"], LOCMEM)

    def test_the_default_cache_actually_works(self):
        """Throttling is a silent no-op if the cache doesn't round-trip."""
        cache.set("ops-settings-probe", 7, 30)
        self.assertEqual(cache.get("ops-settings-probe"), 7)
        cache.delete("ops-settings-probe")

    def test_caches_alias_resolves_without_a_connection_error(self):
        self.assertIsNotNone(caches["default"])


# ---------------------------------------------------------------------------
# 2. Sentry
# ---------------------------------------------------------------------------

class SentryOptionsTest(TestCase):
    """sentry_options() returns None (= don't init) or the init kwargs."""

    def test_empty_dsn_means_no_init(self):
        self.assertIsNone(sentry_options("", "production", "abc123", 0.0))

    def test_none_dsn_means_no_init(self):
        self.assertIsNone(sentry_options(None, "production", "abc123", 0.0))

    def test_dsn_produces_init_kwargs(self):
        opts = sentry_options("https://k@o0.ingest.sentry.io/1", "production", "", 0.0)
        self.assertEqual(opts["dsn"], "https://k@o0.ingest.sentry.io/1")

    def test_environment_is_tagged(self):
        opts = sentry_options("https://k@example.ingest.sentry.io/1", "staging", "", 0.0)
        self.assertEqual(opts["environment"], "staging")

    def test_release_is_tagged(self):
        opts = sentry_options("https://k@example.ingest.sentry.io/1", "production", "deadbee", 0.0)
        self.assertEqual(opts["release"], "deadbee")

    def test_blank_release_becomes_none_not_empty_string(self):
        """Sentry treats "" as a real release name; None means "unset"."""
        opts = sentry_options("https://k@example.ingest.sentry.io/1", "production", "", 0.0)
        self.assertIsNone(opts["release"])

    def test_traces_sample_rate_is_passed_through(self):
        opts = sentry_options("https://k@example.ingest.sentry.io/1", "production", "", 0.25)
        self.assertEqual(opts["traces_sample_rate"], 0.25)

    def test_pii_is_not_sent_by_default(self):
        """Usernames, IPs and request bodies must not leave the app by default."""
        opts = sentry_options("https://k@example.ingest.sentry.io/1", "production", "", 0.0)
        self.assertFalse(opts["send_default_pii"])


class SentryDisabledInTestsTest(TestCase):
    """With no DSN — and under `manage.py test` regardless — Sentry is inert."""

    def test_no_dsn_configured_for_the_test_run(self):
        self.assertEqual(settings.SENTRY_DSN, "")

    def test_sentry_is_not_enabled(self):
        self.assertFalse(settings.SENTRY_ENABLED)

    def test_no_init_kwargs_were_built(self):
        self.assertIsNone(settings.SENTRY_OPTIONS)

    def test_sentry_client_was_never_initialised(self):
        """
        The real proof: even with sentry-sdk installed, no client is active, so
        nothing is captured or sent from a test run.
        """
        import sentry_sdk

        self.assertFalse(sentry_sdk.get_client().is_active())


# ---------------------------------------------------------------------------
# 3. ADMINS (Django's own 500 mail)
# ---------------------------------------------------------------------------

class AdminsTest(TestCase):
    def test_admins_is_empty_by_default(self):
        self.assertEqual(settings.ADMINS, [])

    def test_no_mail_admins_handler_when_admins_is_empty(self):
        """An unconfigured SMTP path must not be wired into django.request."""
        self.assertNotIn("mail_admins", settings.LOGGING["handlers"])
        self.assertNotIn(
            "mail_admins", settings.LOGGING["loggers"]["django.request"]["handlers"]
        )

    def test_managers_mirrors_admins(self):
        self.assertEqual(settings.MANAGERS, settings.ADMINS)

    def test_parses_name_and_angle_bracket_address(self):
        self.assertEqual(
            parse_admin("Nathan D <nathan@example.com>"),
            ("Nathan D", "nathan@example.com"),
        )

    def test_parses_a_bare_address(self):
        self.assertEqual(
            parse_admin("ops@example.com"), ("ops@example.com", "ops@example.com")
        )

    def test_server_email_has_a_default(self):
        self.assertTrue(settings.SERVER_EMAIL)
