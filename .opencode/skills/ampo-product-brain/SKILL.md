---
name: Ampo Product Brain
description: Persistent product knowledge for the Ampo EV charging finder (road-to-charge) — brand rules, Vercel/Supabase infra, data model, Google Places photo enrichment, UX flows, Capacitor APK + AdMob, performance decisions, verification commands, and known quirks. Read this before exploring or editing; update it after every substantive change or when explicitly asked.
---

# Ampo Product Brain — living project memory

**Source of truth:** this skill is a living summary. Code + `README.md` win if they disagree — then fix this file. Update it at the end of every substantive change (schema, API, UI behavior, infra, bugs fixed, verification results). It is registered globally via `~/.config/opencode/opencode.json` and also lives in the repo so it travels with the code.

Repo: `/Users/sumitc/projects/road-to-charge` (public GitHub: `sumitc/road-to-charge`)
Production: `https://ampo.vercel.app`
Vercel project: `road-to-charge-v2`, id `prj_Dv37B44pqmZruQkGkMLUJdDpT8XY`
Supabase ref: `wcextqwiceknlgcvrnxn` (Hobby/free tier)

## Vision / non-negotiables

- Product is **Ampo**, an EV-charging station finder for Indian cities. Brand stays **Ampo** everywhere.
- Native app id is **`com.ampo.evcharging`**. Favicon/icon is the **Ampo bolt** (turquoise→emerald). Never use Lovable assets or branding.
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
- **R13** AdMob bottom banner uses `@capacitor-community/admob@7.2.0` with Google's public test IDs: App ID in `android/app/src/main/res/values/strings.xml`, banner unit ID in `src/components/AdBanner.tsx` overridable with `VITE_ADMOB_BANNER_AD_ID`. UMP now gates on `consent.canRequestAds`, sets `isTesting: true` for test IDs, and logs load/failure events as `[AmpoAd]`. Native-only; no-op in browser. Browser ads use `src/components/WebAdBanner.tsx` with AdSense; it is a no-op unless both `VITE_ADSENSE_CLIENT_ID` and `VITE_ADSENSE_SLOT_ID` are set in Vercel.
- **R14** List→detail→back lag is fixed with React Query caching (location + station lists + detail + feedback), a compact/proximity-sorted distance API with CDN cache headers, instant cached geolocation, local favourite state, and scroll restoration. See "Performance state (done)" below.
- **R15** Route-level code splitting: `StationDetail` and `TripPlanner` are `React.lazy` chunks. The default list view must stay the small entry chunk; do not statically import detail/trips back into the entry.
- **R16** Daily catalog sync now only uses real sources: BEE API pages, OpenStreetMap Overpass, and Google Places catalog. All hard-coded provider "samples" (Tata/Ather/Jio-bp/PlugShare/ChargeZone/ABB/BrightBlu/Statiq/NITI) were removed from the fetch list because they were fabricated.
- **R17** Detail speed: station cards seed the React Query detail cache on touch/focus and prefetch station + feedback; `mode=id` and feedback GET responses use `Vercel-CDN-Cache-Control`; feedback is one SQL query instead of four; hero photo is 800px eager. Measured warm detail API **0.42 s HIT**, feedback **0.38 s HIT**; clean browser list→card→detail loads in ~0.7 s.
- **R18** Photo matching: rank Google photos by resolution + landscape ratio as a proxy for "looks like a place, not a screenshot"; if a station has no usable photo, borrow from a landmark within **75 m** only (gas station > store > service > restaurant > cafe), never move the station's coordinates, and disclose the source in `place_details.photoSource`. This also applies to the Trip Planner via `mode=bounds` compact `place_details` + shared `StationCard`.
- **R19** Trip Planner: route responses drop unused `steps=true`; station/route proximity uses a spatial grid instead of O(n·m); Trips chunk is warmed on hover/focus with a skeleton fallback, and Leaflet `TripMap` is a separate lazy chunk. Station list has no wrapping Card border on mobile; detail prefetch is wired like the nearby list.
- **R20** `place_details` must be written with `sql.json(details)`, never `JSON.stringify(details)::jsonb` — the latter stored a JSON *string scalar*. Migration `20261120190000_fix_double_encoded_place_details.sql` unwrapped all 5,545 affected rows.
- **R21** Distance shown on cards is progressively upgraded from straight-line to **road distance** via a post-render OSRM table request (`useDrivingDistances`, 80 stations/call, cached 10 min). Directions links now pin `origin=` to the same location. This adds no load-blocking request.
- **R22** Header brand is **Ampo** with "EV station finder" on the same line (no extra subtitle row). Mobile search layout uses a stable two-line status/controls structure so long queries never reflow the filter row. Add new experience regressions to `tests/experience-smoke.mjs` (`npm run test:experience`).
- **R23** Every screen header (list AND station detail, future screens too) MUST use the shared `src/components/BrandTitle.tsx` component for the "Ampo + descriptor" wordmark. Never hand-roll a different title style (the detail page previously used a two-line uppercase `Ampo` + `Station details` stack). `tests/experience-smoke.mjs` asserts font size/weight/family match between list and detail headers — keep this passing for future builds.
- **R44** Header home affordances + status line (user: "Clicking on ampo header or the icon should also behave in the same way. And remove the icon for 'showing results...' text"): added shared `useGoToCurrentLocation()` in `src/hooks/useStationQueries.ts` (fresh GPS → cached fallback → save genuine fix → `setQueryData(['user-location'])` → invalidate active `['stations','nearby']`). Used by `NearbyStations.handleShowNearby`, `EVApp`'s wordmark (`BrandTitle` gained optional `onClick`) and logo `<Link>`, and `StationDetail`'s wordmark. Logo `aria-label="Ampo logo — back to nearby"`; wordmark stays `aria-label="Ampo home"`. Removed the `MapPin` icon from the "Showing results near you" / "Search results for …" status line (the radius selector keeps its own pin). URL dropping `?q=` now also cancels any in-flight search so a late result cannot re-apply the searched area. Smoke regression `checkHeaderHomeAffordances()` added. Verified locally: header wordmark click → distance request at live GPS 17.42,78.42 despite cache 17.4485,78.3908; URL cleared; status line has no SVG.

