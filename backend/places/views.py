from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import importing
from .models import Group, Pin, RefPlace
from .permissions import check_password
from .serializers import GroupSerializer, PinSerializer, RefPlaceListSerializer, RefPlaceSerializer

# Thresholds for "Reference" mode
MIN_REVIEWS = 1000  # strictly more than
MIN_RATING = 4.0


class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    pagination_class = None


class PinViewSet(viewsets.ModelViewSet):
    """DELETE /api/pins/<id>/ unpins a place."""

    queryset = Pin.objects.all()
    serializer_class = PinSerializer
    pagination_class = None


class RefPlaceViewSet(viewsets.ReadOnlyModelViewSet):
    pagination_class = None

    def get_queryset(self):
        qs = RefPlace.objects.filter(review_count__gt=MIN_REVIEWS, rating__gte=MIN_RATING)
        area = self.request.query_params.get('area')
        if area:
            qs = qs.filter(area=area)
        return qs

    def get_serializer_class(self):
        return RefPlaceListSerializer if self.action == 'list' else RefPlaceSerializer


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def auth(request):
    """GET: is a password required? POST {password}: check it."""
    if request.method == 'GET':
        return Response({'required': bool(settings.APP_PASSWORD)})
    ok = check_password(str(request.data.get('password', '')))
    return Response({'ok': ok}, status=status.HTTP_200_OK if ok else status.HTTP_403_FORBIDDEN)


@api_view(['POST'])
def import_legacy(request):
    """Import a JSON file exported by the app (see places.importing)."""
    try:
        return Response(importing.import_legacy(request.data))
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
