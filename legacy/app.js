'use strict';

// ================= Config =================
const STORE_KEY = 'baliPinMap.v1';
const SETTINGS_KEY = 'baliPinMap.settings.v1';
const BALI_CENTER = [-8.45, 115.19];
const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#78716c'];
// Words too generic to use when matching image titles
const STOPWORDS = new Set(['the', 'and', 'bali', 'pura', 'temple', 'beach', 'pantai', 'jalan', 'cafe', 'restaurant',
  'villa', 'hotel', 'resort', 'desa', 'kabupaten', 'kecamatan', 'island', 'pulau', 'waterfall', 'air', 'terjun', 'gili', 'nusa']);

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ================= Data =================
let state = loadState();
let settings = loadJSON(SETTINGS_KEY) || {};
let selectedId = null;
let lastResults = [];
const loadingImages = new Set();

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function loadState() {
  const s = loadJSON(STORE_KEY) || {};
  s.groups = Array.isArray(s.groups) ? s.groups : [];
  s.places = Array.isArray(s.places) ? s.places : [];
  if (!s.groups.some((g) => g.id === 'none')) {
    s.groups.unshift({ id: 'none', name: 'Ungrouped', color: '#64748b', visible: true });
  }
  const def = s.groups.find((g) => g.id === 'none');
  if (def.name === 'Chưa phân nhóm') def.name = 'Ungrouped'; // migrate data saved by the Vietnamese UI
  if (s.showLabels === undefined) s.showLabels = true;
  return s;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    flashSaved();
  } catch (e) {
    toast('Could not save data: ' + e.message);
  }
}

let saveTimer;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

const getPlace = (id) => state.places.find((p) => p.id === id);
const getGroup = (id) => state.groups.find((g) => g.id === id) || state.groups.find((g) => g.id === 'none');
const visiblePlaces = () => state.places.filter((p) => getGroup(p.groupId).visible);

// ================= Distance =================
function distKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtKm(d) {
  if (d < 1) return Math.round(d * 1000) + ' m';
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
}

const distClass = (d) => (d < 5 ? 'near' : d < 15 ? 'mid' : 'far');

function nearestTo(pt, n, pool = state.places) {
  return pool
    .filter((o) => o.id !== pt.id)
    .map((o) => ({ place: o, d: distKm(pt, o) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

// ================= Map =================
const map = L.map('map', { zoomControl: true }).setView(BALI_CENTER, 10);

const baseLayers = {
  'Google Maps': L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: '0123', attribution: 'Map data &copy; Google',
  }),
  'Google Satellite': L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}', {
    maxZoom: 21, subdomains: '0123', attribution: 'Imagery &copy; Google',
  }),
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  }),
  'Esri Streets': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles &copy; Esri',
  }),
  'Satellite': L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri',
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
    }),
  ]),
};
// OSM tiles require a Referer header, so it can't be restored when opened directly via file://
const canUseLayer = (name) => baseLayers[name] && (name !== 'OpenStreetMap' || location.protocol.startsWith('http'));
baseLayers[canUseLayer(state.baseLayer) ? state.baseLayer : 'Google Maps'].addTo(map);
L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
map.on('baselayerchange', (e) => {
  state.baseLayer = e.name;
  save();
});
L.control.scale({ imperial: false }).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const linkLayer = L.layerGroup().addTo(map);
let previewMarker = null;