- **R46 Usage reporting (user asked to chart total site usage/users 2026-11-23)**: Vercel Hobby project exposes no historical usage data — Web Analytics was off, Observability Plus (`vercel metrics vercel.request.count`, function invocations) returns `payment_required`, runtime logs only retain ~26 min, and Supabase has no request/user table. User chose **Enable Vercel Web Analytics**. Added `@vercel/analytics` + `<Analytics />` in `src/App.tsx` (commit `43a115d`, deployed `16ksngusd`, alias `ampo.vercel.app` loads `/_vercel/insights/script.js`). Project already had a `webAnalytics` id; `vercel project web-analytics` confirmed enabled. Working API: `vercel api '/v1/query/web-analytics/visits/aggregate?projectId=prj_Dv37B44pqmZruQkGkMLUJdDpT8XY&since=…&until=…&by=day'` (params are `since`/`until`/`by`, NOT `from`/`to`/`interval`) and `…/visits/count`. `vercel metrics vercel.analytics_pageview.count` also works with `-a unique/visitor_id`. Added `scripts/usage-chart.mjs` (standalone SVG, `--days=`, `--by=hour|day|…`, `--out=`). First chart: 6 pageviews / 1 unique visitor — all from the author's own verification, since tracking started today. Pageviews ≠ API call counts; true request totals still require Observability Plus.

- **R47 Friend comparison — investigated & actioned (user pasted 2026-11-23, asked to investigate gap + tune radius + audit origin)**: a friend compared a Google Maps share link with Ampo near Kokapet:
  - Google centre `17.3978811,78.3221919` (west Kokapet/Gandipet) vs Ampo `17.3904615,78.3396485` (Narsingi/east Kokapet) — ~2.03 km east-southeast offset. Need to determine whether this is the saved/GPS location (expected per R43) or a real origin bug for shared Map links.
  - Google is a ~2–3 km zoom-15 viewport; Ampo uses `radius=10` and returned 80 pins spanning Rajendranagar→Kondapur/Madhapur. The 10 km default may be too broad versus a viewport; radius selector already exists.
  - **Coverage blind spot**: zero Ampo pins west of `78.3309E` in the `17.385–17.410N` band; only pin west of `78.327E` is `17.4326,78.3184` (~3.9 km north). Need a real-source gap check around west Kokapet/Gandipet; do not fabricate rows.
  - Distance is public OSRM demo (`annotations=distance`), no live traffic/ETA. Ranking is straight-line then OSRM proximity only — no prominence/reliability/active-status weighting. Both are known design limits, not regressions.
  - **Measurements**: live API at the Google share point returns 11/33/45/145 pins at r=2/3/5/10 km; at Ampo's GPS point 10/24/59/159. `google_area_cache` already has a `done` refresh at `17.3899827,78.3402505` r=10 (2026-11-22, found 20/new 5) — ~70 m from the friend's Ampo coordinate, i.e. that coordinate is the friend's device GPS, not a share-link origin bug. Search links (`?q=&place=`) already centre on Google's resolved place (R42): `?q=Kokapet` → `17.3967663,78.3347724` vs row centroid `17.4248,78.3551`; station Share copies `/station/{id}`; Directions pins the origin to the displayed distance (existing smoke check). No origin bug found.
  - **Coverage gap is genuine**: in the 17.385–17.410N band only 4 DB rows exist west of 78.34E, min longitude 78.3309171 — unchanged at `limit=500`. Google `searchText` (bias) and `searchNearby` with strict `locationRestriction` (the valid type is `electric_vehicle_charging_station`, NOT `ev_charging_station` — the code comment in `googleAreaBackfill.ts` is wrong) both return zero chargers west of ~78.333E in that band; OSM Overpass (`amenity=charging_station`, 17.37–17.43N / 78.28–78.36E) returns zero. No real source has rows to add — do not fabricate.
  - **Radius tuned**: default 10 km → **5 km** in `NearbyStations` + `EVStationService.getStationsWithDistance`, and added a **3 km** selector option (3/5/10/25/50). Sample of 8 city centres returns 4–184 pins at 3 km and 8–200 at 5 km, so 5 km is the safe default; 3 km gives a Google-viewport-like view. Smoke regressions assert default=5 and the 3 km option. Ranking/OSRM limits left unchanged — no evidence this is a bug.

