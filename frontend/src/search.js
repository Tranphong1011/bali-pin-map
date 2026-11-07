import { BALI_CENTER, distKm } from './geo';

const inRegion = (r) => r.lat < -7.4 && r.lat > -9.3 && r.lng > 114.0 && r.lng < 117.2;

async function searchNominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({
    q, format: 'jsonv2', limit: '8', addressdetails: '1', countrycodes: 'id',
    'accept-language': 'en', viewbox: '114.0,-7.4,117.2,-9.3', bounded: '0',
  });
  const r = await fetch(u);
  if (!r.ok) throw new Error('Nominatim ' + r.status);
  return (await r.json()).map((d) => ({
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

export async function reverseGeocode(lat, lng) {
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

/** Returns { results } or { message } for things that can't be searched. */
export async function searchPlaces(q) {
  q = q.trim();
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(q)) {
    return {
      results: [],
      message: "Short links can't be read directly. Open the link in your browser, wait for Google Maps to load, "
        + 'then copy the full URL from the address bar and paste it here.',
    };
  }
  const direct = parseDirectInput(q);
  if (direct) {
    if (!direct.name) {
      const info = await reverseGeocode(direct.lat, direct.lng).catch(() => null);
      direct.name = info?.name || `Location ${direct.lat.toFixed(4)}, ${direct.lng.toFixed(4)}`;
      direct.address = info?.address || '';
      direct.region = info?.region || '';
    }
    return { results: [direct] };
  }

  const [a, b] = await Promise.allSettled([searchNominatim(q), searchPhoton(q)]);
  if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  const merged = [];
  for (const r of [...(a.value || []), ...(b.value || [])]) {
    const dup = merged.some((o) => distKm(o, r) < 0.3 && o.name.toLowerCase() === r.name.toLowerCase());
    if (!dup) merged.push(r);
  }
  merged.sort((x, y) => inRegion(y) - inRegion(x)); // prefer Bali & surroundings
  return { results: merged.slice(0, 10) };
}
