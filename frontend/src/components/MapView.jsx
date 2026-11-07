import { useMemo, useState } from 'react';
import L from 'leaflet';
import {
  CircleMarker, LayerGroup, LayersControl, MapContainer, Marker, Polyline, Popup, ScaleControl, TileLayer, Tooltip,
  useMapEvents,
} from 'react-leaflet';
import { BALI_CENTER, fmtKm, nearestTo } from '../geo';
import { refColor, refRadius, refScore } from '../reference';

const BASE_LAYERS = [
  { name: 'Google Maps', url: 'https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}', subdomains: '0123', maxZoom: 21, attribution: 'Map data &copy; Google' },
  { name: 'Google Satellite', url: 'https://mt{s}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}', subdomains: '0123', maxZoom: 21, attribution: 'Imagery &copy; Google' },
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
  { name: 'Esri Streets', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attribution: 'Tiles &copy; Esri' },
];

const iconCache = new Map();
function pinIcon(color, label, selected) {
  const key = `${color}|${label}|${selected}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const k = selected ? 1.25 : 1;
  const w = 30 * k;
  const h = 40 * k;
  const text = String(label);
  const icon = L.divIcon({
    className: 'pin',
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    html: `<svg viewBox="0 0 30 40" width="${w}" height="${h}">
      <path d="M15 39C15 39 28 25.7 28 15A13 13 0 0 0 2 15C2 25.7 15 39 15 39Z" fill="${color}" stroke="#fff" stroke-width="2"/>
      <circle cx="15" cy="15" r="9" fill="#fff"/>
      <text x="15" y="19" text-anchor="middle" font-size="${text.length > 2 ? 8.5 : 11}" font-weight="700"
        font-family="system-ui, sans-serif" fill="${color}">${text}</text>
    </svg>`,
  });
  iconCache.set(key, icon);
  return icon;
}

function MapEvents({ onBaseLayerChange, onContextMenu }) {
  useMapEvents({
    baselayerchange: (e) => onBaseLayerChange(e.name),
    contextmenu: (e) => onContextMenu(e.latlng),
  });
  return null;
}

export default function MapView({
  setMap, pins, groupOf, isHidden, selectedPinId, onSelectPin, onMovePin, showLabels,
  baseLayer, onBaseLayerChange, preview, refPlaces, selectedRefId, onSelectRef, onPinHere,
}) {
  const [ctxPos, setCtxPos] = useState(null);
  const visiblePins = useMemo(() => pins.filter((p) => !isHidden(groupOf(p))), [pins, groupOf, isHidden]);
  const selected = pins.find((p) => p.id === selectedPinId);
  const links = selected && !isHidden(groupOf(selected)) ? nearestTo(selected, 3, visiblePins) : [];
  const sortedRef = useMemo(
    // draw strongest last so they sit on top
    () => (refPlaces || []).map((p) => ({ p, s: refScore(p) })).sort((a, b) => a.s - b.s),
    [refPlaces],
  );
  const initialLayer = BASE_LAYERS.some((l) => l.name === baseLayer) ? baseLayer : 'Google Maps';

  return (
    <MapContainer ref={setMap} center={BALI_CENTER} zoom={10} preferCanvas className="map">
      <LayersControl position="topright">
        {BASE_LAYERS.map((l) => (
          <LayersControl.BaseLayer key={l.name} name={l.name} checked={l.name === initialLayer}>
            <TileLayer url={l.url} subdomains={l.subdomains || 'abc'} maxZoom={l.maxZoom} attribution={l.attribution} />
          </LayersControl.BaseLayer>
        ))}
      </LayersControl>
      <ScaleControl imperial={false} />
      <MapEvents onBaseLayerChange={onBaseLayerChange} onContextMenu={setCtxPos} />

      {refPlaces && (
        <LayerGroup>
          {sortedRef.map(({ p, s }) => {
            const sel = p.id === selectedRefId;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.lng]}
                radius={refRadius(s) + (sel ? 4 : 0)}
                pathOptions={{
                  color: sel ? '#0f172a' : '#881337', weight: sel ? 3 : 1, opacity: sel ? 1 : 0.55,
                  fillColor: refColor(s), fillOpacity: 0.92,
                }}
                eventHandlers={{ click: () => onSelectRef(p.id) }}
              >
                <Tooltip direction="top" offset={[0, -8]} className="pin-label">
                  {p.name} · {p.rating}★ ({p.review_count.toLocaleString('en')})
                </Tooltip>
              </CircleMarker>
            );
          })}
        </LayerGroup>
      )}

      {links.map(({ place: o, d }) => (
        <Polyline
          key={`${selected.id}-${o.id}`}
          positions={[[selected.lat, selected.lng], [o.lat, o.lng]]}
          pathOptions={{ color: groupOf(selected).color, weight: 3, opacity: 0.85, dashArray: '6 7' }}
        >
          <Tooltip permanent direction="center" className="dist-label">{fmtKm(d)}</Tooltip>
        </Polyline>
      ))}

      {pins.map((p, i) => {
        const g = groupOf(p);
        if (isHidden(g)) return null;
        const sel = p.id === selectedPinId;
        return (
          <Marker
            key={`${p.id}-${sel}-${showLabels}`}
            position={[p.lat, p.lng]}
            icon={pinIcon(g.color, i + 1, sel)}
            draggable={sel}
            zIndexOffset={sel ? 1000 : 0}
            riseOnHover
            eventHandlers={{
              click: () => onSelectPin(p.id, false),
              dragend: (e) => onMovePin(p, e.target.getLatLng()),
            }}
          >
            <Tooltip permanent={showLabels || sel} direction="top" offset={[0, sel ? -50 : -40]}
              className={'pin-label' + (sel ? ' sel' : '')}>
              {p.name}
            </Tooltip>
          </Marker>
        );
      })}

      {preview && (
        <CircleMarker key={`${preview.lat},${preview.lng}`} center={[preview.lat, preview.lng]} radius={10}
          pathOptions={{ color: '#0ea5e9', weight: 4, fillColor: '#fff', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -12]} className="pin-label preview">{preview.name}</Tooltip>
        </CircleMarker>
      )}

      {ctxPos && (
        <Popup position={ctxPos} closeButton={false} eventHandlers={{ remove: () => setCtxPos(null) }}>
          <div className="ctx">
            <span className="muted">{ctxPos.lat.toFixed(5)}, {ctxPos.lng.toFixed(5)}</span>
            <button type="button" className="btn primary sm" onClick={() => { onPinHere(ctxPos); setCtxPos(null); }}>
              📌 Pin this spot
            </button>
          </div>
        </Popup>
      )}
    </MapContainer>
  );
}
