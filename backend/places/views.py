from django.conf import settings
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

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
@transaction.atomic
def import_legacy(request):
    """Import the JSON exported by the first (localStorage) version of the app.

    Body: {"groups": [{id, name, color}], "places": [{name, address, region, lat, lng, groupId, note, images}]}
    Skips places already pinned at the same spot (within ~20 m) with the same name.
    """
    data = request.data
    places = data.get('places')
    if not isinstance(places, list):
        return Response({'detail': 'Invalid file: "places" list missing.'}, status=status.HTTP_400_BAD_REQUEST)

    group_map = {}
    for g in data.get('groups') or []:
        if not isinstance(g, dict) or g.get('id') in (None, 'none'):
            continue
        name = str(g.get('name') or 'Group')[:80]
        obj = Group.objects.filter(name=name).first() or Group.objects.create(
            name=name, color=g.get('color') or '#64748b', order=Group.objects.count())
        group_map[g['id']] = obj

    added = skipped = 0
    for p in places:
        try:
            lat, lng = float(p['lat']), float(p['lng'])
            name = str(p.get('name') or 'Unnamed')[:255]
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        dup = Pin.objects.filter(name=name, lat__range=(lat - 0.0002, lat + 0.0002),
                                 lng__range=(lng - 0.0002, lng + 0.0002)).exists()
        if dup:
            skipped += 1
            continue
        Pin.objects.create(
            name=name, lat=lat, lng=lng,
            address=p.get('address') or '', region=p.get('region') or '',
            group=group_map.get(p.get('groupId')), note=p.get('note') or '',
            images=p.get('images') or [], images_tried=bool(p.get('imgTried')),
        )
        added += 1
    return Response({'added': added, 'skipped': skipped, 'groups': len(group_map)})
