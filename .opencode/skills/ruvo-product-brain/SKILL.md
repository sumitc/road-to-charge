---
name: Ruvo Product Brain
description: Persistent product knowledge for the Ruvo EV charging finder (road-to-charge) — brand rules, Vercel/Supabase infra, data model, Google Places photo enrichment, UX flows, Capacitor APK + AdMob, performance decisions, verification commands, and known quirks. Read this before exploring or editing; update it after every substantive change or when explicitly asked.
---

# Ruvo Product Brain — living project memory

**Source of truth:** this skill is a living summary. Code + `README.md` win if they disagree — then fix this file. Update it at the end of every substantive change (schema, API, UI behavior, infra, bugs fixed, verification results). It is registered globally via `~/.config/opencode/opencode.json` and also lives in the repo so it travels with the code.

Repo: `/Users/sumitc/projects/road-to-charge` (public GitHub: `sumitc/road-to-charge`)
Production: `https://road-to-charge-v2.vercel.app`
Vercel project: `road-to-charge-v2`, id `prj_Dv37B44pqmZruQkGkMLUJdDpT8XY`
Supabase ref: `wcextqwiceknlgcvrnxn` (Hobby/free tier)

## Vision / non-negotiables

- Product is **Ruvo**, an EV-charging station finder for Indian cities. Brand stays **Ruvo** everywhere.
- Native app id is **`com.ruvo.evcharging`**. Favicon/icon is the **Ruvo bolt** (turquoise→emerald). Never use Lovable assets or branding.
- Mobile-first: reduce vertical chrome so results appear sooner. Speed-first connector filter stays beside distance/radius on mobile. No redundant Refresh button.
- List view is photo-first: image, location title, connector badges, hooks to Maps/charging app, Details.
- Detail view: bigger/multiple Google photos, richer place details, Maps/app links, future in-use/recent-visit hooks, floating feedback FAB (working / not working / other).
- Community submissions: photo uploads to Vercel Blob, OCR + map verification, review email, signed approve/reject links, delete photos after review.
- Google Maps API key is server-only; photos go through `/api/place-photo`. The key must never reach the browser.
- Secrets stay local or in Vercel only. Repo is public; never commit keys, sync secrets, or real credentials.

## Decisions (locked unless the user changes them)

- **R1** Vercel + fresh Supabase on Hobby/free tier only. No Vercel Marketplace DBs.
- **R2** Direct Postgres SQL from serverless functions; Supabase REST/PostgREST is unusable here (`exceed_storage_size_quota`).
- **R3** Vercel Cron (not GitHub Actions). GitHub workflows/secrets were deleted.
- **R4** Google Places API (New) `searchText` with field mask including `photos.name`, rating, website, business status, maps URI.
- **R5** Store `google_place_id`, `photo_references`, `place_details`, `photo_enriched_at` on station rows; proxy images through `/api/place-photo` with CDN cache headers.
- **R6** `station_feedback.station_id` is `uuid` with FK `ON DELETE CASCADE` (text/uuid mismatch was a real bug).
- **R7** DB trigger `reset_station_place_enrichment_on_update` resets enrichment when station name/address/lat/lng changes, so catalog refreshes re-enrich changed stations.
- **R8** Server helpers live in `server/lib/`, not `api/lib/`, to stay under Vercel Hobby's 12-function limit. Imports use explicit `.js` suffixes.
- **R9** Google lookups may run in parallel; Postgres writes and feedback GETs are sequential to avoid pooled-connection deadlocks.
- **R10** Matcher strips catalog metadata (`City=`, `District=`, `State=`), maps provider aliases (`IOCL`→`IndianOil`, `BPCL`→`Bharat Petroleum`, `HPCL`→`Hindustan Petroleum`), adds a fuel-pump fallback query, accepts very close branded matches, and prefers listings with photos on distance ties.
- **R11** Full BEE snapshot imported from the upstream project's static `backend/data/stations.json` via `scripts/import-full-bee-snapshot.mjs`; catalog is now **29,215 rows** (29,184 BEE + 31 Google Places gap-fill rows). The old 14 hard-coded demonstration rows (including fake "PlugShare" entries) were deleted. PlugShare's API is commercial-only, so it is not a data source; its extra Kokapet coverage is approximated with live Google Places catalog rows.
- **R12** Android native project is checked in at `android/`. Debug APK is built with JDK 21 + Android SDK 35. Permissions: INTERNET, coarse/fine location, CAMERA, image storage (camera optional).
- **R13** AdMob bottom banner uses `@capacitor-community/admob@7.2.0` with Google's public test IDs: App ID in `android/app/src/main/res/values/strings.xml`, banner unit ID in `src/components/AdBanner.tsx` overridable with `VITE_ADMOB_BANNER_AD_ID`. UMP now gates on `consent.canRequestAds`, sets `isTesting: true` for test IDs, and logs load/failure events as `[RuvoAd]`. Native-only; no-op in browser. Browser ads use `src/components/WebAdBanner.tsx` with AdSense; it is a no-op unless both `VITE_ADSENSE_CLIENT_ID` and `VITE_ADSENSE_SLOT_ID` are set in Vercel.
- **R14** List→detail→back lag is fixed with React Query caching (location + station lists + detail + feedback), a compact/proximity-sorted distance API with CDN cache headers, instant cached geolocation, local favourite state, and scroll restoration. See "Performance state (done)" below.
- **R15** Route-level code splitting: `StationDetail` and `TripPlanner` are `React.lazy` chunks. The default list view must stay the small entry chunk; do not statically import detail/trips back into the entry.
- **R16** Daily catalog sync now only uses real sources: BEE API pages, OpenStreetMap Overpass, and Google Places catalog. All hard-coded provider "samples" (Tata/Ather/Jio-bp/PlugShare/ChargeZone/ABB/BrightBlu/Statiq/NITI) were removed from the fetch list because they were fabricated.
- **R17** Detail speed: station cards seed the React Query detail cache on touch/focus and prefetch station + feedback; `mode=id` and feedback GET responses use `Vercel-CDN-Cache-Control`; feedback is one SQL query instead of four; hero photo is 800px eager. Measured warm detail API **0.42 s HIT**, feedback **0.38 s HIT**; clean browser list→card→detail loads in ~0.7 s.

