from django.test import override_settings
from rest_framework.test import APITestCase

from .models import Group, Pin, RefPlace


class PinApiTests(APITestCase):
    def test_pin_and_unpin(self):
        g = Group.objects.create(name='Day 1', color='#ef4444')
        r = self.client.post('/api/pins/', {'name': 'Tanah Lot', 'lat': -8.62, 'lng': 115.08, 'group': g.id}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.get('/api/pins/').json()[0]['name'], 'Tanah Lot')

        r = self.client.delete(f'/api/pins/{r.json()["id"]}/')
        self.assertEqual(r.status_code, 204)
        self.assertFalse(Pin.objects.exists())

    def test_deleting_group_keeps_pins(self):
        g = Group.objects.create(name='Day 1')
        p = Pin.objects.create(name='Ubud', lat=-8.5, lng=115.26, group=g)
        self.client.delete(f'/api/groups/{g.id}/')
        p.refresh_from_db()
        self.assertIsNone(p.group)

    @override_settings(APP_PASSWORD='secret')
    def test_password_required_for_changes(self):
        self.assertEqual(self.client.get('/api/pins/').status_code, 200)
        body = {'name': 'X', 'lat': -8.5, 'lng': 115.2}
        self.assertEqual(self.client.post('/api/pins/', body, format='json').status_code, 403)
        r = self.client.post('/api/pins/', body, format='json', HTTP_X_APP_PASSWORD='secret')
        self.assertEqual(r.status_code, 201)

        self.assertTrue(self.client.get('/api/auth/').json()['required'])
        self.assertEqual(self.client.post('/api/auth/', {'password': 'nope'}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/auth/', {'password': 'secret'}, format='json').status_code, 200)


class ReferenceApiTests(APITestCase):
    def make(self, key, rating, reviews):
        return RefPlace.objects.create(place_key=key, name=key, lat=-8.5, lng=115.2, rating=rating,
                                       review_count=reviews, maps_url='https://maps.google.com',
                                       media=[{'type': 'photo', 'thumb': 't', 'full': 'f'}])

    def test_only_popular_and_well_rated_places(self):
        self.make('good', 4.5, 5000)
        self.make('exactly1000', 4.5, 1000)
        self.make('low-rating', 3.9, 9000)
        self.make('edge-rating', 4.0, 1001)
        names = {p['name'] for p in self.client.get('/api/reference/').json()}
        self.assertEqual(names, {'good', 'edge-rating'})

    def test_detail_includes_media(self):
        p = self.make('good', 4.5, 5000)
        self.assertEqual(len(self.client.get(f'/api/reference/{p.id}/').json()['media']), 1)


class ImportTests(APITestCase):
    def test_import_legacy_export(self):
        data = {
            'groups': [{'id': 'none', 'name': 'Ungrouped'}, {'id': 'abc', 'name': 'Day 2', 'color': '#ef4444'}],
            'places': [
                {'name': 'Kelingking', 'lat': -8.75, 'lng': 115.47, 'groupId': 'abc', 'images': [{'thumb': 'x'}]},
                {'name': 'Tanah Lot', 'lat': -8.62, 'lng': 115.08, 'groupId': 'none'},
                {'name': 'broken'},
            ],
        }
        r = self.client.post('/api/import/', data, format='json')
        self.assertEqual(r.json(), {'added': 2, 'skipped': 1, 'groups': 1})
        self.assertEqual(Pin.objects.get(name='Kelingking').group.name, 'Day 2')
        # importing again doesn't duplicate
        self.assertEqual(self.client.post('/api/import/', data, format='json').json()['added'], 0)
