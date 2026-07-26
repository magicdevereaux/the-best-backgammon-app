from django.contrib import admin
from django.urls import path, include

from .health import healthz

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("game.urls")),
    # No auth: platform health checks hit this.
    path("healthz/", healthz, name="healthz"),
]
