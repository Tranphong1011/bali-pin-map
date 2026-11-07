"""Scrape Google Maps for highly rated places in Bali & Nusa Penida.

Stage "list":  run many map searches and record every place (name, coords, rating, review count, category).
Stage "media": for places passing the filter, collect up to 15 photos/videos
               (place gallery + photos/videos attached to reviews).

Output is written incrementally to data/reference.json, so the script can be stopped and resumed.
Load it into the database with:  python backend/manage.py load_reference data/reference.json

Usage:
    python scraper/scrape_gmaps.py                 # both stages
    python scraper/scrape_gmaps.py --stage list
    python scraper/scrape_gmaps.py --stage media --concurrency 2
    python scraper/scrape_gmaps.py --headful       # show the browser (e.g. to solve a captcha)
"""
import argparse
import asyncio
import json
import random
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'reference.json'

MIN_REVIEWS = 1000  # strictly more than this
MIN_RATING = 4.0
MAX_MEDIA = 15
MAX_GALLERY = 10

ATTR, FOOD, CAFE, CLUB, BEACH, TEMPLE, FALLS = (
    'tourist attractions', 'restaurants', 'cafes', 'beach clubs', 'beaches', 'temples', 'waterfalls')

# (area label, lat, lng, zoom, search terms)
AREAS = [
    ('Bali', -8.40, 115.19, 10, [ATTR, TEMPLE, FALLS, BEACH, CLUB, 'rice terraces', 'viewpoints']),
    ('Ubud', -8.5069, 115.2625, 14, [ATTR, FOOD, CAFE, TEMPLE]),
    ('Tegallalang', -8.43, 115.28, 13, [ATTR, FALLS, FOOD]),
    ('Gianyar', -8.54, 115.33, 12, [ATTR, FALLS]),
    ('Seminyak', -8.6913, 115.1682, 15, [ATTR, FOOD, CAFE, CLUB]),
    ('Canggu', -8.6478, 115.1385, 14, [ATTR, FOOD, CAFE, CLUB]),
    ('Kuta', -8.7184, 115.1686, 14, [ATTR, FOOD, CLUB, BEACH]),
    ('Jimbaran', -8.7907, 115.1600, 14, [ATTR, FOOD, BEACH]),
    ('Uluwatu', -8.8150, 115.1050, 13, [ATTR, FOOD, CLUB, BEACH]),
    ('Nusa Dua', -8.8000, 115.2300, 14, [ATTR, FOOD, BEACH]),
    ('Sanur', -8.6900, 115.2620, 14, [ATTR, FOOD, CAFE]),
    ('Denpasar', -8.6500, 115.2167, 13, [ATTR, FOOD]),
    ('Tabanan', -8.45, 115.10, 12, [ATTR, FOOD]),
    ('Bedugul', -8.27, 115.15, 12, [ATTR, FALLS, FOOD]),
    ('Kintamani', -8.25, 115.33, 12, [ATTR, FOOD]),
    ('Karangasem', -8.40, 115.55, 11, [ATTR, FOOD, BEACH]),
    ('Lovina', -8.16, 115.02, 12, [ATTR, FOOD, FALLS]),
    ('West Bali', -8.30, 114.60, 11, [ATTR]),
    ('Klungkung', -8.50, 115.40, 12, [ATTR]),
    ('Nusa Penida', -8.73, 115.54, 12, [ATTR, BEACH, FOOD]),
    ('Nusa Lembongan', -8.68, 115.45, 14, [ATTR, FOOD, CLUB]),
]


def in_bali(lat, lng):
    return -8.95 < lat < -8.04 and 114.42 < lng < 115.72


def area_of(lat, lng):
    # Nusa Penida, Lembongan and Ceningan
    return 'penida' if 115.42 < lng < 115.66 and -8.86 < lat < -8.64 else 'bali'


def passes(p):
    return (p.get('rating') or 0) >= MIN_RATING and (p.get('reviews') or 0) > MIN_REVIEWS


def sized(url, size):
    """googleusercontent URLs end with a size spec like '=w203-h114-k-no'; swap it."""
    base = re.sub(r'=[\w-]*$', '', url)
    return f'{base}={size}'


def load():
    if OUT.exists():
        return json.loads(OUT.read_text(encoding='utf-8'))
    return {'places': {}, 'done_queries': []}


def save(db):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix('.tmp')
    tmp.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(OUT)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


class Blocked(Exception):
    pass


async def check_blocked(page):
    if '/sorry/' in page.url:
        raise Blocked('Google is showing a captcha. Re-run with --headful and solve it, then continue.')


