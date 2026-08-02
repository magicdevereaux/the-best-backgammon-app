from django.conf import settings
from django.contrib import admin
from django.urls import path, include

from .health import healthz

urlpatterns = [
    # Mount point is env-driven (ADMIN_URL, default "admin"); settings strips
    # any slashes off the value, so exactly one is added here.
    path(f"{settings.ADMIN_URL}/", admin.site.urls),
    path("api/", include("game.urls")),
    # No auth: platform health checks hit this.
    path("healthz/", healthz, name="healthz"),
]
