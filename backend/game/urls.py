from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import GameViewSet, MatchViewSet, LoginView, RefreshView, RegisterView, MeView

router = DefaultRouter()
router.register(r"games", GameViewSet, basename="game")
router.register(r"matches", MatchViewSet, basename="match")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/register/", RegisterView.as_view()),
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", RefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
]
