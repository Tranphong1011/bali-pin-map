# 🌴 Bali Pin Map

A map for planning a Bali trip. Search for places and pin them, sort them into color groups, and see how far apart they are. Turn on **⭐ Reference** to see every popular place in Bali and Nusa Penida (Google rating 4★ or higher, more than 1,000 reviews), each with up to 15 photos and videos taken from Google Maps.

- **Backend:** Django 5 + Django REST Framework, with PostgreSQL in production and SQLite locally.
- **Frontend:** React 18 + Vite + react-leaflet.
- **Scraper:** Playwright (`scraper/scrape_gmaps.py`). It runs on your own computer, not on the server.
- **Hosting:** a single Render web service. Django serves both the API and the built React app, and the database runs on Neon.

## Features

- **Search and pin.** Search uses OpenStreetMap (Nominatim + Photon). You can also paste coordinates or a full Google Maps link, or right-click the map to pin any spot.
- **Unpin.** Use ✕ on a list item, the *Unpin* button on a place's detail page, or *Pinned · Unpin* in the Reference panel.
- **Color groups.** Each group gets its own pin color. You can show or hide a group, or show only one group.
- **Distances.** The map shows each pin's nearest neighbour and dashed lines to its 3 closest pins, plus a full distance list with Google Maps directions.
- **Reference mode.** Popular places are drawn as circles. The darker the circle, the higher the rating and review count. Click one to open a side panel with its photos and videos, then pin it in one click. You can filter by area (Bali / Nusa Penida) and type (nature, temples, beach clubs, food, sights).
- **Read-only for visitors.** Anyone with the link can view the map. Pinning, unpinning and editing need `APP_PASSWORD`.

## Run locally

```bat
start.bat
```

This builds the frontend, migrates SQLite and opens http://localhost:8000.

For frontend development with hot reload, run the backend and Vite separately:

```bash
.venv/Scripts/python backend/manage.py runserver 8000
cd frontend && npm run dev        # http://localhost:5173, /api is proxied to Django
```

Tests: `.venv/Scripts/python backend/manage.py test places`

## Reference data (Google Maps scraping)

```bash
pip install -r scraper/requirements.txt
python scraper/scrape_gmaps.py                      # ~1–2 h, resumable; writes data/reference.json
python backend/manage.py load_reference             # upsert into the DB (SQLite locally)
```

To fill the production database, run `load_reference` with Neon's connection string:

```bash
DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" .venv/Scripts/python backend/manage.py load_reference
```

Notes:

- Scraping Google Maps is against Google's Terms of Service. Keep request volumes low and use the data for personal trip planning only. Scraped data (`data/`) is not committed.
- Google's video playback links expire after a few hours and are tied to an IP address. Videos are therefore stored as thumbnails linking to that exact video on Google Maps.
- If Google shows a captcha, re-run with `--headful`, solve it, and the script continues where it left off.

## Deploy (Render + Neon)

1. **Neon:** create a free project at https://neon.tech and copy the connection string.
2. **Render:** go to *New → Blueprint* and pick this repo. `render.yaml` sets up the service. Fill in the following:
   - `DATABASE_URL`: the Neon connection string
   - `APP_PASSWORD`: the password for editing on the live site
3. Load the reference data into Neon (see above).
4. Optional: to bring over pins from the first (localStorage) version, open it, use *⋯ → Export data*, then use *⋯ → Import data* on the live site.

Every push to `main` redeploys automatically. The free Render plan sleeps after 15 minutes of inactivity, so the first visit after that takes about 30–50 seconds.