- **R45 Garbled source-data repair (reported by user 2026-11-23, user chose "Repair rows in DB")**: user searched "Microsoft gate 2 Hyderabad" and saw a mangled Joule row (`8d3c5c37-fe13-4468-b39e-7a7659254fda`, coords 17.421603,78.338903). Root cause is upstream BEE font/ToUnicode mangling, not the UI; standard charset round-trips do not recover it and the per-character substitution differs between source PDFs, so there is no single decoder. Added `scripts/repair-garbled-names.mjs`: dry-run by default, Google Places `searchText` biased to each row's coordinates (max 100 m, rejects other-provider branding), writes a review JSON, then `--report=<dry-run.json>` applies without extra Google calls. Two UPDATEs per row are required because `reset_station_place_enrichment_on_update` clears `google_place_id` when name/address changes. Applied **147** reviewed Google repairs; manually decoded the reported Joule row to "Kakwood Residence Kapil Hyderabad, Survey No.115/1, …" (Google had no Joule match there) => **148 total**, leaving **163 garbled rows** (mostly rural HPCL/IOCL/Tata Power sites Google does not list). Production `mode=id` confirms the reported row is now readable. Remaining rows have no safe canonical source yet — do not invent names for them. User then chose a UI safety net for those rows: `src/lib/provider.ts` now exposes `hasGarbledText()`, `displayStationName()` and `displayStationAddress()` (garbled = C0 controls, Latin Extended U+0100–024F or Greek/Coptic U+0370–03FF; genuine Indic scripts pass through); `EVStationService.mapStation()` applies them so every screen shows e.g. "Joule charging station, Hyderabad" and "Hyderabad, Telangana" instead of mojibake. Regression `checkGarbledNameFallback()` mocks a garbled nearby row and asserts readable card text. Deployed in `16abad0`; production smoke **98/98 PASS**. Also stabilized `tests/experience-smoke.mjs`: wait for the URL to settle after "Show Nearby" (the awaited refetch now precedes URL clearing) and fall back to `page.goto()` if a reload detaches the target. The detail-header check waits for "Station details" text (not just an attached h1, which can still be the list header right after navigation) and accepts `attached` rather than `visible` because a transient Radix overlay can aria-hide the tree. Header deploy `50585ba` is live and the full production smoke passes.

- **R43** "Show Nearby" now always uses the device's **CURRENT** location (user: "still shows Kokapet, it should fetch basis my active current location"). No hardcoded coordinates anywhere in `src/` (grep-verified). R41's frozen `originalLocation` snapshot and `locationRef` were **removed** — they could capture a stale/cached location near the searched area and keep returning it. `handleShowNearby()` is async: cancels in-flight search, then `await LocationService.getCurrentLocation()`; on a denied/failed GPS fix it uses `getCachedLocation()?.location` (last real fix) and never the Delhi display fallback; genuine GPS fixes are persisted via `saveLocation()`. It calls `onLocationUpdate(current)` and invalidates `stationKeys.nearby(current, radius)` with `refetchType:'all'`, then clears the search URL/input. Button shows a spinner (`isLocating`, stable `aria-label="Show Nearby"`). Verified locally: with cache 17.4485/78.3908 and a live GPS fix 17.42/78.42, the nearby `mode=distance` request now uses 17.42,78.42. Regression `checkShowNearbyUsesCurrentLocation()` added to `tests/experience-smoke.mjs`. Note: this adds a GPS call (up to the 8 s `LocationService` timeout) to each Show Nearby click.

- **R42** Search distance origin fix (user: "nalagandla shows Kondapur results as top ones"): the API's rows were correct (all within 8.6 km of the resolved place, nearest 0.5 km) but `runSearch` set the map centre — and therefore every card's distance and sort order — to the **average of all 100 row coordinates**. For Nallagandla that centroid is 17.457,78.346, ~4.3 km east in Kondapur, so far-away Kondapur stations sorted first. The API now emits `X-Ampo-Place-Center: lat,lng` whenever Google resolves a place; `EVStationService.searchStationsByLocation` passes it through its `onResolved(label, center)` callback; `NearbyStations` caches it under `stationKeys.searchCenter(query, placeId)` and uses it as the `onLocationUpdate` centre (row-centroid only as fallback when Google cannot resolve). Caching in React Query (not just a ref) keeps the correct origin on detail→back cache hits. Verified locally (distance origin = place centre, not row centroid) and on production: sharing `?q=Nalagandla...&place=ChIJW7VICNqSyzsR_YH_QKDXHYs` now shows Nallagandla stations at the top (1.3–3.4 km) instead of Kondapur. Regression `checkSearchCentre()` added to `tests/experience-smoke.mjs`; full prod suite 90/90 PASS. Smoke suite can transiently fail the 'Kokapet renders cards' step on a slow prod response — re-run before treating as a real regression.

- **R41** "Show Nearby" race fix: `originalLocation` (the true home) is now captured in the location effect as soon as a real location is available, **not** lazily after an awaited search — a slow/cancelled search or a stale GPS refetch must never make the searched area become the restore target. `runSearch` takes a `searchRun` token; if "Show Nearby" bumps it, the late search result is ignored (no `setSearchResults`/`onLocationUpdate`/toast) and `setIsSearching(false)` runs immediately, so an in-flight search cannot re-apply the searched area after returning home. Verified with a local mocked slow-search debug: both fast and slow/cancelled searches now issue a fresh `mode=distance` request at the saved home coords on "Show Nearby". Fixes production smoke failures "Show Nearby requeries the saved home location" / "shows home-area stations again".

- **R40** Typed-location search now uses an **Uber-style Google Places dropdown**. `NearbyStations` debounces (250 ms) Google Autocomplete results fetched through `/api/stations?mode=suggest&q=…`; the listbox is absolutely positioned under the input (same x/width, 4 px gap) with primary name + secondary address rows, arrow-key/Escape/Enter support, and clicking/Enter immediately searches. The chosen place is stored as `?q=<canonical label>&place=<placeId>` so a shared link reuses the exact place. The server resolves `placeId` via Places details, or (when no suggestion was picked) uses `places:searchText` on the typed query, which also corrects typos; the `X-Ampo-Resolved-Place` response header lets the UI replace a misspelling with Google's canonical name. **R39's DB-coverage geocoder scoring and Nominatim path were removed per user request** — ambiguity is resolved by the user choosing from the dropdown, not by guessing from row counts. Nearby (no query) status now reads **“Showing results near you”** below the input. Google helpers live in `server/lib/googlePlaces.ts` (no new Vercel function). Regressions added to `tests/experience-smoke.mjs`.

- **R39 (superseded by R40)** Bare-locality searches (e.g. `q=nallagandla`) used to return 0 rows because Nominatim's first `limit=1` hit was a same-named village in another state and area-first search trusted it, with no text fallback. A short-lived fix scored up to five Nominatim candidates by DB rows in a 10 km box; the user rejected that guess-based pattern in favour of the explicit place picker, so this code was removed. Keep no locality-specific hard coding.