## Architecture map

Frontend (Vite + React 18 + TypeScript + Tailwind + shadcn/ui, **not Next.js**):
- `src/App.tsx` — QueryClientProvider, TooltipProvider, toasts, BrowserRouter, routes `/`, `/station/:id`, `*`; renders `<AdBanner />` and `<WebAdBanner />` globally.
- `src/pages/Index.tsx` — renders `EVApp`; now also handles scroll restoration for list→detail→back.
- `src/components/EVApp.tsx` — header, tabs (Stations / Trips / Saved), location, sync button, `ContributionButton`.
- `src/components/NearbyStations.tsx` — search card, radius select, `ConnectorFilter`, loading/empty states, station list. Uses `useNearbyStations`/`useStationSearch`.
- `src/components/StationCard.tsx` — photo-first row, Maps/app/Directions/Details/Favourite actions.
- `src/pages/StationDetail.tsx` — gallery, details, Maps/app links, feedback sheet + FAB. Uses `useStationDetail`/`useStationFeedback`.
- `src/components/ContributionButton.tsx` — community submission sheet (camera/gallery, OCR, verification, review email).
- `src/components/AdBanner.tsx` — native AdMob banner, sets `--ruvo-banner-height` CSS var so FABs/list bottom stay clear.
- `src/components/WebAdBanner.tsx` — browser-only AdSense banner; no-op without both Vite AdSense env vars.
- `src/hooks/useStationQueries.ts` — React Query keys and hooks for location, nearby, search, detail, feedback, plus `usePrefetchStation()` used by station cards.
- `src/services/` — `evStationService.ts` (API mapping), `locationService.ts` (cached geolocation), `favouritesService.ts`, `appIconService.ts`, `chargingStationsSync.ts`.
- `src/lib/` — `connectorLabels.ts`, `appLinks.ts`, `placePhotos.ts`, `utils.ts`.

Serverless API (`api/`, Vercel Node functions, direct Postgres):
- `api/stations.ts` — `mode=all|distance|bounds|search|filters|stats|id`. Distance mode is the list hot path.
- `api/place-photo.ts` — Google Places photo proxy with CDN cache headers.
- `api/station-feedback.ts` — GET/POST community feedback.
- `api/enrich-place-photos.ts` — secret-protected batch enrichment (`Authorization: Bearer $SYNC_SECRET`).
- `api/sync-ev-stations.ts` — secret-protected catalog sync.
- `api/review-submission.ts` and related review endpoints — signed approve/reject, Blob cleanup.
- `server/lib/place-enrichment.ts` — query builder, provider aliases, matcher, batch runner.
- `scripts/import-full-bee-snapshot.mjs` — one-off full BEE JSON import + fake-row cleanup.
- `scripts/enrich-google-catalog.mjs` — targeted photo enrichment for Google Places gap-fill rows only (avoids spending credits on all 29k rows at once).

Data / infra:
- `supabase/migrations/20261120010000_add_station_place_photos_and_feedback.sql` — photo columns, `station_feedback`, reset trigger.
- `vercel.json` — two crons: `0 3 * * *` full sync (`?mode=full&maxPagesPerState=2`), `0 4 * * *` enrichment (`?limit=100`); SPA rewrite for `/station/:id`.
- `capacitor.config.ts` — app id/name, `webDir: dist`, remote server URL, splash config.
- `android/` — checked-in Capacitor Android project with Ruvo icons/splash, permissions, AdMob metadata.
- `public/ruvo-icon-1024.png` — master for browser/PWA/native icons.
- Gitignored local artifacts: `.env.vercel`, `.sync-secret.tmp`, `*.apk`, `android/local.properties`, generated web assets.

