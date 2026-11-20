# Road to Charge — EV Charging Stations Finder

A Vite + React + TypeScript storefront for discovering EV charging stations across India. Deployed on Vercel with a Supabase Postgres database.

**Production:** https://road-to-charge-v2.vercel.app

## Local development

```sh
npm install
npm run dev
```

Node.js 24.x is used by Vercel. `.env` files are local-only and ignored by Git.

## Architecture

- `src/` — React UI, station types, and services
- `api/stations.ts` — direct-SQL read API used by the frontend
- `api/sync-ev-stations.ts` — catalog/availability sync API (protected by `SYNC_SECRET`)
- `api/sync-trigger.ts` — browser-friendly wrapper for the manual "Sync Networks" button
- `api/lib/station-db.ts` — shared Postgres access helpers
- `supabase/migrations/` — database schema for `public.ev_charging_stations`

The Supabase REST/PostgREST layer is not used; all reads and writes go through the direct Postgres connection (`POSTGRES_URL`).

## Charging station data sources

| Source | Detail added | Credentials |
| --- | --- | --- |
| BEE API (`ev-charging-stations-api.vercel.app`) | Station catalog, gun-level kW, vehicle classes, ownership, admin geography | keyless |
| OpenStreetMap Overpass | `socket:*` connectors, kW, fee, opening hours | keyless |
| Open Charge Map | base station list | `OPEN_CHARGE_MAP_API_KEY` |
| OpenEV – Delhi Transport | live connector availability, tariffs, payment modes | `OPEN_EV_API_KEY` |
| Google Places API (New) | live `evChargeOptions` availability per connector | `GOOGLE_MAPS_API_KEY` |
| OCPI 2.2.1 locations feed | live EVSE status and tariffs | `OCPI_LOCATIONS_URL`, `OCPI_TOKEN` |
| Legacy CPO scrapers / samples | Tata Power, Ather, NITI Aayog, Jio-bp, PlugShare, ChargeZone, ABB, BrightBlu, BEE India, Statiq | — |

Optional source credentials are set as Vercel environment variables.

### Sync modes

POST JSON to `/api/sync-ev-stations` with `Authorization: Bearer $SYNC_SECRET`:

| Body | Behaviour |
| --- | --- |
| `{"mode":"catalog"}` | Station records + dictionary fields |
| `{"mode":"availability"}` | Live status only; updates existing rows without overwriting catalog fields |
| `{"mode":"full"}` | Everything (default) |
| `{"maxPagesPerState":2}` | Extra BEE pages per state (1–10, default 1) |

### Scheduled updates

A Vercel Cron keeps the catalog current on the Hobby plan:

- `vercel.json` runs `/api/sync-ev-stations?mode=full&maxPagesPerState=2` daily at `0 3 * * *`.
- Hobby crons run at most once per day with per-hour timing (±59 min), and functions have a 300s maximum duration.
- No GitHub Actions workflows or GitHub repository secrets are required.

For a manual refresh, use the **Sync Networks** button (which calls `/api/sync-trigger`, keeping `SYNC_SECRET` server-side) or POST directly to `/api/sync-ev-stations` with `Authorization: Bearer $SYNC_SECRET` (or `$CRON_SECRET`).

The dictionary schema lives in `supabase/migrations/20261118220000_enhance_station_dictionary.sql` and the frontend shape in `src/types/station.ts`.

## Mobile app (Capacitor)

`capacitor.config.ts` uses app ID `com.ruvo.evcharging`, app name `Ruvo`, and loads
`https://road-to-charge-v2.vercel.app` so the wrapper uses the same live API as the
website. Native projects are not checked into this repo; create them with:

```bash
npm run build
npx cap add android
npx cap add ios
# later, after code changes
npm run build && npx cap sync
```

The Ruvo bolt app icon lives in `public/`:

- `ruvo-favicon-16.png`, `ruvo-favicon-32.png`, `ruvo-favicon-48.png` — browser tab icons (versioned URLs bust old cached favicons)
- `favicon.ico` — legacy fallback
- `apple-touch-icon.png` — iOS home screen (180×180)
- `ruvo-icon-192.png`, `ruvo-icon-512.png` — PWA manifest icons
- `ruvo-icon-1024.png` — master image for native launcher icons

When generating the native projects, use `public/ruvo-icon-1024.png` as the source
for Android's Image Asset Studio / adaptive icons and Xcode's `AppIcon` set.