- **R38** "Show Nearby" after a search restores the user's real location and refreshes that area's list. `NearbyStations.runSearch()` still moves the active centre to the searched area (so result distances are local), but first captures the pre-search location in `originalLocation` ref; `handleShowNearby()` deletes `?q=`, clears the search UI, calls `onLocationUpdate(home)`, and invalidates `stationKeys.nearby(home, radius)`. Regression check added to `tests/experience-smoke.mjs`. Deployed in `45226b2` + `4201acf`.

- **R37** CSR/social-preview fix: `index.html` now ships a crawler-visible static landing shell inside `#root` (React's `createRoot` replaces it on mount) plus a `<noscript>` fallback, so bots that never run JS see real Ampo content instead of an empty div. OG/Twitter tags are complete — canonical `https://ampo.vercel.app/`, `og:url`, `og:site_name`, `og:image`/`twitter:image` → `public/og-image.png?v=1` (a 1200×630 PNG rendered with headless Chrome so its text is exact), `og:image:width/height/alt`, and matching `twitter:title`/`description`. `public/robots.txt` allows the major crawlers. **Vercel preview `noindex` is a platform default, not a config setting:** preview deployments return `X-Robots-Tag: noindex` (verified on a `*.vercel.app` preview URL) while production `ampo.vercel.app` returns no such header. Do not add a blanket `x-robots-tag` header in `vercel.json`, as that would make production noindex too. Re-check both after any header/routing change.

- **R36** Locality search resolves the full multi-keyword query through Nominatim (canonicalising known aliases such as `nalagandla` → `nallagandla`) to an **area on the map**, then lists up to 100 DB stations within **10 km** of that point — the same shape as a current-location search. Literal text matching is only the fallback when geocoding fails; there are no locality-specific hard-coded guards. Before scheduling a Google refresh, `countProviderStations()` checks the area for at least **5** provider-backed rows (`google_place_id` set, or source containing Google/OpenStreetMap/OCPI); the static bulk catalog alone does not count. `NearbyStations` mirrors the submitted query in `?q=` (and removes it on Show Nearby), so a shared URL restores the search on load and back/forward navigation re-runs it without a reload (R35).

- **R35** Demand-driven Google gap fill is **deployed** (commits `417557b` + `175bc20`, migration applied): `api/stations.ts` claims a rounded 0.05° cell (`server/lib/googleAreaBackfill.ts`, mirrored in `src/lib/googleArea.ts`) on `mode=distance` or `mode=search`, emits `X-Ampo-Google-Refresh`, and runs one `searchText` job (`textQuery='EV charging station'` + `locationBias`) via `waitUntil()` from `@vercel/functions` (Hobby Fluid now allows 300 s); `searchNearby` with `includedTypes:['ev_charging_station']` is rejected by Google as an unsupported type. Migration `20261122120000_add_google_area_refresh_cache.sql` adds `google_area_cache` (7-day TTL, failed-cell retry after 5 min, stale-pending reclaim after 10 min) and `google_area_refresh_log`; every refresh writes a log row and console line `[AmpoGoogleRefresh]`. The job enriches an existing row within ~150 m (by `google_place_id` + proximity) instead of duplicating BEE rows, and inserts genuinely new places with `source_name='Google Places API (New)'`. `src/components/GoogleRefreshNotice.tsx` polls `mode=refresh-status` and toasts/invalidates station queries when the DB actually changes; `nallagandla` ↔ `nalagandla` search aliases were added. A `Restricted access` tag comes from explicit OSM `access` values or strong residential keywords (`residency`, `RWA`, `apartment`, `basement` + society/tower context); `ownership='private'` alone is never used. Compact distance/bounds API now returns `access` and `source_name`. Google Places terms only expressly allow caching place IDs indefinitely and coordinates for 30 days, so treat this as a "looked here recently" marker, not permanent Google content; never add `places.reviews`.

- **R34** A **local-only fourth tab, Hotels (badged NEW)**, is being prototyped for lodging with EV charging. It is gated by `VITE_ENABLE_HOTELS_TAB=true` in gitignored `.env.local`; production env must **not** set it, so `ampo.vercel.app` keeps the original three tabs. `src/components/HotelsTab.tsx` reads `src/data/hotels.generated.json` directly (no API/DB change), with optional network-generated affiliate URLs from gitignored-style `src/data/affiliateLinks.json` (hotel id → full tracking URL) plus an affiliate disclosure shown only when at least one link is configured. `scripts/scrape-hotels.mjs` uses Playwright/real Chrome for four parallel per-site adapters (MakeMyTrip, Booking.com, Airbnb, Tripadvisor) with a per-site 30 s throttle (`HOTEL_THROTTLE_MS`/`HOTEL_PER_SITE` overrides); it captures each listing's own primary image from JSON-LD `image`/`og:image`/largest visible `<img>` first and only falls back to Google Maps (`--photos`), storing `photoCredit` ("<Source> listing" vs "Google Maps") and a clickable `photoSourceUrl`. `--headed` opens visible Chrome and pauses up to `HOTEL_HUMAN_WAIT_MS` (default 60 s) so a human can solve bot challenges before the script continues page by page. All four sites still block automated fetches headlessly (bot challenges/403/JS shells), so the seed is the real data source for now; scraper reports blocked attempts honestly. Affiliate routes: TripAdvisor CJ pays ≥50% of its hotel referral fee on qualified **click-outs** with a 14-day window (best fit for research traffic); MakeMyTrip via Indian networks (EarnKaro/Cuelinks/INRDeals) pays ~₹135–180 per eligible domestic hotel booking, web-only on some networks; Booking.com is now CJ/Awin-only and pays from ~4% of its commission on **completed stays**; Airbnb is application-only via Impact (Creators/Demand Program), no open self-serve rate. Never hand-append partner IDs — use network-generated deep links and disclose affiliate relationships. **Do not push this work to `main` or run `vercel --prod --yes` until the user explicitly approves** — the user wants the result in the local build first. Vercel Hobby also cannot schedule sub-daily jobs, so the 30 s cadence is local-only by design.
- **R33** Google Maps reviews are fetched **on demand** via public cached endpoint `GET /api/station-reviews?stationId=<uuid>` (`api/station-reviews.ts`), which looks up the station, calls `fetchGoogleReviews()` in `server/lib/place-enrichment.ts`, and returns `{ reviews, googleMapsUri, rating, userRatingCount, source: 'Google Maps' }` with 24h CDN cache + in-instance dedupe. If the station has no `google_place_id`, a basics-only text search finds one (1 km guard). **Never add `places.reviews` to the nightly enrichment FIELD_MASK** — that runs for tens of thousands of rows and `reviews` is a premium Places SKU. The detail page loads them in an effect with a loading state; the UI block has `aria-label="Google Maps reviews"`, shows author avatar/name/stars/relative date/note plus a direct "Read on Google Maps" link for Google attribution, and degrades to "No Google reviews found for this place." Never imply these are Ampo community reports.
- **R32** `SiteFooter` has two actions in one wrapped row: the in-app **"Help us Improve!"** dialog and an external **"Star on GitHub"** link to `https://github.com/sumitc/road-to-charge` (`target="_blank" rel="noopener noreferrer"`). Keep the footer login-free; the GitHub link is for supporting the repo, not for authentication.
- **R31** The detail review area is explicitly labelled **"Reviews & community updates"** with `aria-label="Reviews"` on the `id="reviews"` card. The count is singular/plural ("1 review" vs "N reviews"). Counts are followed by a separate **"Recent reviews"** block: each of the up to 5 reports is its own bordered row with a colored kind badge, relative date, "Your report"/"Community" badge, and the note on its own line (or "No written details were added with this report." if the user left the note blank). Empty state: "No reviews yet…". The old vague "Visit & community updates" heading buried reports under status text; regressions now assert the review card contains review details.
- **R30** The **Ampo** wordmark in `BrandTitle` is a real home link (`<Link to="/" aria-label="Ampo home">`) on every screen, including station detail. Keep it inside the shared `header h1` so the existing font-size/weight/family parity check still passes; do not add a separate header button. `tests/experience-smoke.mjs` clicks the wordmark from detail and asserts `window.location.pathname === '/'`.
- **R29** Full rebrand **Ruvo → Ampo** (user request, Nov 21 2026): visible UI (`BrandTitle`, footer, emails, error toasts), page title/meta/OG tags, PWA manifest, Capacitor app name/id, Android `applicationId`/namespace/Java package/`strings.xml`, localStorage keys (`ampo_last_location`, `ampo-list-scroll`), CSS var (`--ampo-banner-height`), ad log prefix (`[AmpoAd]`), public asset filenames (`ampo-icon-*`, `ampo-favicon-*`), docs, and this skill (renamed `ampo-product-brain`). The bolt artwork is unchanged — only filenames/brand text changed. The native wrapper and all default URLs now point to `https://ampo.vercel.app`; the Vercel project/repo keep their legacy `road-to-charge-v2` names. This is a new Android app identity: existing `com.ruvo.evcharging` installs will not receive updates. If `RESEND_FROM` is set in Vercel, flip its display name from Ruvo to Ampo too.
- **R28** List/detail feedback polish: `providerLabel()` hides the literal provider "Google Places" on the 31 catalog gap-fill rows (the site/brand is already in the station name; `source_name` stays in the DB for provenance). `LiveStatus` shows **"Live"** with a radiating green ping dot for `operational` instead of a plain "Available" label, in both list and detail. The card's secondary action is now **"Review"** and deep-links to `/station/:id#reviews`; `StationDetail` marks the community card `id="reviews"` and retries scrolling until it exists (detail may still be loading when the hash lands). After a station-feedback submit, the 60 s CDN-cached GET is bypassed once via `EVStationService.getFeedback(id, true)` (`&_=Date.now()` + `cache: 'no-store'`), React Query data is updated, the page anchors back to `#reviews`, and the newest matching report is tagged **"Your report"** while older rows say "Community". Regressions cover provider text, radiating dots, Review deep-link, submit anchor, and source tagging in `tests/experience-smoke.mjs`.
- **R27** Feedback is **login-free**: `SiteFooter` renders an in-app dialog (button labelled "Help us Improve!", deliberately not "Feedback" to avoid colliding with the detail page's station-feedback FAB) that POSTs to `/api/app-feedback` → Resend email to `REVIEW_EMAIL`/`develop.sumit@gmail.com` with `reply_to` set. No auth, no GitHub issue (GitHub needs login); honeypot `website` field + 3–4000 char validation. Footer is rendered on list, detail, **and inside both popups** (add-station sheet, station-feedback sheet). Overlay checks in `tests/experience-smoke.mjs` run on a fresh page because opening the footer dialog scrolls the long list and Radix temporarily sets `aria-hidden` on the app root — mixing them into layout checks corrupts measurements.
- **R26** Detail header shares the list header's exact gradient theme (`bg-gradient-hero text-primary-foreground shadow-electric`, same padding/safe-area) — ghost icon buttons must use `text-primary-foreground` so they stay visible. The "Reviews & community updates" heading stacks title then subtitle on mobile (`flex-col sm:flex-row`). Shared `SiteFooter` shows "© 2026 Fibuladreams Pvt Ltd. All rights reserved." plus the "Help us Improve!" feedback control; it is rendered on list, detail, and both popups. Regressions cover header theme parity, stacked heading, and footer.
- **R25** The nearby list is sorted by whatever distance is **displayed**: straight-line first, then re-sorted by OSRM road distance once `useDrivingDistances` succeeds (otherwise a 2.1 km card appears above a 1.9 km card). `useDrivingDistances` keys its cache on a sorted ID list (order-insensitive) and is called with the unfiltered nearby list, so re-sorting or toggling connectors never triggers a second routing call. `tests/experience-smoke.mjs` asserts displayed distances are non-decreasing. Trip Planner keeps route-proximity ordering (different concept) but still shows road distances.
- **R24** `LocationService.getCurrentLocation()` returns `ResolvedLocation { location, isFallback }`. The Delhi fallback (28.6139, 77.2090) is display-only for a first-time visitor: it is **never** written to `localStorage` and **never** replaces a real cached fix when GPS is denied/timed out. `EVApp.handleLocationUpdate` only sets the in-memory `user-location` query cache (searching another city must not overwrite the saved home location). Root cause fixed: a stale cached location triggered a background GPS refetch; on failure the fallback was saved as `ampo_last_location`, so the list permanently switched to Delhi and refetched for it on every load. Regression checks live in `tests/experience-smoke.mjs`.
- Full photo backfill completed: **1,157 of 1,797** already-enriched no-photo rows repaired (0 failures); DB is 29,215 rows / 4,905 with photos / 1,197 landmark-sourced / 5,545 enriched.

## Architecture map

Frontend (Vite + React 18 + TypeScript + Tailwind + shadcn/ui, **not Next.js**):
- `src/App.tsx` — QueryClientProvider, TooltipProvider, toasts, BrowserRouter, routes `/`, `/station/:id`, `*`; renders `<AdBanner />` and `<WebAdBanner />` globally.
- `src/pages/Index.tsx` — renders `EVApp`; now also handles scroll restoration for list→detail→back.
- `src/components/BrandTitle.tsx` — shared one-line "Ampo + descriptor" header wordmark used by list and detail screens; **Ampo** is a home link to `/` (see R30).
- `src/components/SiteFooter.tsx` — shared copyright + login-free "Help us Improve!" feedback dialog on list, detail, and both popups (see R27). `api/app-feedback.ts` emails submissions via Resend.
- `api/` now has 10 functions (Hobby limit 12): `stations`, `place-photo`, `station-feedback`, `submissions`, `submission-decision`, `review-submission`, `sync-ev-stations`, `sync-trigger`, `enrich-place-photos`, `app-feedback`.
- `src/components/EVApp.tsx` — header, tabs (Stations / Trips / Saved, plus gated local-only Hotels), location, sync button, `ContributionButton`; warms the Trips chunk on hover/focus and shows a skeleton fallback.
- `src/components/HotelsTab.tsx` — local-only Hotels list with search, NEW badges, charging details, source links and photo attribution; reads the generated JSON fixture (see R34).
- `scripts/scrape-hotels.mjs` / `src/data/hotels.seed.json` / `src/data/hotels.generated.json` — local-only Playwright travel-site scout harness and fixtures; supports `--headed` + primary-image capture; no serverless functions or DB schema involved (see R34).
- `src/data/affiliateLinks.json` — local map of hotel id → network-generated affiliate URL; UI swaps "View listing" for "Book on <source>" and shows a disclosure when populated (see R34).
- `src/components/NearbyStations.tsx` — search card, radius select, `ConnectorFilter`, loading/empty states, station list. Uses `useNearbyStations`/`useStationSearch`.
- `src/components/StationCard.tsx` — photo-first row, Maps/app/Directions/**Review** (deep-links to `#reviews`)/Favourite actions; shows a "Nearby <kind> · <distance>" badge for borrowed photos, `LiveStatus` (R28) and a `Restricted access` pill (R35).
- `src/components/TripPlanner.tsx` — route form + compact mobile result list; `usePrefetchStation()` warms detail cards. `src/components/TripMap.tsx` is lazy-loaded only after a route exists.
- `src/lib/placePhotos.ts` — `placePhotoUrl()` plus `photoSourceLabel()` disclosure helper.
- `src/lib/provider.ts` — `providerLabel()` hides "Google Places" as a displayed provider (R28); `accessTag()` returns `Restricted access` from explicit access values or residential keywords (R35).
- `src/components/LiveStatus.tsx` — "Live"/"Maintenance"/"Offline" pill with a radiating green dot for `operational` (see R28).
- `src/pages/StationDetail.tsx` — gallery, details, Maps/app links, `id="reviews"` community card, feedback sheet + FAB. Uses `useStationDetail`/`useStationFeedback`.
- `src/components/ContributionButton.tsx` — community submission sheet (camera/gallery, OCR, verification, review email).
- `src/components/AdBanner.tsx` — native AdMob banner, sets `--ampo-banner-height` CSS var so FABs/list bottom stay clear.
- `src/components/WebAdBanner.tsx` — browser-only AdSense banner; no-op without both Vite AdSense env vars.
- `src/hooks/useStationQueries.ts` — React Query keys and hooks for location, nearby, search, detail, feedback, plus `usePrefetchStation()` used by station cards.
- `src/services/` — `evStationService.ts` (API mapping + Google refresh header/status), `locationService.ts` (cached geolocation + `ResolvedLocation` fallback contract, see R24), `favouritesService.ts`, `appIconService.ts`, `chargingStationsSync.ts`.
- `src/components/GoogleRefreshNotice.tsx` — listens for the `ampo-google-refresh` event, polls `mode=refresh-status`, toasts and invalidates station queries when a query-triggered DB refresh completes (R35).
- `src/lib/` — `connectorLabels.ts`, `appLinks.ts` (`directionsUrl` pins origin), `placePhotos.ts`, `provider.ts`, `googleArea.ts` (cell key shared with the backfill), `utils.ts`.
- `src/hooks/useDrivingDistances.ts` — non-blocking OSRM road-distance table cache.
- `tests/experience-smoke.mjs` — Playwright regression checks for search layout, FAB visibility, refresh stability, branding, and distance semantics.

Serverless API (`api/`, Vercel Node functions, direct Postgres):
- `api/stations.ts` — `mode=all|distance|bounds|search|filters|stats|id|refresh-status`. Distance mode is the list hot path; search/distance can claim a Google backfill cell and return `X-Ampo-Google-Refresh` (R35). Compact distance/bounds rows include `access` and `source_name`.
- `api/place-photo.ts` — Google Places photo proxy with CDN cache headers.
- `api/station-feedback.ts` — GET/POST community feedback.
- `api/enrich-place-photos.ts` — secret-protected batch enrichment (`Authorization: Bearer $SYNC_SECRET`).
- `api/sync-ev-stations.ts` — secret-protected catalog sync.
- `api/review-submission.ts` and related review endpoints — signed approve/reject, Blob cleanup.
- `server/lib/place-enrichment.ts` — query builder, provider aliases, matcher, batch runner.
- `server/lib/googleAreaBackfill.ts` — cell claim (7-day TTL), `waitUntil` background job, proximity dedupe/enrich, cache status and durable refresh log (R35).
- `scripts/import-full-bee-snapshot.mjs` — one-off full BEE JSON import + fake-row cleanup.
- `scripts/enrich-google-catalog.mjs` — targeted photo enrichment for Google Places gap-fill rows only (avoids spending credits on all 29k rows at once).
- `scripts/repair-place-photos.mjs` — re-run full matching for already-enriched rows with no/poor photos (Hyderabad fast-track; `--all`, `--google-only`, `--include-unscored`).
- `scripts/backfill-landmark-photos.mjs` — cheapest backfill: one Nearby Search per already-enriched no-photo row; keeps `google_place_id` intact via `db.updatePhotos()`.
- `supabase/migrations/20261120190000_fix_double_encoded_place_details.sql` — unwraps jsonb string scalars.

Data / infra:
- `supabase/migrations/20261120010000_add_station_place_photos_and_feedback.sql` — photo columns, `station_feedback`, reset trigger.
- `vercel.json` — two crons: `0 3 * * *` full sync (`?mode=full&maxPagesPerState=2`), `0 4 * * *` enrichment (`?limit=100`); SPA rewrite for `/station/:id`.
- `capacitor.config.ts` — app id/name, `webDir: dist`, remote server URL, splash config.
- `android/` — checked-in Capacitor Android project with Ampo icons/splash, permissions, AdMob metadata.
- `public/ampo-icon-1024.png` — master for browser/PWA/native icons.
- Gitignored local artifacts: `.env.vercel`, `.sync-secret.tmp`, `*.apk`, `android/local.properties`, generated web assets.

Environment (names only, never values): `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SYNC_SECRET`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM` (optional; default `Ampo <onboarding@resend.dev>` works), `BLOB_READ_WRITE_TOKEN`, `REVIEW_SECRET`, `VITE_ADMOB_BANNER_AD_ID` (optional), `VITE_ADSENSE_CLIENT_ID` + `VITE_ADSENSE_SLOT_ID` (optional, both required for web ads). Preview env is not fully configured; test against production or local.

## UX flows to preserve

1. **Find stations:** location cached → nearby query by rounded lat/lng + radius → photo-first cards. Connector filter is speed-first multi-select beside radius on mobile. Search accepts area/city text; results set the map center via `onLocationUpdate`.
2. **Detail:** tap card → `/station/:id` → cached detail query + feedback query → gallery/details/links; the **Review** button on a card opens `/station/:id#reviews` directly on the community section. Back button or browser back returns to `/` with cached list and restored scroll.
3. **Community report:** floating **+** → sheet → photo + OCR + Google/OSM verification → Resend review email to `develop.sumit@gmail.com` with signed links → approve/reject → Blob photo cleanup on reject/review completion.
4. **Feedback:** floating Feedback FAB on detail → working / not working / wrong location / other + note → `station_feedback` → cache-busted refetch → anchor back to `#reviews`, where the new report is tagged "Your report" (older ones "Community").
5. **Trip planner:** start/destination (+ waypoints) → Nominatim geocode → OSRM route → compact `mode=bounds` stations → 5 km corridor via spatial grid → connector-filtered list + lazy map. Cards use the same photo/source logic as nearby results.
6. **Mobile APK:** Android WebView loads the live Vercel app; AdMob banner is native at bottom; CSS var reserves height; FABs sit above it.

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
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json
npm run build
npm run test:experience   # mobile layout/FAB/refresh/distance regressions
# Local-only Hotels preview (R34 — do not deploy this work yet):
HOTEL_THROTTLE_MS=1000 HOTEL_PER_SITE=1 node scripts/scrape-hotels.mjs --photos
# Headed mode: solve captcha in the Chrome window, then it continues slowly.
HOTEL_PER_SITE=5 node scripts/scrape-hotels.mjs --headed --photos
npm run preview -- --host 127.0.0.1 --port 4173
BASE_URL=http://127.0.0.1:4173 npm run test:experience  # station smoke needs local API env; expected to fail without it
# git add -A && git commit -m "..." && git push origin main   # BLOCKED for Hotels work
# vercel --prod --yes                                        # BLOCKED for Hotels work
# Patterns split here so the scan does not match its own documentation.
SECRET_RE=$(printf 'AI%s|re_%s' 'za' 'YFQa')
git grep -nE "$SECRET_RE" -- . ':!package-lock.json'   # must be clean
```

Manual enrichment batch:
```bash
curl -X GET 'https://ampo.vercel.app/api/enrich-place-photos?limit=200' \
  -H "Authorization: Bearer $(cat .sync-secret.tmp | tr -d '\n')"
```

Full catalog import / targeted gap-fill:
```bash
curl -sSL 'https://raw.githubusercontent.com/shrinivas-sn/ev-charging-stations-api/main/backend/data/stations.json' \
  -o /tmp/ampo-bee-stations.json
node --experimental-strip-types scripts/import-full-bee-snapshot.mjs /tmp/ampo-bee-stations.json
# After a sync adds Google Places catalog rows:
node --experimental-strip-types scripts/enrich-google-catalog.mjs
curl -sS 'https://ampo.vercel.app/api/stations?mode=search&q=Kokapet' | head -c 500
```

Demand-driven Google refresh (R35 — after migration is applied and code deployed):
```bash
curl -sS -D - 'https://ampo.vercel.app/api/stations?mode=search&q=Nallagandla' -o /dev/null | grep -i x-ampo-google-refresh
curl -sS 'https://ampo.vercel.app/api/stations?mode=refresh-status&cell=336,1563'
# Durable update history:
node --input-type=module <<'NODE'
import fs from 'node:fs'; import postgres from 'postgres';
const env=Object.fromEntries(fs.readFileSync('.env.vercel','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sql=postgres(env.POSTGRES_URL_NON_POOLING,{ssl:'require',max:1,prepare:false});
console.log(await sql`SELECT cell, status, found_count, new_count, message, created_at FROM public.google_area_refresh_log ORDER BY created_at DESC LIMIT 10`);
await sql.end();
NODE
```

Photo repair / backfill:
```bash
node --experimental-strip-types scripts/repair-place-photos.mjs --limit=200
node --experimental-strip-types scripts/backfill-landmark-photos.mjs --limit=2000
# Check disclosure + coverage:
node --input-type=module <<'NODE'
import fs from 'node:fs'; import postgres from 'postgres';
const env=Object.fromEntries(fs.readFileSync('.env.vercel','utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sql=postgres(env.POSTGRES_URL_NON_POOLING,{ssl:'require',max:1,prepare:false});
console.log(await sql`SELECT count(*)::int total, count(*) FILTER (WHERE coalesce(cardinality(photo_references),0)>0)::int with_photos, count(*) FILTER (WHERE place_details ? 'photoSource')::int landmark FROM public.ev_charging_stations`);
await sql.end();
NODE
```

List API smoke test (replace coords):
```bash
curl --http1.1 -sS 'https://ampo.vercel.app/api/stations?mode=distance&lat=17.48&lng=78.40&radius=10'
# Expect ~30 KB / 36 rows near Hitech City, X-Vercel-Cache: HIT on the 2nd call.
curl --http1.1 -sS -o /dev/null -D - -w '%{time_total}\n' \
  'https://ampo.vercel.app/api/stations?mode=distance&lat=17.48&lng=78.40&radius=10'
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
- A poisoned `ampo_last_location` from before R24 self-heals on the next successful GPS fix (the stale timestamp keeps triggering a background refetch, and real fixes now overwrite storage). Do not "fix" this by hard-coding a clear of Delhi coordinates — a user may genuinely live in Delhi.
- Google Places does not label photo *content*. "Not a screenshot/video" is approximated by resolution + landscape aspect ratio ranking; never claim images were visually verified. Landmark photos are only borrowed within 75 m and are always disclosed in the UI.
- `/api/station-feedback` GET is sequential to avoid deadlocks; POST uses the uuid FK.
- Entry bundle is ~418 KB (133 KB gzip) after code splitting; detail/trips are separate lazy chunks. Still above Vite's 500 kB-style warning threshold historically, but no longer a single monolith.
- iOS native project is not checked in; only Android is supported right now.
- AdMob IDs are public test IDs. Production needs both the native `strings.xml` App ID and Vercel `VITE_ADMOB_BANNER_AD_ID`, then a web redeploy + APK rebuild. Web-only changes do **not** need an APK rebuild because the APK loads the live Vercel URL.
- PlugShare does not offer a personal/non-commercial API license; never scrape or present its data as a direct source. Its apparent extra Kokapet coverage is now approximated by Google Places catalog rows.
- Full BEE snapshot is 29,184 rows / ~21 MB from `https://raw.githubusercontent.com/shrinivas-sn/ev-charging-stations-api/main/backend/data/stations.json`. Do not enrich all 29k rows with Google Places at once (cost); enrich targeted localities with `scripts/enrich-google-catalog.mjs`. After the approved backfill: **4,905 / 29,215 rows have photos**, 1,197 use disclosed nearby-landmark photos. Only 5,545 rows have ever been enriched; ~24k BEE rows remain un-enriched by design.
- Google `places:searchNearby` rejects `rankBy` and the `ev_charging_station` included type; use `gas_station`/`convenience_store`/`car_repair`/`restaurant`/`cafe` and sort client-side. `postgres.js` exposes `sql.json()`, not `sql.jsonb()`.
- Secrets: Google key was pasted in chat historically but never committed. Restrict/rotate when convenient. Keep `git grep` clean.
- The legacy `road-to-charge-v2.vercel.app` alias still redirects anonymous visitors to `vercel.com/sso-api` (Vercel team SSO setting), but `https://ampo.vercel.app` points at the same production deployment and is publicly reachable. Use `ampo.vercel.app` as the canonical URL for browser checks (`BASE_URL=https://ampo.vercel.app npm run test:experience`) and for the native wrapper. The Vercel project itself remains `road-to-charge-v2`.

## Working rules

- Prefer targeted edits that preserve existing naming/style. Keep the mobile header compact.
- Never remove the speed-first connector filter or re-add a redundant Refresh button.
- After any change: typecheck, build, commit/push, deploy, secret scan, then **update this skill** (decisions, architecture, active work, verification results).
- When the user reports a UX problem, measure first (API timing/payload, refetch count, geolocation latency) before changing code.
