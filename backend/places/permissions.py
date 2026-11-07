import hmac

from django.conf import settings
from rest_framework.permissions import SAFE_METHODS, BasePermission


def check_password(given):
    expected = settings.APP_PASSWORD
    if not expected:
        return True
    return hmac.compare_digest(given.encode(), expected.encode())


class ReadOnlyOrAppPassword(BasePermission):
    """Anyone can read; changes need the X-App-Password header to match APP_PASSWORD."""

    message = 'Password required.'

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or check_password(request.headers.get('X-App-Password', ''))
