from rest_framework import serializers

from .models import Group, Pin, RefPlace


class GroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ['id', 'name', 'color', 'order']


class PinSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pin
        fields = ['id', 'name', 'address', 'region', 'lat', 'lng', 'group', 'ref_place',
                  'note', 'images', 'images_tried', 'created_at']
        read_only_fields = ['created_at']


class RefPlaceListSerializer(serializers.ModelSerializer):
    """Lightweight version for drawing hundreds of markers."""

    thumb = serializers.SerializerMethodField()

    class Meta:
        model = RefPlace
        fields = ['id', 'name', 'category', 'lat', 'lng', 'rating', 'review_count', 'area', 'thumb']

    def get_thumb(self, obj):
        return obj.media[0]['thumb'] if obj.media else None


class RefPlaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefPlace
        fields = ['id', 'name', 'category', 'address', 'lat', 'lng', 'rating', 'review_count',
                  'area', 'maps_url', 'media', 'scraped_at']
