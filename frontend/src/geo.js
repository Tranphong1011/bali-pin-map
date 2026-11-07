export const BALI_CENTER = [-8.45, 115.19];

export function distKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtKm(d) {
  if (d < 1) return Math.round(d * 1000) + ' m';
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
}

export const distClass = (d) => (d < 5 ? 'near' : d < 15 ? 'mid' : 'far');

export function nearestTo(pt, n, pool) {
  return pool
    .filter((o) => o.id !== pt.id)
    .map((o) => ({ place: o, d: distKm(pt, o) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
}

export const gmapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const dirUrl = (a, b) =>
  `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