# ---------------------------------------------------------------- stage 1: list
PARSE_FEED = r"""() => [...document.querySelectorAll('div[role=feed] a.hfpxzc')].map(a => {
  const card = a.closest('div.Nv2PK') || a.parentElement;
  const star = [...card.querySelectorAll('[role=img][aria-label]')]
      .map(x => x.getAttribute('aria-label')).find(t => /stars?/.test(t)) || '';
  const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const ri = lines.findIndex(l => /^\d[.,]\d\s*\(/.test(l));
  const category = ri >= 0 && lines[ri + 1] ? lines[ri + 1].split('·')[0].trim() : '';
  return { name: a.getAttribute('aria-label'), href: a.href, star, category };
})"""


def parse_card(c):
    m_id = re.search(r'!1s(0x[0-9a-f]+:0x[0-9a-f]+)', c['href'])
    m_lat = re.search(r'!3d(-?\d+\.\d+)', c['href'])
    m_lng = re.search(r'!4d(-?\d+\.\d+)', c['href'])
    m_star = re.search(r'([\d.,]+)\s*stars?\s*([\d,.]+)\s*Review', c['star'])
    if not (m_id and m_lat and m_lng and m_star):
        return None
    return {
        'id': m_id.group(1),
        'name': c['name'],
        'lat': float(m_lat.group(1)),
        'lng': float(m_lng.group(1)),
        'rating': float(m_star.group(1).replace(',', '.')),
        'reviews': int(re.sub(r'[^\d]', '', m_star.group(2))),
        'category': c['category'],
        'url': c['href'].split('?')[0] + '?hl=en',
    }


async def run_query(page, query, lat, lng, zoom):
    url = f'https://www.google.com/maps/search/{quote_plus(query)}/@{lat},{lng},{zoom}z?hl=en'
    await page.goto(url, wait_until='domcontentloaded')
    await check_blocked(page)
    try:
        await page.wait_for_selector('div[role=feed]', timeout=15000)
    except Exception:
        return []  # a single place opened directly, or no results
    last, stable = -1, 0
    for _ in range(40):
        await page.evaluate("() => { const f = document.querySelector('div[role=feed]'); f && (f.scrollTop = f.scrollHeight); }")
        await page.wait_for_timeout(1300)
        n = await page.locator('div[role=feed] a.hfpxzc').count()
        end = await page.locator("text=You've reached the end of the list").count()
        if end:
            break
        stable = stable + 1 if n == last else 0
        if stable >= 4:
            break
        last = n
    return [p for p in map(parse_card, await page.evaluate(PARSE_FEED)) if p]


async def stage_list(ctx, db):
    page = await ctx.new_page()
    queries = [(f'{term} in {area}', lat, lng, zoom) for area, lat, lng, zoom, terms in AREAS for term in terms]
    for i, (q, lat, lng, zoom) in enumerate(queries, 1):
        if q in db['done_queries']:
            continue
        found = await run_query(page, q, lat, lng, zoom)
        new = 0
        for p in found:
            if not in_bali(p['lat'], p['lng']):
                continue
            old = db['places'].get(p['id'])
            if old:
                old.update({k: p[k] for k in ('rating', 'reviews', 'name', 'url')})
                if not old.get('category'):
                    old['category'] = p['category']
            else:
                p['area'] = area_of(p['lat'], p['lng'])
                p['media'] = None
                db['places'][p['id']] = p
                new += 1
        db['done_queries'].append(q)
        save(db)
        ok = sum(passes(p) for p in db['places'].values())
        log(f'[{i}/{len(queries)}] "{q}": {len(found)} results, {new} new · total {len(db["places"])}, passing filter {ok}')
        await page.wait_for_timeout(random.randint(800, 2000))
    await page.close()


# ---------------------------------------------------------------- stage 2: media
REVIEW_MEDIA = r"""() => [...document.querySelectorAll('button[style*="background-image"]')]
  .filter(b => /on .+'s review|^Video$/.test(b.getAttribute('aria-label') || ''))
  .map(b => {
    const aria = b.getAttribute('aria-label');
    const who = (aria.match(/on (.+)'s review/) || [])[1] || '';
    const bg = (b.style.backgroundImage.match(/url\("?(.+?)"?\)/) || [])[1];
    const dur = (b.innerText.match(/\d+:\d\d/) || [])[0] || '';
    return { bg, dur, video: aria === 'Video' || !!dur, author: who };
  })"""

GALLERY = r"""() => [...document.querySelectorAll('a[data-photo-index]')].map(a => {
  const el = a.querySelector('[style*="background-image"]');
  const bg = el ? (el.style.backgroundImage.match(/url\("?(.+?)"?\)/) || [])[1] : '';
  const dur = (a.innerText.match(/\d+:\d\d/) || [])[0] || '';
  return { idx: a.dataset.photoIndex, bg, dur, video: a.getAttribute('aria-label') === 'Video' || !!dur };
})"""


