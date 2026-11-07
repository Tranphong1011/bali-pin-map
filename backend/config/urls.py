from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter

from places import views

router = DefaultRouter()
router.register('groups', views.GroupViewSet)
router.register('pins', views.PinViewSet)
router.register('reference', views.RefPlaceViewSet, basename='reference')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', views.auth),
    path('api/import/', views.import_legacy),
    path('api/', include(router.urls)),
    # Everything else is the React app (built into frontend/dist)
    re_path(r'^(?!api/|admin/|static/).*$', TemplateView.as_view(template_name='index.html')),
]