Environment (names only, never values): `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SYNC_SECRET`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` (optional; default `Ruvo <onboarding@resend.dev>` works), `BLOB_READ_WRITE_TOKEN`, `REVIEW_SECRET`, `VITE_ADMOB_BANNER_AD_ID` (optional), `VITE_ADSENSE_CLIENT_ID` + `VITE_ADSENSE_SLOT_ID` (optional, both required for web ads). Preview env is not fully configured; test against production or local.

## UX flows to preserve

1. **Find stations:** location cached → nearby query by rounded lat/lng + radius → photo-first cards. Connector filter is speed-first multi-select beside radius on mobile. Search accepts area/city text; results set the map center via `onLocationUpdate`.
2. **Detail:** tap card → `/station/:id` → cached detail query + feedback query → gallery/details/links. Back button or browser back returns to `/` with cached list and restored scroll.
3. **Community report:** floating **+** → sheet → photo + OCR + Google/OSM verification → Resend review email to `develop.sumit@gmail.com` with signed links → approve/reject → Blob photo cleanup on reject/review completion.
4. **Feedback:** floating Feedback FAB on detail → working / not working / wrong location / other + note → `station_feedback` → counts/recent list updates.
5. **Mobile APK:** Android WebView loads the live Vercel app; AdMob banner is native at bottom; CSS var reserves height; FABs sit above it.

## Performance state (done — Nov 20 2026)

User reported lag and a full reload when going back from details to the list. Root causes found:
- `EVApp` remounted on route change and re-ran `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy: true` (up to 10s) plus a toast every time.
- `NearbyStations` had no cache; `useEffect` refetched the whole list on every mount/radius change. Favourite toggle also triggered a full refetch via `onFavouriteToggle={loadNearbyStations}`.
- `StationDetail` fetched station + feedback fresh on every visit, sequentially.
- Measured list API before fix: **2.75 s / 107 KB for 36 rows** (full rows with `place_details`, up to 500 rows by `last_updated`).
- No scroll restoration on back.

Fixes shipped (do not revert):
- `src/hooks/useStationQueries.ts`: React Query keys + hooks. `staleTime` 5 min (location/nearby/detail), 10 min (search), `gcTime` 30 min for station data and `Infinity` for location. `refetchOnWindowFocus: false` everywhere.
- `src/services/locationService.ts`: last location in `localStorage`, `enableHighAccuracy: false`, 8s timeout, 5-min `maximumAge`, Delhi fallback resolves instead of rejects.
- `EVApp`: uses `useUserLocation()` (no geolocation on remount, no toast), updates the query cache on search, and invalidates `['stations']` after sync instead of `window.location.reload()`.
- `NearbyStations`: data from `useNearbyStations`; `isPending` gates first load only, cached rows stay visible while `isFetching`; search uses `queryClient.fetchQuery` so it is cached too; one-time empty-catalog sync guarded by a ref; no refetch on favourite tap.
- `api/stations.ts`: distance mode selects ~20 compact columns, `photo_references[1:1]`, rating-only `place_details`, SQL proximity ordering, `limit` default 100 (200 for radius > 10, max 200), CDN cache headers. Other modes still `SELECT *`.
- `StationCard`: local favourite state, `React.memo`, `decoding="async"`. `onFavouriteToggle` is optional and **only** passed by the Saved tab, which needs to refresh its list.
- `StationDetail`: `useStationDetail` + `useStationFeedback` run in parallel and are cached; feedback refresh uses `refetch`.
- `Index.tsx`: saves/restores `window.scrollY` in `sessionStorage` across detail navigation.
- `App.tsx`: `StationDetail` is a lazy route chunk; `EVApp` lazy-loads `TripPlanner`; Suspense fallbacks are minimal spinners.

Measured after: distance API **32.5 KB for 36 rows** (~70% smaller); cold ~2.3 s, **warm CDN HIT 0.37 s**. Entry JS **418 KB / 133 KB gzip** (was 606 KB / 188 KB), with 25 KB detail and 163 KB trip chunks loaded on demand. Vercel reports `X-Vercel-Cache: HIT` on repeat requests even though the response header is normalized to `Cache-Control: public`.

## Verification / commands (memorize)

```bash
cd /Users/sumitc/projects/road-to-charge
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
npm run build
git add -A && git commit -m "..." && git push origin main
vercel --prod --yes
# Patterns split here so the scan does not match its own documentation.
SECRET_RE=$(printf 'AI%s|re_%s' 'za' 'YFQa')
git grep -nE "$SECRET_RE" -- . ':!package-lock.json'   # must be clean
```

Manual enrichment batch:
```bash
curl -X GET 'https://road-to-charge-v2.vercel.app/api/enrich-place-photos?limit=200' \
  -H "Authorization: Bearer $(cat .sync-secret.tmp | tr -d '\n')"
