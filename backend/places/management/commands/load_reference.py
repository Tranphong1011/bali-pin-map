import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from places.models import RefPlace


class Command(BaseCommand):
    help = 'Load (upsert) places scraped by scraper/scrape_gmaps.py into the RefPlace table.'

    def add_arguments(self, parser):
        parser.add_argument('path', nargs='?', default=str(Path(__file__).resolve().parents[4] / 'data' / 'reference.json'))

    def handle(self, *args, path, **opts):
        file = Path(path)
        if not file.exists():
            raise CommandError(f'{file} not found — run scraper/scrape_gmaps.py first.')
        places = json.loads(file.read_text(encoding='utf-8'))['places'].values()
        objs = [
            RefPlace(
                place_key=p['id'],
                name=p['name'][:255],
                category=(p.get('category') or '')[:120],
                address=p.get('address') or '',
                lat=p['lat'],
                lng=p['lng'],
                rating=p['rating'],
                review_count=p['reviews'],
                area=p.get('area') or 'bali',
                maps_url=p['url'][:1000],
                media=p.get('media') or [],
            )
            for p in places
        ]
        fields = ['name', 'category', 'address', 'lat', 'lng', 'rating', 'review_count', 'area', 'maps_url', 'media']
        with transaction.atomic():
            RefPlace.objects.bulk_create(objs, batch_size=200, update_conflicts=True,
                                         unique_fields=['place_key'], update_fields=fields)
        self.stdout.write(self.style.SUCCESS(f'Loaded {len(objs)} places ({RefPlace.objects.count()} in the table).'))
