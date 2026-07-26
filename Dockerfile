# Host-agnostic image for the Django backend (Railway / Fly / Render / plain
# Docker all work from this file — no host-specific config lives in the repo).
#
# Build from the REPO ROOT (the build context is the root, sources are backend/):
#   docker build -t backgammon-api .
#   docker run --rm -p 8000:8000 \
#     -e DEBUG=False -e SECRET_KEY=... -e ALLOWED_HOSTS=localhost \
#     -e SECURE_SSL_REDIRECT=False backgammon-api
#
# The container runs `migrate` and then gunicorn. Static files are collected at
# build time and served by WhiteNoise.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# Build deps for psycopg2-binary are not needed (wheels), but libpq runtime is
# small and makes swapping to source builds painless.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY backend/ ./

# Collect with DEBUG=False so the hashed WhiteNoise manifest is generated.
# SECRET_KEY here is build-only and never used at runtime.
RUN DEBUG=False SECRET_KEY=build-time-only-not-a-runtime-secret \
    python manage.py collectstatic --noinput

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Health check target (also reachable at /healthz/ over plain HTTP because it
# is exempt from the HTTPS redirect).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,sys,urllib.request; url='http://127.0.0.1:'+os.environ.get('PORT','8000')+'/healthz/'; sys.exit(0 if urllib.request.urlopen(url, timeout=4).status==200 else 1)"

CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn backgammon.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --timeout ${GUNICORN_TIMEOUT:-60} --access-logfile - --error-logfile -"]