```

Full catalog import / targeted gap-fill:
```bash
curl -sSL 'https://raw.githubusercontent.com/shrinivas-sn/ev-charging-stations-api/main/backend/data/stations.json' \
  -o /tmp/ruvo-bee-stations.json
node --experimental-strip-types scripts/import-full-bee-snapshot.mjs /tmp/ruvo-bee-stations.json
# After a sync adds Google Places catalog rows:
node --experimental-strip-types scripts/enrich-google-catalog.mjs
curl -sS 'https://road-to-charge-v2.vercel.app/api/stations?mode=search&q=Kokapet' | head -c 500
```

List API smoke test (replace coords):
```bash
curl --http1.1 -sS 'https://road-to-charge-v2.vercel.app/api/stations?mode=distance&lat=17.48&lng=78.40&radius=10'
# Expect ~30 KB / 36 rows near Hitech City, X-Vercel-Cache: HIT on the 2nd call.
curl --http1.1 -sS -o /dev/null -D - -w '%{time_total}\n' \
  'https://road-to-charge-v2.vercel.app/api/stations?mode=distance&lat=17.48&lng=78.40&radius=10'
```

APK rebuild (SDK path in this machine was temp; set your own `ANDROID_HOME`):
```bash
export ANDROID_HOME=<android-sdk>
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

DB stats pattern: read `.env.vercel`, connect with `postgres` using `POSTGRES_URL_NON_POOLING`, query `count(*)`, `cardinality(photo_references)>0`, `photo_enriched_at IS NULL`.

## Known quirks / gotchas

- Old `https://road-to-charge.vercel.app` still serves stale Lovable-era icons. Always use the `-v2` project.
- Vercel Hobby has a 12-function limit; adding helpers under `api/` can push over it. Keep shared code in `server/lib/` with explicit `.js` import suffixes.
- Pooled Postgres writes in parallel caused deadlocks; keep writes sequential. Feedback GET is now a single query, not four sequential queries.
- Vercel Functions need the `Vercel-CDN-Cache-Control` header (not just `Cache-Control`) for CDN HITs. `mode=id` has an early return that needs its own cache headers; the first fix only covered the tail response and showed `X-Vercel-Cache: MISS`.
- A previous `/api/lib/submission-db` import caused a runtime `Cannot find module` error; keep helpers in `server/lib/`.
- Feedback FK type mismatch (`text` vs `uuid`) and `FUNCTION_INVOCATION_TIMEOUT` were fixed; don't reintroduce them.
- Google matcher must strip `City=…, District=…, State=…` from station names; raw text queries returned irrelevant results. Provider aliases matter.
- `/api/stations` and `/api/place-photo` caching is intentional; stale browser cache was ruled out as the missing-photo cause (the data was genuinely un-enriched).
- `/api/station-feedback` GET is sequential to avoid deadlocks; POST uses the uuid FK.
- Entry bundle is ~418 KB (133 KB gzip) after code splitting; detail/trips are separate lazy chunks. Still above Vite's 500 kB-style warning threshold historically, but no longer a single monolith.
- iOS native project is not checked in; only Android is supported right now.
- AdMob IDs are public test IDs. Production needs both the native `strings.xml` App ID and Vercel `VITE_ADMOB_BANNER_AD_ID`, then a web redeploy + APK rebuild. Web-only changes do **not** need an APK rebuild because the APK loads the live Vercel URL.
- PlugShare does not offer a personal/non-commercial API license; never scrape or present its data as a direct source. Its apparent extra Kokapet coverage is now approximated by Google Places catalog rows.
- Full BEE snapshot is 29,184 rows / ~21 MB from `https://raw.githubusercontent.com/shrinivas-sn/ev-charging-stations-api/main/backend/data/stations.json`. Do not enrich all 29k rows with Google Places at once (cost); enrich targeted localities with `scripts/enrich-google-catalog.mjs`.
- Secrets: Google key was pasted in chat historically but never committed. Restrict/rotate when convenient. Keep `git grep` clean.

## Working rules

- Prefer targeted edits that preserve existing naming/style. Keep the mobile header compact.
- Never remove the speed-first connector filter or re-add a redundant Refresh button.
- After any change: typecheck, build, commit/push, deploy, secret scan, then **update this skill** (decisions, architecture, active work, verification results).
- When the user reports a UX problem, measure first (API timing/payload, refetch count, geolocation latency) before changing code.