function pinIcon(color, label, selected) {
  const k = selected ? 1.25 : 1;
  const w = 30 * k;
  const h = 40 * k;
  const text = String(label);
  return L.divIcon({
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
}

function renderMarkers() {
  markerLayer.clearLayers();
  state.places.forEach((p, i) => {
    const g = getGroup(p.groupId);
    if (!g.visible) return;
    const sel = p.id === selectedId;
    const m = L.marker([p.lat, p.lng], {
      icon: pinIcon(g.color, i + 1, sel),
      draggable: sel,
      zIndexOffset: sel ? 1000 : 0,
      riseOnHover: true,
    });
    m.bindTooltip(esc(p.name), {
      permanent: state.showLabels || sel,
      direction: 'top',
      offset: [0, sel ? -50 : -40],
      className: 'pin-label' + (sel ? ' sel' : ''),
    });
    m.on('click', () => selectPlace(p.id, false));
    m.on('dragend', () => {
      const ll = m.getLatLng();
      p.lat = ll.lat;
      p.lng = ll.lng;
      save();
      renderAll();
      toast('Location updated');
    });
    markerLayer.addLayer(m);
  });
  drawLinks();
}

// Connect the selected place to its 3 nearest neighbours, with distance labels
function drawLinks() {
  linkLayer.clearLayers();
  const p = getPlace(selectedId);
  if (!p || !getGroup(p.groupId).visible) return;
  const color = getGroup(p.groupId).color;
  nearestTo(p, 3, visiblePlaces()).forEach(({ place: o, d }) => {
    L.polyline([[p.lat, p.lng], [o.lat, o.lng]], { color, weight: 3, opacity: 0.85, dashArray: '6 7' })
      .addTo(linkLayer)
      .bindTooltip(fmtKm(d), { permanent: true, direction: 'center', className: 'dist-label' });
  });
}

function fitAll() {
  const pts = visiblePlaces();
  if (!pts.length) return map.setView(BALI_CENTER, 10);
  if (pts.length === 1) return map.setView([pts[0].lat, pts[0].lng], 14);
  map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 15 });
}

