from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import GameViewSet, MatchViewSet, LoginView, RegisterView, MeView

router = DefaultRouter()
router.register(r"games", GameViewSet, basename="game")
router.register(r"matches", MatchViewSet, basename="match")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/register/", RegisterView.as_view()),
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
]
