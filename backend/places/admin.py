from django.contrib import admin

from .models import Group, Pin, RefPlace


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ['name', 'color', 'order']


@admin.register(Pin)
class PinAdmin(admin.ModelAdmin):
    list_display = ['name', 'group', 'lat', 'lng', 'created_at']
    list_filter = ['group']
    search_fields = ['name', 'address']


@admin.register(RefPlace)
class RefPlaceAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'rating', 'review_count', 'area']
    list_filter = ['area', 'category']
    search_fields = ['name']
