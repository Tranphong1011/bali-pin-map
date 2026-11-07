// Free photos for user pins, from Wikimedia Commons (by name + by location)

// Words too generic to use when matching image titles
const STOPWORDS = new Set(['the', 'and', 'bali', 'pura', 'temple', 'beach', 'pantai', 'jalan', 'cafe', 'restaurant',
  'villa', 'hotel', 'resort', 'desa', 'kabupaten', 'kecamatan', 'island', 'pulau', 'waterfall', 'air', 'terjun', 'gili', 'nusa']);

export const imageQuery = (p) =>
  (p.region && !p.name.toLowerCase().includes(p.region.toLowerCase()) ? `${p.name} ${p.region}` : p.name);
export const gimagesUrl = (p) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(imageQuery(p))}`;

function uniqBy(arr, key) {
  const seen = new Set();
  return arr.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
}

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

/** Pick 3 images; `page` > 0 rotates to the next 3 candidates. Keeps manually added images. */
export async function findImages(pin, page = 0) {
  const custom = (pin.images || []).filter((im) => im.custom);
  const found = await commonsImages(pin).catch(() => []);
  if (page * 3 >= found.length) page = 0;
  return {
    images: custom.concat(found.slice(page * 3, page * 3 + 3)),
    exhausted: found.length <= 3,
  };
}
