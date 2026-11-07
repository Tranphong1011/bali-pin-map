from django.db import transaction

from .models import Group, Pin


@transaction.atomic
def import_legacy(data):
    """Import the JSON exported by the app ("⋯ → Export data", first or second version).

    data: {"groups": [{id, name, color}], "places": [{name, address, region, lat, lng, groupId, note, images}]}
    Skips places already pinned at the same spot (within ~20 m) with the same name.
    Returns {"added", "skipped", "groups"}; raises ValueError on a malformed file.
    """
    places = data.get('places') if isinstance(data, dict) else None
    if not isinstance(places, list):
        raise ValueError('Invalid file: "places" list missing.')

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
            images=p.get('images') or [], images_tried=bool(p.get('imgTried') or p.get('images_tried')),
        )
        added += 1
    return {'added': added, 'skipped': skipped, 'groups': len(group_map)}
