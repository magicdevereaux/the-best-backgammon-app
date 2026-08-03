"""
Django settings for the backgammon backend.

Everything that differs between a laptop and a deployed host is read from the
environment, with defaults chosen so that **local development needs no `.env`
file at all** — running `python manage.py runserver` / `test` with an empty
environment behaves exactly as it did before this file grew env support.

See `backend/.env.example` for the full list of variables.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# Load backend/.env if present. Optional: absent file == pure defaults.
try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dotenv is pinned in requirements.txt
    pass
else:
    load_dotenv(BASE_DIR / ".env")

# True while running `manage.py test`. Used to keep rate limiting out of the
# way of the test suite (see REST_FRAMEWORK below).
TESTING = "test" in sys.argv


def env_bool(name, default):
    """Read a boolean env var. Accepts 1/true/yes/on (case-insensitive)."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default):
    """Read a comma-separated env var into a list of stripped strings."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def env_url_path(name, default):
    """
    Read an env var meant to be a URL path segment, normalised for Django.

    Leading/trailing slashes are stripped so ``/secret/`` , ``secret/`` and
    ``secret`` all yield ``secret``; the URLconf appends the single trailing
    slash it needs. An empty/whitespace value falls back to the default, so an
    unset (or blank) variable can never mount the admin at the site root.
    """
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().strip("/") or default


def parse_admin(entry):
    """
    Turn one ADMINS entry into Django's (name, email) pair.

    Accepts "Name <addr@example.com>" or a bare "addr@example.com".
    """
    if "<" in entry and entry.rstrip().endswith(">"):
        name, _, email = entry.rstrip().rstrip(">").partition("<")
        return (name.strip(), email.strip())
    return (entry.strip(), entry.strip())


def cache_settings(redis_url):
    """
    Build the CACHES dict for a given REDIS_URL.

    Empty/None gives Django's in-process LocMemCache — correct for dev, tests
    and CI, and the reason no configuration is needed to run this project. It
    is *not* correct for a multi-worker deployment: DRF stores throttle
    counters in the default cache, so per-process caches mean each gunicorn
    worker enforces its own copy of every rate limit (see .env.example).

    Split out as a function so tests can exercise both branches without a live
    Redis and without re-importing this module.
    """
    if redis_url:
        return {
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": redis_url,
                # Shared Redis instances are common; keep our keys namespaced.
                "KEY_PREFIX": "backgammon",
            }
        }
    return {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "backgammon-locmem",
        }
    }


def sentry_options(dsn, environment, release, traces_sample_rate):
    """
    Build the kwargs for `sentry_sdk.init()`, or None when there is no DSN.

    No DSN means no init call at all — importing this module with an empty
    environment must not reach out to anything.
    """
    if not dsn:
        return None
    return {
        "dsn": dsn,
        "environment": environment,
        "release": release or None,
        "traces_sample_rate": traces_sample_rate,
        # Never ship usernames/IPs/request bodies to a third party by default.
        "send_default_pii": False,
    }


# --------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------

DEBUG = env_bool("DEBUG", True)

SECRET_KEY = os.environ.get("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG:
        # Dev-only fallback. Never reachable with DEBUG=False.
        SECRET_KEY = "django-insecure-dev-key-change-in-production"
    else:
        raise ImproperlyConfigured(
            "SECRET_KEY must be set in the environment when DEBUG is False. "
            "Generate one with: python -c "
            '"from django.core.management.utils import get_random_secret_key as k; print(k())"'
        )

# Add your dev machine's LAN IP here (or via the env var) to test from a
# physical device (Expo Go). IP is DHCP-assigned and may change.
ALLOWED_HOSTS = env_list(
    "ALLOWED_HOSTS", ["localhost", "127.0.0.1", "192.168.1.156"]
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "game",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise must sit immediately after SecurityMiddleware.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "backgammon.urls"

# Path the Django admin is mounted at, without slashes. Default "admin" keeps
# the historical /admin/ URL, so local dev still needs no .env file. Setting it
# to something unguessable is obscurity, not security — it stops automated
# /admin/ scanners from finding the login form, and does nothing against anyone
# who already knows the path. See backend/.env.example.
ADMIN_URL = env_url_path("ADMIN_URL", "admin")

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backgammon.wsgi.application"

# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------
# DATABASE_URL overrides; default is the same local SQLite file as before.

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=int(os.environ.get("DB_CONN_MAX_AGE", "600")),
        conn_health_checks=True,
        ssl_require=env_bool("DB_SSL_REQUIRE", False),
    )
}

# --------------------------------------------------------------------------
# Cache (this is where DRF keeps throttle counters)
# --------------------------------------------------------------------------
# REDIS_URL overrides; default is an in-process LocMemCache so dev/CI need no
# Redis. See cache_settings() above for why that matters in production.

REDIS_URL = os.environ.get("REDIS_URL", "").strip()

CACHES = cache_settings(REDIS_URL)

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------
# Static files (WhiteNoise)
# --------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# WhiteNoise warns on every startup if STATIC_ROOT is missing (it is gitignored
# and only exists after a collectstatic run), so make sure it is there.
try:
    STATIC_ROOT.mkdir(parents=True, exist_ok=True)
except OSError:  # read-only filesystem: collectstatic ran at build time
    pass

# Hashed + compressed manifest only outside DEBUG, so dev never needs a
# collectstatic run before pages render.
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        ),
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------
# CORS / CSRF
# --------------------------------------------------------------------------
# Default keeps the React dev server working with no configuration.

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", ["http://localhost:3000"])
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", ["http://localhost:3000"])

# --------------------------------------------------------------------------
# Django REST Framework
# --------------------------------------------------------------------------
# Throttle scopes `login`, `register`, `refresh`, `password_reset` and
# `password_reset_confirm` are consumed by the auth views via
# `throttle_scope = "..."`; keep those names stable.
#
# `refresh` is much looser than the other two on purpose: both clients call
# /api/auth/refresh/ automatically on any 401, so the rate has to clear normal
# use while still capping how fast a stolen refresh token can be rotated.
#
# Rates are disabled while running the test suite so 200+ fast API calls from
# one address don't trip the limiter. A test that wants to exercise throttling
# should re-enable it with @override_settings(REST_FRAMEWORK={...}) — DRF
# reloads its settings on the setting_changed signal.

THROTTLE_RATES = {
    "anon": os.environ.get("THROTTLE_RATE_ANON", "120/min"),
    "user": os.environ.get("THROTTLE_RATE_USER", "240/min"),
    "login": os.environ.get("THROTTLE_RATE_LOGIN", "10/hour"),
    "register": os.environ.get("THROTTLE_RATE_REGISTER", "5/hour"),
    "refresh": os.environ.get("THROTTLE_RATE_REFRESH", "60/hour"),
    # Password reset. The request endpoint mails a third party, so an
    # unthrottled one is both an enumeration probe and a way to use this app to
    # spam someone else's inbox. `confirm` is looser because it is guessing
    # against a signed token, but still capped so the token space can't be
    # hammered.
    "password_reset": os.environ.get("THROTTLE_RATE_PASSWORD_RESET", "5/hour"),
    "password_reset_confirm": os.environ.get(
        "THROTTLE_RATE_PASSWORD_RESET_CONFIRM", "20/hour"
    ),
}
if TESTING:
    THROTTLE_RATES = {scope: None for scope in THROTTLE_RATES}

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": THROTTLE_RATES,
}

# --------------------------------------------------------------------------
# Inactivity forfeit (ADR-002)
# --------------------------------------------------------------------------
# How long a seat may leave the game waiting on it before the opponent can
# claim the win via POST /api/games/{id}/claim_timeout/. Measured from
# Game.turn_started_at, which covers roll *and* move together.
#
# 48 hours is a correspondence-play default: long enough that a normal person
# with a day job never trips it, short enough that a walked-away opponent
# doesn't strand a match for a week. Env-driven so it can be retuned on a
# running deployment without a code change — and defaulted, so local dev still
# needs no .env file.
TURN_TIMEOUT_HOURS = int(os.environ.get("TURN_TIMEOUT_HOURS", "48"))

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    # Each /api/auth/refresh/ returns a fresh refresh token and blacklists the
    # one it replaced (needs the token_blacklist app + its migrations).
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# --------------------------------------------------------------------------
# Email (password reset, and Django's own ADMINS error mail)
# --------------------------------------------------------------------------
# Plain SMTP, so any provider works: SES, Postmark, Resend, Mailgun, Gmail —
# they all speak it, and nothing here names one. Set EMAIL_HOST and the
# credentials the provider gives you.
#
# With EMAIL_HOST unset the backend is Django's **console** backend: mail is
# printed to stdout instead of sent. That is what keeps the "local dev needs no
# .env" property true through a flow whose whole point is sending mail — run
# the reset endpoint and the link appears in the runserver log, no account with
# any provider required. `manage.py test` overrides this with the locmem
# backend automatically.

EMAIL_HOST = os.environ.get("EMAIL_HOST", "").strip()
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "Backgammon <no-reply@localhost>"
)

EMAIL_BACKEND = (
    "django.core.mail.backends.smtp.EmailBackend"
    if EMAIL_HOST
    else "django.core.mail.backends.console.EmailBackend"
)

# Origin of the *client*, used to build the password-reset link. The server
# can't infer this — the web client is a separate origin and mobile is a deep
# link — so it is configuration. Link shape:
#   {FRONTEND_BASE_URL}/reset-password/{uid}/{token}
# Trailing slashes are stripped so the joined URL never doubles one up.
FRONTEND_BASE_URL = os.environ.get(
    "FRONTEND_BASE_URL", "http://localhost:3000"
).strip().rstrip("/")

# --------------------------------------------------------------------------
# Production hardening (only when DEBUG is False)
# --------------------------------------------------------------------------

if not DEBUG:
    # Trust the reverse proxy's protocol header (Railway/Fly/Render/Heroku all
    # terminate TLS in front of the app).
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    # Health checks are often plain HTTP from inside the platform network.
    SECURE_REDIRECT_EXEMPT = [r"^healthz/?$"]

    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", 60 * 60 * 24 * 365))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"

# --------------------------------------------------------------------------
# Logging (console only — hosts capture stdout)
# --------------------------------------------------------------------------

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        # 4xx/5xx noise: full detail in dev, warnings-and-up in production.
        # Tests deliberately provoke 400/403 responses, so keep the suite's
        # output readable.
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR" if TESTING else ("INFO" if DEBUG else "WARNING"),
            "propagate": False,
        },
        "game": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}

# --------------------------------------------------------------------------
# Error reporting
# --------------------------------------------------------------------------
# Two independent, both-optional channels. With an empty environment neither is
# active and behaviour is exactly as before.

# 1. ADMINS — Django's built-in "email me the traceback" path. Format:
#    "Name <addr@example.com>, Other <other@example.com>". The mail_admins
#    handler is only attached when ADMINS is non-empty, because our LOGGING
#    dict replaces Django's default django.request logger wholesale.
ADMINS = [parse_admin(entry) for entry in env_list("ADMINS", [])]
MANAGERS = ADMINS
SERVER_EMAIL = os.environ.get("SERVER_EMAIL", "root@localhost")

if ADMINS:
    LOGGING["handlers"]["mail_admins"] = {
        "class": "django.utils.log.AdminEmailHandler",
        "level": "ERROR",
        "include_html": False,
    }
    LOGGING["loggers"]["django.request"]["handlers"].append("mail_admins")

# 2. Sentry — initialised only when SENTRY_DSN is set, and never under test.
#    Release falls back to the commit SHA Railway injects into the build.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
SENTRY_ENVIRONMENT = os.environ.get(
    "SENTRY_ENVIRONMENT", "development" if DEBUG else "production"
).strip()
SENTRY_RELEASE = (
    os.environ.get("SENTRY_RELEASE", "").strip()
    or os.environ.get("RAILWAY_GIT_COMMIT_SHA", "").strip()
)
SENTRY_TRACES_SAMPLE_RATE = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0"))

SENTRY_OPTIONS = (
    None
    if TESTING
    else sentry_options(
        SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE, SENTRY_TRACES_SAMPLE_RATE
    )
)
SENTRY_ENABLED = False

if SENTRY_OPTIONS is not None:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
    except ImportError:  # pragma: no cover - sentry-sdk is pinned in requirements.txt
        pass
    else:
        sentry_sdk.init(integrations=[DjangoIntegration()], **SENTRY_OPTIONS)
        SENTRY_ENABLED = True
