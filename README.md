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
- `api/submissions.ts` — community "Add station" submissions, photo upload, and review trigger
- `api/submission-decision.ts` — signed Approve/Reject links from the review email
- `api/review-submission.ts` — secret-protected retry for the automated review
- `server/lib/submission-review.ts` — Google Places/OSM checks, Resend email, publishing, photo cleanup
- `api/enrich-place-photos.ts` — batch Google Places enrichment for new/changed stations
- `api/place-photo.ts` — CDN-cached proxy for Google Places photos (keeps the API key server-side)
- `api/station-feedback.ts` — community working/not-working/wrong-location reports
- `server/lib/place-enrichment.ts` — place matching, photo references, and rating/details cache
- `src/pages/StationDetail.tsx` — photo gallery, visit details, maps/app links, feedback FAB
- `server/lib/station-db.ts` — shared Postgres access helpers
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
- `/api/enrich-place-photos?limit=100` runs daily at `0 4 * * *` to add Google Places photos/details to stations added or changed by the catalog sync.
- Hobby crons run at most once per day with per-hour timing (±59 min), and functions have a 300s maximum duration.
- No GitHub Actions workflows or GitHub repository secrets are required.

For a manual refresh, use the **Sync Networks** button (which calls `/api/sync-trigger`, keeping `SYNC_SECRET` server-side) or POST directly to `/api/sync-ev-stations` with `Authorization: Bearer $SYNC_SECRET` (or `$CRON_SECRET`).

### Community submissions

The floating **+** button opens a form for a new station: name, location (auto-detected or manual), connector type, optional station/connector photos, and notes. Connector photos are read in the browser with the free `tesseract.js` OCR library; detected text is matched against the connector options and always confirmed by the reviewer.

Submissions are stored in `public.station_submissions` with status `pending`. The review service checks Google Places (with an OpenStreetMap Overpass fallback), writes its findings, emails `develop.sumit@gmail.com` via Resend with signed one-click **Approve & publish** / **Reject** links, and deletes the temporary photos from Vercel Blob once a decision is made. Approval upserts the station into `public.ev_charging_stations` with `source_name = 'Community submission'` and `location_quality = 'suspect'`.

Required Vercel environment variables:

- `BLOB_READ_WRITE_TOKEN` — Vercel Blob, for temporary photos (the `ruvo-submissions` public store is created and linked via `vercel blob create-store ruvo-submissions --access public --yes`)
- `RESEND_API_KEY` and `RESEND_FROM` — review/decision emails
- `REVIEW_SECRET` — HMAC signing for the email decision links
- `GOOGLE_MAPS_API_KEY` — Places API (New) verification
- `REVIEW_EMAIL` — optional, defaults to `develop.sumit@gmail.com`
- `APP_URL` — optional, defaults to the production Vercel URL

The dictionary schema lives in `supabase/migrations/20261118220000_enhance_station_dictionary.sql`, submissions in `supabase/migrations/20261120000000_create_station_submissions.sql`, and the frontend shape in `src/types/station.ts`.

### Station photos, detail view, and feedback

List rows are now photo-first: the primary Google Places photo (if available), station name, address, connector types, provider/status, and direct Directions/Charging app hooks. Tapping the row opens `/station/:id`, which shows a larger photo gallery (up to five Google photos), rating, website, payment/contact details, source accuracy, and maps/app links.

Google enrichment is continuous and incremental:

- A database trigger clears `google_place_id`, `photo_references`, `place_details`, and `photo_enriched_at` whenever a station's name, address, or coordinates change.
- The daily enrichment cron only queries rows where `photo_enriched_at IS NULL`, so new/changed stations are picked up automatically and existing rows are never re-queried.
- Removed catalog rows disappear with their photos and feedback via the foreign-key cascade.
- `GET /api/enrich-place-photos?limit=100` can be called manually with `Authorization: Bearer $SYNC_SECRET` (or `$CRON_SECRET`) to process a batch immediately.
- Photos are served through `/api/place-photo?ref=...&width=...`, which keeps `GOOGLE_MAPS_API_KEY` on the server and sets long-lived CDN cache headers.

The detail page also has a floating **Feedback** button. Reports (`working`, `not_working`, `wrong_location`, `other`) are stored in `public.station_feedback` and shown as community confidence counts and recent notes. Live "in use" and "recently used" sections are intentionally placeholders for future network integrations.

Schema: `supabase/migrations/20261120010000_add_station_place_photos_and_feedback.sql`.

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

The Ruvo bolt app icon (turquoise→emerald to match the UI theme) lives in `public/`:

- `ruvo-favicon-16.png`, `ruvo-favicon-32.png`, `ruvo-favicon-48.png` — browser tab icons (versioned URLs bust old cached favicons)
- `favicon.ico` — legacy fallback
- `apple-touch-icon.png` — iOS home screen (180×180)
- `ruvo-icon-192.png`, `ruvo-icon-512.png` — PWA manifest icons
- `ruvo-icon-1024.png` — master image for native launcher icons

When generating the native projects, use `public/ruvo-icon-1024.png` as the source
for Android's Image Asset Studio / adaptive icons and Xcode's `AppIcon` set.