// Right-click (or long-press on mobile) to pin any location
map.on('contextmenu', (e) => {
  const { lat, lng } = e.latlng;
  const div = document.createElement('div');
  div.className = 'ctx';
  div.innerHTML = `<span class="muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
    <button type="button" class="btn primary sm">📌 Pin this spot</button>`;
  div.querySelector('button').onclick = async () => {
    map.closePopup();
    const info = await reverseGeocode(lat, lng).catch(() => null);
    addPlace({
      name: info?.name || `Location ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      address: info?.address || '',
      region: info?.region || '',
      lat, lng,
    });
  };
  L.popup({ closeButton: false }).setLatLng(e.latlng).setContent(div).openOn(map);
});

// ================= Search =================
const inRegion = (r) => r.lat < -7.4 && r.lat > -9.3 && r.lng > 114.0 && r.lng < 117.2;

async function searchNominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({
    q, format: 'jsonv2', limit: '8', addressdetails: '1', countrycodes: 'id',
    'accept-language': 'en', viewbox: '114.0,-7.4,117.2,-9.3', bounded: '0',
  });
  const r = await fetch(u);
  if (!r.ok) throw new Error('Nominatim ' + r.status);
  const data = await r.json();
  return data.map((d) => ({
    name: d.name || d.display_name.split(',')[0],
    address: d.display_name,
    region: d.address?.state || '',
    lat: +d.lat,
    lng: +d.lon,
  }));
}

async function searchPhoton(q) {
  const u = new URL('https://photon.komoot.io/api/');
  u.search = new URLSearchParams({ q, limit: '10', lat: String(BALI_CENTER[0]), lon: String(BALI_CENTER[1]) });
  const r = await fetch(u);
  if (!r.ok) throw new Error('Photon ' + r.status);
  const data = await r.json();
  return (data.features || [])
    .filter((f) => f.properties.countrycode === 'ID')
    .map((f) => {
      const p = f.properties;
      const parts = [p.name, p.street, p.district, p.city, p.county, p.state].filter(Boolean);
      return {
        name: p.name || p.street || q,
        address: [...new Set(parts)].join(', '),
        region: p.state || '',
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      };
    });
}

async function reverseGeocode(lat, lng) {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.search = new URLSearchParams({ lat, lon: lng, format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'en' });
  const d = await (await fetch(u)).json();
  if (d.error) return null;
  return { name: d.name || d.display_name.split(',')[0], address: d.display_name, region: d.address?.state || '' };
}

// "lat, lng" coordinates or a full Google Maps URL
function parseDirectInput(q) {
  const m = q.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
    || q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    || q.match(/[?&](?:q|query|ll)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i)
    || q.match(/^\s*(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = +m[1];
  const lng = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const nm = q.match(/\/place\/([^/@?]+)/);
  return { name: nm ? decodeURIComponent(nm[1].replace(/\+/g, ' ')) : '', address: '', region: '', lat, lng };
}

async function runSearch(q) {
  q = q.trim();
  if (!q) return;
  const resultsEl = $('#results');
  const btn = $('#btnSearch');

  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(q)) {
    resultsEl.innerHTML = `<div class="pad muted">Short links can't be read directly. Open the link in your browser,
      wait for Google Maps to load, then copy the full URL from the address bar and paste it here.</div>`;
    return;
  }

  btn.disabled = true;
  resultsEl.innerHTML = '<div class="pad muted">Searching…</div>';
  try {
    const direct = parseDirectInput(q);
    if (direct) {
      if (!direct.name) {
        const info = await reverseGeocode(direct.lat, direct.lng).catch(() => null);
        direct.name = info?.name || `Location ${direct.lat.toFixed(4)}, ${direct.lng.toFixed(4)}`;
        direct.address = info?.address || '';
        direct.region = info?.region || '';
      }
      showResults([direct]);
      return;
    }

    const [a, b] = await Promise.allSettled([searchNominatim(q), searchPhoton(q)]);
    const merged = [];
    for (const r of [...(a.value || []), ...(b.value || [])]) {
      const dup = merged.some((o) => distKm(o, r) < 0.3 && o.name.toLowerCase() === r.name.toLowerCase());
      if (!dup) merged.push(r);
    }
    merged.sort((x, y) => inRegion(y) - inRegion(x)); // prefer Bali & surroundings
    if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
    showResults(merged.slice(0, 10));
  } catch (e) {
    console.error(e);
    resultsEl.innerHTML = `<div class="pad muted">Search failed (${esc(e.message)}). Check your connection and try again.</div>`;
  } finally {
    btn.disabled = false;
  }
}

const alreadyPinned = (r) => state.places.find((p) => distKm(p, r) < 0.05);

function showResults(list) {
  lastResults = list;
  const el = $('#results');
  if (!list.length) {
    el.innerHTML = `<div class="pad muted">Nothing found. Try another English/Indonesian name, or paste coordinates / a Google Maps link.
      You can also right-click the map to pin a spot directly.</div>`;
    clearPreview();
    return;
  }
  el.innerHTML = `<div class="res-head"><span>${list.length} result${list.length > 1 ? 's' : ''} · click to preview on map</span>
      <button type="button" class="link" data-act="close">Close</button></div>`
    + list.map((r, i) => {
      const n = nearestTo(r, 1)[0];
      const nearInfo = n
        ? `<small class="near-info"><span class="${distClass(n.d)}">${fmtKm(n.d)}</span> from “${esc(n.place.name)}”</small>`
        : '';
      const pinned = alreadyPinned(r);
      return `<div class="res" data-i="${i}">
        <div class="res-main"><b>${esc(r.name)}</b><small>${esc(r.address)}</small>${nearInfo}</div>
        ${pinned ? '<span class="tag">Pinned</span>' : `<button type="button" class="btn primary sm" data-act="pin" data-i="${i}">📌 Pin</button>`}
      </div>`;
    }).join('');
  previewResult(0);
}

function previewResult(i) {
  const r = lastResults[i];
  if (!r) return;
  document.querySelectorAll('.res').forEach((x) => x.classList.toggle('active', +x.dataset.i === i));
  clearPreview();
  previewMarker = L.circleMarker([r.lat, r.lng], { radius: 10, color: '#0ea5e9', weight: 4, fillColor: '#fff', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip(esc(r.name), { permanent: true, direction: 'top', offset: [0, -12], className: 'pin-label preview' });
  map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 13), { duration: 0.7 });
}

function clearPreview() {
  if (previewMarker) previewMarker.remove();
  previewMarker = null;
}

function clearResults() {
  $('#results').innerHTML = '';
  lastResults = [];
  clearPreview();
}

// ================= Add / select places =================
function addPlace(r) {
  const groupId = $('#activeGroup').value || 'none';
  const p = {
    id: uid(), name: r.name, address: r.address || '', region: r.region || '',
    lat: r.lat, lng: r.lng, groupId, note: '', images: [], createdAt: Date.now(),
  };
  getGroup(groupId).visible = true;
  state.places.push(p);
  save();
  clearResults();
  $('#q').value = '';
  selectPlace(p.id);
  toast(`📌 Pinned “${p.name}”`);
}

function selectPlace(id, fly = true) {
  const p = getPlace(id);
  selectedId = p ? id : null;
  if (p) getGroup(p.groupId).visible = true;
  renderAll();
  if (!p) return;
  if (fly) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 12), { duration: 0.6 });
  if (!p.images?.length && !p.imgTried) loadImages(p);
  $('#scroll').scrollTop = 0;
}

function deselect() {
  selectedId = null;
  renderAll();
}

// ================= Images =================
const imageQuery = (p) => (p.region && !p.name.toLowerCase().includes(p.region.toLowerCase()) ? `${p.name} ${p.region}` : p.name);
const gimagesUrl = (p) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageQuery(p))}`;
const gmapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
const dirUrl = (a, b) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;

async function commonsQuery(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '640', ...params,
  });
  const d = await (await fetch(u)).json();
  return Object.values(d.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((pg) => {
      const ii = pg.imageinfo?.[0];
      if (!ii || !/jpeg|png|webp/.test(ii.mime)) return null;
      return {
        thumb: ii.thumburl || ii.url, full: ii.thumburl || ii.url, page: ii.descriptionurl,
        title: pg.title.replace(/^File:/, '').replace(/\.\w+$/, ''), src: 'Wikimedia Commons',
      };
    })
    .filter(Boolean);
}

async function commonsImages(p) {
  const [byName, nearby] = await Promise.all([
    commonsQuery({ generator: 'search', gsrsearch: `${imageQuery(p)} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '15' }).catch(() => []),
    commonsQuery({ generator: 'geosearch', ggscoord: `${p.lat}|${p.lng}`, ggsradius: '500', ggslimit: '15', ggsnamespace: '6' }).catch(() => []),
  ]);
  const words = p.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const score = (im) => words.filter((w) => im.title.toLowerCase().includes(w)).length;
  const matched = byName.filter((im) => score(im) > 0).sort((a, b) => score(b) - score(a));
  const rest = byName.filter((im) => score(im) === 0);
  // Title matches first, then photos taken right at the location, then remaining name-search hits
  return uniqBy([...matched, ...nearby, ...rest], (im) => im.full);
}

async function googleImages(p) {
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.search = new URLSearchParams({ key: settings.gKey, cx: settings.gCx, q: imageQuery(p), searchType: 'image', num: '9', safe: 'active' });
  const r = await fetch(u);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || r.status);
  return (d.items || []).map((it) => ({
    thumb: it.link, fb: it.image?.thumbnailLink, full: it.link,
    page: it.image?.contextLink || it.link, title: it.title, src: 'Google',
  }));
}

function uniqBy(arr, key) {
  const seen = new Set();
  return arr.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
}

async function loadImages(p, next = false) {
  if (loadingImages.has(p.id)) return;
  loadingImages.add(p.id);
  refreshImages(p);
  try {
    const custom = (p.images || []).filter((im) => im.custom);
    let found = [];
    if (settings.gKey && settings.gCx) {
      found = await googleImages(p).catch((e) => {
        console.warn(e);
        toast('Google API error: ' + e.message + ' — using Wikimedia');
        return [];
      });
    }
    if (found.length < 3) found = uniqBy(found.concat(await commonsImages(p).catch(() => [])), (im) => im.full);

    let page = next ? (p.imgPage || 0) + 1 : 0;
    if (page * 3 >= found.length) page = 0;
    if (next && found.length <= 3) toast('No more photos — try “Google Images” or “+ Add photo”');
    p.imgPage = page;
    p.images = custom.concat(found.slice(page * 3, page * 3 + 3));
    p.imgTried = true;
  } finally {
    loadingImages.delete(p.id);
    if (state.places.includes(p)) {
      save();
      refreshImages(p);
      renderList();
    }
  }
}

function imagesHtml(p) {
  const imgs = p.images || [];
  let grid;
  if (loadingImages.has(p.id) && !imgs.length) {
    grid = '<figure class="skeleton"></figure>'.repeat(3);
  } else if (!imgs.length) {
    grid = `<div class="img-empty">No photos found automatically.<br>Click “Google Images” to browse, then “+ Add photo” to paste an image link.</div>`;
  } else {
    grid = imgs.map((im, i) => `<figure data-img="${i}" title="${esc(im.title || p.name)}">
        <img src="${esc(im.thumb)}" ${im.fb ? `data-fb="${esc(im.fb)}"` : ''} alt="${esc(im.title || p.name)}" loading="lazy"
          referrerpolicy="no-referrer" onerror="if(this.dataset.fb){this.src=this.dataset.fb;delete this.dataset.fb}else{this.closest('figure').style.opacity=.3}">
        <button type="button" class="img-x" data-act="rmimg" data-i="${i}" title="Remove this photo">×</button>
      </figure>`).join('');
  }
  const srcs = [...new Set(imgs.map((im) => im.src))].join(', ');
  return `<div class="imgs">${grid}</div>
    <div class="img-tools">
      <button type="button" class="btn ghost sm" data-act="moreimg" ${loadingImages.has(p.id) ? 'disabled' : ''}>
        ${loadingImages.has(p.id) ? '⏳ Loading…' : '↻ Other photos'}</button>
      <button type="button" class="btn ghost sm" data-act="addimg">+ Add photo</button>
      ${srcs ? `<span class="img-src">Source: ${esc(srcs)}</span>` : ''}
    </div>`;
}

function refreshImages(p) {
  if (p.id !== selectedId) return;
  const el = $('#dImages');
  if (el) el.innerHTML = imagesHtml(p);
}

// ---------- Lightbox ----------
const lb = { list: [], i: 0 };
function openLightbox(list, i) {
  lb.list = list;
  lb.i = i;
  showLightboxImage();
  $('#lightbox').hidden = false;
}
function showLightboxImage() {
  const im = lb.list[lb.i];
  if (!im) return;
  $('#lbImg').src = im.full || im.thumb;
  $('#lbCap').innerHTML = `${esc(im.title || '')} · ${lb.i + 1}/${lb.list.length}`
    + (im.page ? ` · <a href="${esc(im.page)}" target="_blank" rel="noopener">Source (${esc(im.src || 'link')})</a>` : '');
}
function lightboxStep(d) {
  lb.i = (lb.i + d + lb.list.length) % lb.list.length;
  showLightboxImage();
}
const closeLightbox = () => { $('#lightbox').hidden = true; };

$('#lightbox').addEventListener('click', (e) => {
  const act = e.target.closest('[data-lb]')?.dataset.lb;
  if (act === 'prev') lightboxStep(-1);
  else if (act === 'next') lightboxStep(1);
  else if (act === 'close' || e.target.id === 'lightbox') closeLightbox();
});

// ================= Render =================
function renderAll() {
  renderGroups();
  renderList();
  renderDetail();
  renderMarkers();
}

function renderGroups() {
  const counts = {};
  state.places.forEach((p) => {
    const gid = getGroup(p.groupId).id;
    counts[gid] = (counts[gid] || 0) + 1;
  });
  $('#groupChips').innerHTML = state.groups.map((g) => `
      <div class="chip ${g.visible ? '' : 'off'}" data-gid="${g.id}" style="--c:${g.color}">
        <span class="dot"></span><span class="chip-name">${esc(g.name)}</span>
        <span class="chip-count">${counts[g.id] || 0}</span>
        <button type="button" class="chip-edit" data-edit="${g.id}" title="Rename / recolor">✎</button>
      </div>`).join('')
    + (state.groups.some((g) => !g.visible) ? '<button type="button" class="chip plain" data-showall>Show all</button>' : '');

  const sel = $('#activeGroup');
  const cur = state.groups.some((g) => g.id === state.activeGroup) ? state.activeGroup : 'none';
  sel.innerHTML = state.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  sel.value = cur;
  $('#activeDot').style.background = getGroup(cur).color;
}

function renderList() {
  $('#count').textContent = state.places.length;
  $('#showLabels').checked = state.showLabels;
  const el = $('#placeList');
  if (!state.places.length) {
    el.innerHTML = `<div class="empty-state">
        <div class="big">🗺️</div>
        No places yet.<br>
        Type a name in the search box (e.g. <b>Tanah Lot</b>, <b>Tegallalang</b>, <b>Kelingking Beach</b>) and click <b>📌 Pin</b>.<br>
        <span class="small">Tip: right-click (or long-press) the map to pin any spot.</span>
      </div>`;
    return;
  }
  el.innerHTML = state.groups.map((g) => {
    const items = state.places
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => getGroup(p.groupId).id === g.id);
    if (!items.length) return '';
    return `<div class="grp ${g.visible ? '' : 'off'}">
      <div class="grp-h" style="--c:${g.color}"><span class="dot"></span>${esc(g.name)} <small>${items.length}</small></div>
      ${items.map(({ p, i }) => {
        const n = nearestTo(p, 1)[0];
        const sub = n
          ? `Nearest: ${esc(n.place.name)} · <span class="${distClass(n.d)}">${fmtKm(n.d)}</span>`
          : esc((p.address || '').split(',').slice(1, 3).join(','));
        const img = p.images?.[0];
        return `<div class="item ${p.id === selectedId ? 'sel' : ''}" data-id="${p.id}">
          <span class="num" style="background:${g.color}">${i + 1}</span>
          ${img ? `<img class="thumb" src="${esc(img.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
            : '<span class="thumb empty">📍</span>'}
          <div class="item-main"><b>${esc(p.name)}</b><small>${sub}</small></div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function renderDetail() {
  const p = getPlace(selectedId);
  const dv = $('#detailView');
  $('#listView').hidden = !!p;
  dv.hidden = !p;
  if (!p) {
    dv.innerHTML = '';
    return;
  }
  const g = getGroup(p.groupId);
  const idx = state.places.indexOf(p) + 1;
  const others = state.places
    .filter((o) => o !== p)
    .map((o) => ({ o, d: distKm(p, o) }))
    .sort((a, b) => a.d - b.d);

  dv.innerHTML = `
    <div class="d-bar">
      <button type="button" class="btn ghost sm" data-act="back">← List</button>
      <span class="d-pos">${idx}/${state.places.length}</span>
      <div>
        <button type="button" class="btn ghost sm" data-act="prev" title="Previous place">‹</button>
        <button type="button" class="btn ghost sm" data-act="next" title="Next place">›</button>
      </div>
    </div>
    <div class="d-title">
      <span class="num lg" style="background:${g.color}">${idx}</span>
      <input class="d-name" data-field="name" value="${esc(p.name)}" title="Click to rename">
    </div>
    ${p.address ? `<p class="d-addr">${esc(p.address)}</p>` : ''}
    <div class="d-group">
      <span class="dot" style="background:${g.color}"></span>
      <select data-field="groupId" title="Change group">
        ${state.groups.map((x) => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>
    </div>
    <div id="dImages">${imagesHtml(p)}</div>
    <div class="d-links">
      <a class="btn ghost sm" target="_blank" rel="noopener" href="${gmapsUrl(p)}">🗺️ Google Maps</a>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="${gimagesUrl(p)}">🖼️ Google Images</a>
      <button type="button" class="btn ghost sm" data-act="copy" title="Copy coordinates">📋 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</button>
    </div>
    <label class="field">
      <span>Notes</span>
      <textarea data-field="note" rows="3" placeholder="Opening hours, ticket price, what to eat…">${esc(p.note)}</textarea>
    </label>
    <div class="sec-head" style="margin-top:14px"><h2>Distance to other places</h2></div>
    <div class="legend"><span class="near">● &lt; 5 km</span><span class="mid">● 5–15 km</span><span class="far">● &gt; 15 km</span>
      <span class="muted">(straight line)</span></div>
    <ul class="dist-list">
      ${others.length ? others.map(({ o, d }) => `
        <li data-goto="${o.id}">
          <span class="dot" style="background:${getGroup(o.groupId).color}"></span>
          <span class="nm">${esc(o.name)}</span>
          <b class="${distClass(d)}">${fmtKm(d)}</b>
          <a href="${dirUrl(p, o)}" target="_blank" rel="noopener" title="Google Maps directions" data-stop>🚗</a>
        </li>`).join('') : '<li class="muted">Pin more places to compare distances.</li>'}
    </ul>
    <p class="hint">Tip: drag the selected pin on the map to fine-tune its position.</p>
    <button type="button" class="btn danger-text full" data-act="delete" style="margin-top:10px">🗑️ Delete this place</button>`;
}

// ================= Groups =================
let editingGroupId = null;
let pickedColor = PALETTE[0];

function openGroupDlg(id) {
  editingGroupId = id || null;
  const g = id ? state.groups.find((x) => x.id === id) : null;
  const used = new Set(state.groups.map((x) => x.color));
  pickedColor = g ? g.color : PALETTE.find((c) => !used.has(c)) || PALETTE[0];
  $('#groupDlgTitle').textContent = g ? 'Edit group' : 'New group';
  $('#groupName').value = g ? g.name : '';
  $('#groupDelete').hidden = !g || g.id === 'none';
  renderSwatches();
  $('#groupDlg').showModal();
  $('#groupName').focus();
}

function renderSwatches() {
  $('#swatches').innerHTML = PALETTE.map((c) => `<button type="button" class="sw ${c === pickedColor ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')
    + `<input type="color" id="customColor" value="${pickedColor}" title="Pick another color">`;
}

$('#swatches').addEventListener('click', (e) => {
  const c = e.target.closest('[data-color]')?.dataset.color;
  if (!c) return;
  pickedColor = c;
  renderSwatches();
});
$('#swatches').addEventListener('input', (e) => {
  if (e.target.id !== 'customColor') return;
  pickedColor = e.target.value;
  document.querySelectorAll('.sw').forEach((s) => s.classList.remove('on'));
});

$('#groupDlg').addEventListener('close', () => {
  if ($('#groupDlg').returnValue !== 'ok') return;
  const name = $('#groupName').value.trim();
  if (!name) return;
  if (editingGroupId) {
    const g = state.groups.find((x) => x.id === editingGroupId);
    g.name = name;
    g.color = pickedColor;
  } else {
    const g = { id: uid(), name, color: pickedColor, visible: true };
    state.groups.push(g);
    state.activeGroup = g.id; // a newly created group becomes the pin target
  }
  save();
  renderAll();
});

$('#groupDelete').addEventListener('click', () => {
  const g = state.groups.find((x) => x.id === editingGroupId);
  if (!g || g.id === 'none') return;
  const n = state.places.filter((p) => p.groupId === g.id).length;
  if (!confirm(`Delete group “${g.name}”?${n ? ` ${n} place${n > 1 ? 's' : ''} will move to “${getGroup('none').name}”.` : ''}`)) return;
  state.places.forEach((p) => { if (p.groupId === g.id) p.groupId = 'none'; });
  state.groups = state.groups.filter((x) => x !== g);
  $('#groupDlg').close('deleted');
  save();
  renderAll();
});

// ================= Events =================
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch($('#q').value);
});

$('#results').addEventListener('click', (e) => {
  const actEl = e.target.closest('[data-act]');
  if (actEl?.dataset.act === 'close') return clearResults();
  if (actEl?.dataset.act === 'pin') return addPlace(lastResults[+actEl.dataset.i]);
  const row = e.target.closest('.res');
  if (row) previewResult(+row.dataset.i);
});

$('#activeGroup').addEventListener('change', (e) => {
  state.activeGroup = e.target.value;
  $('#activeDot').style.background = getGroup(e.target.value).color;
  save();
});

$('#btnAddGroup').addEventListener('click', () => openGroupDlg());
$('#btnFit').addEventListener('click', fitAll);
$('#showLabels').addEventListener('change', (e) => {
  state.showLabels = e.target.checked;
  save();
  renderMarkers();
});

$('#groupChips').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return openGroupDlg(edit.dataset.edit);
  if (e.target.closest('[data-showall]')) {
    state.groups.forEach((g) => { g.visible = true; });
  } else {
    const chip = e.target.closest('[data-gid]');
    if (!chip) return;
    const g = state.groups.find((x) => x.id === chip.dataset.gid);
    g.visible = !g.visible;
  }
  const sel = getPlace(selectedId);
  if (sel && !getGroup(sel.groupId).visible) selectedId = null;
  save();
  renderAll();
});

$('#groupChips').addEventListener('dblclick', (e) => {
  const chip = e.target.closest('[data-gid]');
  if (!chip || e.target.closest('[data-edit]')) return;
  state.groups.forEach((g) => { g.visible = g.id === chip.dataset.gid; });
  selectedId = null;
  save();
  renderAll();
  fitAll();
});

$('#placeList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-id]');
  if (item) selectPlace(item.dataset.id);
});

$('#detailView').addEventListener('click', (e) => {
  const p = getPlace(selectedId);
  if (!p || e.target.closest('[data-stop]')) return;
  const actEl = e.target.closest('[data-act]');
  const act = actEl?.dataset.act;
  const i = state.places.indexOf(p);
  const n = state.places.length;

  if (act === 'back') return deselect();
  if (act === 'prev') return selectPlace(state.places[(i - 1 + n) % n].id);
  if (act === 'next') return selectPlace(state.places[(i + 1) % n].id);
  if (act === 'copy') {
    navigator.clipboard?.writeText(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`).then(() => toast('Coordinates copied'));
    return;
  }
  if (act === 'delete') {
    if (!confirm(`Remove “${p.name}” from the map?`)) return;
    state.places = state.places.filter((x) => x !== p);
    selectedId = null;
    save();
    renderAll();
    toast('Deleted');
    return;
  }
  if (act === 'moreimg') return loadImages(p, true);
  if (act === 'addimg') {
    const url = prompt('Paste an image link (URL).\nTip: in Google Images, open a photo → right-click → “Copy image address”.');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) return toast('Image link must start with http(s)://');
    p.images = [...(p.images || []), { thumb: url.trim(), full: url.trim(), page: url.trim(), title: p.name, src: 'Added manually', custom: true }];
    save();
    refreshImages(p);
    renderList();
    return;
  }
  if (act === 'rmimg') {
    p.images.splice(+actEl.dataset.i, 1);
    save();
    refreshImages(p);
    renderList();
    return;
  }

  const fig = e.target.closest('[data-img]');
  if (fig) return openLightbox(p.images, +fig.dataset.img);
  const li = e.target.closest('[data-goto]');
  if (li) selectPlace(li.dataset.goto);
});

$('#detailView').addEventListener('input', (e) => {
  const p = getPlace(selectedId);
  if (p && e.target.dataset.field === 'note') {
    p.note = e.target.value;
    saveSoon();
  }
});

$('#detailView').addEventListener('change', (e) => {
  const p = getPlace(selectedId);
  if (!p) return;
  const f = e.target.dataset.field;
  if (f === 'name') {
    const v = e.target.value.trim();
    if (!v) {
      e.target.value = p.name;
      return;
    }
    p.name = v;
    save();
    renderList();
    renderMarkers();
  } else if (f === 'groupId') {
    p.groupId = e.target.value;
    save();
    renderAll();
  }
});

// ---------- Menu ----------
$('#menu').addEventListener('click', (e) => {
  const act = e.target.closest('[data-menu]')?.dataset.menu;
  if (!act) return;
  $('#menu').open = false;
  if (act === 'export') exportData();
  if (act === 'import') $('#importFile').click();
  if (act === 'settings') {
    $('#gKey').value = settings.gKey || '';
    $('#gCx').value = settings.gCx || '';
    $('#settingsDlg').showModal();
  }
  if (act === 'clear') {
    if (!state.places.length) return toast('No places yet');
    if (!confirm(`Delete all ${state.places.length} places? Consider “Export data” first as a backup.`)) return;
    state.places = [];
    selectedId = null;
    save();
    renderAll();
  }
});

document.addEventListener('click', (e) => {
  if (!$('#menu').contains(e.target)) $('#menu').open = false;
});

document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close('cancel')));

$('#settingsDlg').addEventListener('close', () => {
  if ($('#settingsDlg').returnValue !== 'ok') return;
  settings = { gKey: $('#gKey').value.trim(), gCx: $('#gCx').value.trim() };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  toast(settings.gKey && settings.gCx ? 'Saved. Click “↻ Other photos” to fetch Google images.' : 'Saved. Using Wikimedia images.');
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bali-pins-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.places)) throw new Error('Invalid file format');
    let addedG = 0;
    let addedP = 0;
    (data.groups || []).forEach((g) => {
      if (g?.id && !state.groups.some((x) => x.id === g.id)) { state.groups.push(g); addedG++; }
    });
    data.places.forEach((p) => {
      if (p?.id && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !state.places.some((x) => x.id === p.id)) {
        state.places.push(p);
        addedP++;
      }
    });
    save();
    renderAll();
    fitAll();
    toast(`Imported ${addedP} place(s), ${addedG} group(s)`);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
});

document.addEventListener('keydown', (e) => {
  if (!$('#lightbox').hidden) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxStep(-1);
    if (e.key === 'ArrowRight') lightboxStep(1);
    return;
  }
  if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
    if (lastResults.length) clearResults();
    else if (selectedId) deselect();
  }
});

// Keep multiple open tabs in sync
window.addEventListener('storage', (e) => {
  if (e.key !== STORE_KEY) return;
  state = loadState();
  if (!getPlace(selectedId)) selectedId = null;
  renderAll();
});

// ================= UI helpers =================
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

let savedTimer;
function flashSaved() {
  const s = $('#saved');
  s.textContent = '✓ Saved';
  s.classList.add('flash');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    s.textContent = 'Auto-saved on this device';
    s.classList.remove('flash');
  }, 1500);
}

// ================= Startup =================
renderAll();
if (state.places.length) fitAll();
