from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    EmailVerificationConfirmView,
    EmailVerificationResendView,
    GameViewSet,
    MatchViewSet,
    LoginView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RefreshView,
    RegisterView,
)

router = DefaultRouter()
router.register(r"games", GameViewSet, basename="game")
router.register(r"matches", MatchViewSet, basename="match")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/register/", RegisterView.as_view()),
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", RefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/password-reset/", PasswordResetRequestView.as_view()),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view()),
    path("auth/verify-email/confirm/", EmailVerificationConfirmView.as_view()),
    path("auth/verify-email/resend/", EmailVerificationResendView.as_view()),
]