def media_item(raw, source, link):
    if not raw.get('bg') or 'googleusercontent' not in raw['bg']:
        return None
    return {
        'type': 'video' if raw['video'] else 'photo',
        'thumb': sized(raw['bg'], 'w480-h360-k-no'),
        'full': sized(raw['bg'], 'w1600-h1200-k-no'),
        'duration': raw.get('dur') or '',
        'link': link,
        'source': source,
        'author': raw.get('author', ''),
    }


async def scrape_media(page, p):
    await page.goto(p['url'], wait_until='domcontentloaded')
    await check_blocked(page)
    await page.wait_for_selector('h1', state='attached', timeout=20000)
    await page.wait_for_timeout(2500)

    addr = page.locator('button[data-item-id="address"]')
    if await addr.count():
        p['address'] = (await addr.first.get_attribute('aria-label') or '').replace('Address:', '').strip()

    reviews = [media_item(r, 'review', p['url']) for r in await page.evaluate(REVIEW_MEDIA)]

    gallery = []
    hero = page.locator('button[aria-label^="Photo of"]')
    if await hero.count():
        await hero.first.click()
        try:
            await page.wait_for_selector('a[data-photo-index]', timeout=10000)
            await page.wait_for_timeout(1500)
            raw = (await page.evaluate(GALLERY))[:MAX_GALLERY]
            for r in raw:
                link = p['url']
                if r['video']:
                    # the URL changes to a deep link of that exact video when it is opened
                    try:
                        await page.locator(f'a[data-photo-index="{r["idx"]}"]').click()
                        await page.wait_for_timeout(1200)
                        link = page.url
                    except Exception:
                        pass
                gallery.append(media_item(r, 'gallery', link))
        except Exception:
            pass

    seen, media = set(), []
    for m in gallery + reviews:
        if not m:
            continue
        key = re.sub(r'=[\w-]*$', '', m['full'])
        if key in seen:
            continue
        seen.add(key)
        media.append(m)
        if len(media) >= MAX_MEDIA:
            break
    return media


async def stage_media(ctx, db, concurrency, refresh):
    todo = [p for p in db['places'].values() if passes(p) and (refresh or p.get('media') is None)]
    log(f'{len(todo)} places need media')
    queue = asyncio.Queue()
    for p in todo:
        queue.put_nowait(p)
    done = 0
    blocked = []

    async def worker():
        nonlocal done
        page = await ctx.new_page()
        while not queue.empty() and not blocked:
            p = await queue.get()
            try:
                p['media'] = await scrape_media(page, p)
                done += 1
                n_vid = sum(m['type'] == 'video' for m in p['media'])
                log(f'[{done}/{len(todo)}] {p["name"]}: {len(p["media"])} media ({n_vid} video)')
                save(db)
            except Blocked as e:
                blocked.append(e)
            except Exception as e:
                log(f'  ! {p["name"]}: {type(e).__name__}: {str(e)[:120]}')
            await page.wait_for_timeout(random.randint(500, 1500))
        await page.close()

    await asyncio.gather(*(worker() for _ in range(concurrency)))
    if blocked:
        raise blocked[0]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', choices=['list', 'media', 'all'], default='all')
    ap.add_argument('--concurrency', type=int, default=2)
    ap.add_argument('--headful', action='store_true')
    ap.add_argument('--refresh-media', action='store_true', help='re-scrape media even if already present')
    args = ap.parse_args()

    db = load()
    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.launch(channel='msedge', headless=not args.headful)
        except Exception:
            browser = await pw.chromium.launch(headless=not args.headful)
        ctx = await browser.new_context(locale='en-US', viewport={'width': 1300, 'height': 900})
        await ctx.route(re.compile(r'\.(mp4|webm)(\?|$)|googlevideo\.com'), lambda r: r.abort())
        try:
            if args.stage in ('list', 'all'):
                await stage_list(ctx, db)
            if args.stage in ('media', 'all'):
                await stage_media(ctx, db, args.concurrency, args.refresh_media)
        except Blocked as e:
            log(str(e))
            sys.exit(2)
        finally:
            save(db)
            await browser.close()
    ok = [p for p in db['places'].values() if passes(p)]
    log(f'Done. {len(db["places"])} places scraped, {len(ok)} pass the filter '
        f'(>{MIN_REVIEWS} reviews, >={MIN_RATING}★). Output: {OUT}')


if __name__ == '__main__':
    asyncio.run(main())
