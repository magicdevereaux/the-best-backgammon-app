"""Unauthenticated liveness/readiness endpoint for platform health checks."""

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET


@never_cache
@require_GET
def healthz(request):
    """Return 200 {"status": "ok"} when the process and its DB are usable.

    Returns 503 with `"status": "error"` if the database is unreachable, so a
    host's health check fails a container that can't serve real traffic.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception as exc:  # pragma: no cover - only on a broken DB
        return JsonResponse(
            {"status": "error", "database": "error", "detail": str(exc)},
            status=503,
        )

    return JsonResponse({"status": "ok", "database": "ok"})
