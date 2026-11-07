from django.db import models


class Group(models.Model):
    """A color group for organising pins (e.g. "Day 1 – Ubud")."""

    name = models.CharField(max_length=80)
    color = models.CharField(max_length=9, default='#64748b')
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return self.name


class RefPlace(models.Model):
    """A highly rated place scraped from Google Maps, shown in "Reference" mode."""

    AREA_CHOICES = [('bali', 'Bali'), ('penida', 'Nusa Penida')]

    place_key = models.CharField(max_length=64, unique=True, help_text='Google Maps feature id (0x…:0x…)')
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=120, blank=True)
    address = models.TextField(blank=True)
    lat = models.FloatField()
    lng = models.FloatField()
    rating = models.FloatField(db_index=True)
    review_count = models.PositiveIntegerField(db_index=True)
    area = models.CharField(max_length=10, choices=AREA_CHOICES, default='bali')
    maps_url = models.URLField(max_length=1000)
    media = models.JSONField(default=list, blank=True)
    scraped_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-review_count']

    def __str__(self):
        return f'{self.name} ({self.rating}★, {self.review_count})'


class Pin(models.Model):
    """A place the user pinned on the map. Deleting a Pin = unpinning it."""

    name = models.CharField(max_length=255)
    address = models.TextField(blank=True)
    region = models.CharField(max_length=120, blank=True)
    lat = models.FloatField()
    lng = models.FloatField()
    group = models.ForeignKey(Group, null=True, blank=True, on_delete=models.SET_NULL, related_name='pins')
    ref_place = models.ForeignKey(RefPlace, null=True, blank=True, on_delete=models.SET_NULL, related_name='pins')
    note = models.TextField(blank=True)
    images = models.JSONField(default=list, blank=True)
    images_tried = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return self.name
