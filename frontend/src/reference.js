// Styling + filtering for "Reference" places (popular Google Maps places)

// Light → dark: low → high rating & review count
const SCALE = ['#fecdd3', '#fda4af', '#fb7185', '#e11d48', '#9f1239', '#4c0519'];

const clamp = (x) => Math.max(0, Math.min(1, x));

/** 0..1 — half rating (4.0 → 5.0), half review count (1k → 30k, log scale). */
export function refScore(p) {
  const r = clamp((p.rating - 4) / 1);
  const v = clamp((Math.log10(p.review_count) - 3) / (Math.log10(30000) - 3));
  return 0.5 * r + 0.5 * v;
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function refColor(score) {
  const x = clamp(score) * (SCALE.length - 1);
  const i = Math.min(Math.floor(x), SCALE.length - 2);
  const t = x - i;
  const a = hexToRgb(SCALE[i]);
  const b = hexToRgb(SCALE[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  return `rgb(${c.join(',')})`;
}

export const refRadius = (score) => 6 + score * 6;
export const REF_GRADIENT = `linear-gradient(90deg, ${SCALE.join(', ')})`;

export const BUCKETS = [
  { id: 'all', label: 'All' },
  { id: 'nature', label: '🌿 Nature', re: /beach|waterfall|park|hik|view|rice|lake|mountain|volcano|cliff|island|scenic|garden|forest|spring|cave|bay|nature|swing/i },
  { id: 'temple', label: '🛕 Temples', re: /temple|shrine|pura|church|mosque|religious|monastery/i },
  { id: 'club', label: '🍹 Beach clubs', re: /beach club|night ?club|lounge|bar\b|pub/i },
  { id: 'food', label: '🍜 Food & drink', re: /restaurant|cafe|café|coffee|bakery|warung|food|steak|pizza|sushi|bistro|eatery|diner|brunch|grill|bbq|seafood|dessert|ice cream|juice|tea house|deli|buffet|bar & grill/i },
  { id: 'sights', label: '📸 Sights', re: /attraction|museum|gallery|palace|monument|zoo|market|cultural|theater|theatre|landmark|historical|art|sanctuary|safari|water park|amusement|tour/i },
];

// Matching priority differs from display order: "Beach club" must not land in Nature
const MATCH_ORDER = ['club', 'temple', 'food', 'nature', 'sights'].map((id) => BUCKETS.find((b) => b.id === id));

/** First matching bucket id, or 'other'. */
export function bucketOf(category) {
  for (const b of MATCH_ORDER) {
    if (b.re.test(category || '')) return b.id;
  }
  return 'other';
}
