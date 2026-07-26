release: python backend/manage.py migrate --noinput
web: gunicorn backgammon.wsgi:application --chdir backend --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-3} --timeout ${GUNICORN_TIMEOUT:-60} --access-logfile - --error-logfile -
