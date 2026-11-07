import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from places.importing import import_legacy


class Command(BaseCommand):
    help = 'Import pins from a JSON file exported by the app ("⋯ → Export data").'

    def add_arguments(self, parser):
        parser.add_argument('path')

    def handle(self, *args, path, **opts):
        file = Path(path)
        if not file.exists():
            raise CommandError(f'{file} not found.')
        try:
            res = import_legacy(json.loads(file.read_text(encoding='utf-8')))
        except ValueError as e:
            raise CommandError(str(e)) from e
        self.stdout.write(self.style.SUCCESS(
            f'{res["added"]} pin(s) added, {res["skipped"]} skipped (duplicates/invalid), {res["groups"]} group(s).'))
