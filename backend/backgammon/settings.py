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
# Throttle scopes `login`, `register` and `refresh` are consumed by the auth
# views via `throttle_scope = "..."`; keep those names stable.
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

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    # Each /api/auth/refresh/ returns a fresh refresh token and blacklists the
    # one it replaced (needs the token_blacklist app + its migrations).
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

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
