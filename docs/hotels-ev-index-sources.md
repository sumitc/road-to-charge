# Hotels EV index — local source note

**Source/provenance note, updated 2026-11-25.** The published hotel index is used by Ampo's Hotels tab; this document records how the target list, chargers and on-site evidence were assembled. The Hotels tab is on by default (`VITE_ENABLE_HOTELS_TAB !== 'false'`); setting the flag to `false` hides it.

**Current snapshot:** 32 areas, 370 hotels; 365 rows are `Charger nearby` and 5 have an exact, property-specific official-page on-site source. 193 of the nearby rows have a charger within 250 m, but proximity alone never upgrades them to `EV on site`. Open Charge Map enrichment is optional and was skipped locally because no `OPEN_CHARGE_MAP_API_KEY` is configured; the script supports it without adding a runtime function.

## What these targets are

The candidate list is a coverage shortlist of **32 areas** across popular tourist states and city clusters, not a ranking and not a claim about visitor numbers. Each area has a dedicated destination page on **Incredible India**, the Government of India Ministry of Tourism portal; all URLs below were checked as HTTP 200 on 2026-11-24. That is the demand signal used for curation. Google Places is then used only at build time to resolve the area and collect real lodging and real EV charging places.

The machine-readable list lives in `scripts/hotels-ev-targets.json`. `interestTags` are editorial labels for search (heritage, beach, hill station, pilgrimage, etc.), not counts or ratings.

An earlier local-only seed (`src/data/hotels.seed.json`, kept out of the repo) was also reviewed. It contains attributable MakeMyTrip/Booking.com observations such as Radisson Blu Bengaluru Outer Ring Road, Sofitel Mumbai BKC and The Leela Palace Bengaluru, but because the requested EV signal labels tie on-site claims to Google Place text, those booking-site rows are **not** silently relabelled as Google on-site evidence in the new index.

## Targets and demand URLs

| # | Area | State | Incredible India destination page |
|---:|---|---|---|
| 1 | Delhi | Delhi | https://www.incredibleindia.gov.in/en/delhi |
| 2 | Agra | Uttar Pradesh | https://www.incredibleindia.gov.in/en/uttar-pradesh/agra |
| 3 | Jaipur | Rajasthan | https://www.incredibleindia.gov.in/en/rajasthan/jaipur |
| 4 | Jodhpur | Rajasthan | https://www.incredibleindia.gov.in/en/rajasthan/jodhpur |
| 5 | Udaipur | Rajasthan | https://www.incredibleindia.gov.in/en/rajasthan/udaipur |
| 6 | Jaisalmer | Rajasthan | https://www.incredibleindia.gov.in/en/rajasthan/jaisalmer |
| 7 | Mumbai | Maharashtra | https://www.incredibleindia.gov.in/en/maharashtra/mumbai |
| 8 | Goa (Panaji) | Goa | https://www.incredibleindia.gov.in/en/goa |
| 9 | Pune | Maharashtra | https://www.incredibleindia.gov.in/en/maharashtra/pune |
| 10 | Bengaluru | Karnataka | https://www.incredibleindia.gov.in/en/karnataka/bengaluru |
| 11 | Mysuru | Karnataka | https://www.incredibleindia.gov.in/en/karnataka/mysuru |
| 12 | Hyderabad | Telangana | https://www.incredibleindia.gov.in/en/telangana/hyderabad |
| 13 | Chennai | Tamil Nadu | https://www.incredibleindia.gov.in/en/tamil-nadu/chennai |
| 14 | Madurai | Tamil Nadu | https://www.incredibleindia.gov.in/en/tamil-nadu/madurai |
| 15 | Coimbatore | Tamil Nadu | https://www.incredibleindia.gov.in/en/tamil-nadu/coimbatore |
| 16 | Ooty | Tamil Nadu | https://www.incredibleindia.gov.in/en/tamil-nadu/ooty |
| 17 | Kochi | Kerala | https://www.incredibleindia.gov.in/en/kerala/kochi |
| 18 | Munnar | Kerala | https://www.incredibleindia.gov.in/en/kerala/munnar |
| 19 | Thiruvananthapuram | Kerala | https://www.incredibleindia.gov.in/en/kerala/thiruvananthapuram |
| 20 | Shimla | Himachal Pradesh | https://www.incredibleindia.gov.in/en/himachal-pradesh/shimla |
| 21 | Manali | Himachal Pradesh | https://www.incredibleindia.gov.in/en/himachal-pradesh/manali |
| 22 | Dharamshala | Himachal Pradesh | https://www.incredibleindia.gov.in/en/himachal-pradesh/dharamshala |
| 23 | Rishikesh | Uttarakhand | https://www.incredibleindia.gov.in/en/uttarakhand/rishikesh |
| 24 | Haridwar | Uttarakhand | https://www.incredibleindia.gov.in/en/uttarakhand/haridwar |
| 25 | Varanasi | Uttar Pradesh | https://www.incredibleindia.gov.in/en/uttar-pradesh/varanasi |
| 26 | Lucknow | Uttar Pradesh | https://www.incredibleindia.gov.in/en/uttar-pradesh/lucknow |
| 27 | Ahmedabad | Gujarat | https://www.incredibleindia.gov.in/en/gujarat/ahmedabad |
| 28 | Amritsar | Punjab | https://www.incredibleindia.gov.in/en/punjab/amritsar |
| 29 | Darjeeling | West Bengal | https://www.incredibleindia.gov.in/en/west-bengal/darjeeling |
| 30 | Gangtok | Sikkim | https://www.incredibleindia.gov.in/en/sikkim/gangtok |
| 31 | Puri | Odisha | https://www.incredibleindia.gov.in/en/odisha/puri |
| 32 | Visakhapatnam | Andhra Pradesh | https://www.incredibleindia.gov.in/en/andhra-pradesh/visakhapatnam |

## Build-time data collection

`scripts/build-hotels-ev-index.mjs` uses the existing server-side `GOOGLE_MAPS_API_KEY` from local env files (never browser code) and the existing `server/lib/googlePlaces.ts` helper for area resolution. It calls Google Places (New) `places:searchText` for lodging (up to 12 per curated area) and `places:searchNearby` with `includedTypes: ['electric_vehicle_charging_station']` within a 1–3 km radius (default 2.5 km) of each candidate hotel. Results are cached in the OS temp directory for 30 days, keyed by request, and throttled sequentially.

`scripts/hotels-official-evidence.json` holds exact, property-specific quotes manually checked against official hotel/brand pages. A row is matched only by exact Google Place ID or canonical property name; generic word matches such as "hotel" are never accepted. The five current rows are Taj Malabar Cochin, Jaipur Marriott, ITC Windsor, ITC Gardenia and Radisson Blu Plaza Delhi Airport. Each stores the source label, URL, quote, verification method and date.

An on-site claim is recorded **only** from that official-property evidence or from Google's own place name/editorial summary (`on_site_google_place`); it must include a source URL and quote. A charger within any radius — including 250 m — is recorded as `ev_charger_nearby` and never upgraded by distance. Both signals together become `both`. No `places.reviews` field is requested or stored. Provider/network names are inferred from real charger place names; unknown networks stay "Unlisted network" rather than being guessed.

Google Places terms are treated as point-in-time data: the index stores place IDs, source URLs, coordinates and a retrieval timestamp; it is not a permanent copy of Google content. Photos are stored as Google photo resource references plus a Google Maps source URL; optional local thumbnails are only written with `--photos`.

## Connector filter data

`scripts/enrich-hotel-connectors.mjs` adds real connector types to the generated hotel index by reading `evChargeOptions.connectorAggregation` from Google Places (New) for each unique nearby charger place ID. It maps CCS Combo 1/2, CHAdeMO and Type 2 to the same filter values used on the station search page; Google types such as `OTHER`, wall outlets and GB/T are left unmapped rather than guessed. Results are cached for 30 days in the OS temp dir. Re-run the enrichment after any fresh `build-hotels-ev-index.mjs` pass.

**All-source nearby enrichment:** `scripts/enrich-hotels-all-sources.mjs` adds nearby chargers already trusted by Ampo — the live station DB (BEE / Google Places catalog / community submissions), OpenStreetMap Overpass (`amenity=charging_station`) and, when `OPEN_CHARGE_MAP_API_KEY` is set, Open Charge Map — to each hotel's `ev.nearbyChargerSources`. It also unions canonical connector values from those sources. These rows only describe nearby public chargers; they never create or upgrade an on-site claim. The current local snapshot has 639 Google, 5,728 DB and 76 OSM nearby-source matches; OCM was skipped because no key is configured. OSM uses the public `overpass.osm.ch` endpoint with a fallback and is cached for seven days to respect public-instance limits.

## Runtime search, distance origin and contributions

Autocomplete uses the same server-side Google helper as station search. It now sends `includedRegionCodes: ['IN']`, `regionCode: 'IN'` and an India rectangle bias, so "Goa" resolves to Goa, India rather than a US place when the user is abroad. A picked place whose ID matches a curated area/hotel uses that index coordinate. Any other Google pick is resolved once through the existing `/api/stations?mode=resolve` endpoint (Place Details behind the server key) and becomes the distance origin; the UI names that origin in the result count. No row is ever treated as on-site because of proximity.

The card-level "10 chargers within 2.5 km" line was removed because it described a fixed build-time Google radius, not a property claim. Hotel detail pages now show the count with that explanation, a de-duplicated list of real nearby charger rows (Google, OSM, DB, optional OCM), each row's source link, and the existing **+ Add a charging station** submission flow prefilled with the hotel coordinates. Submissions go through the existing review/verification path; they do not publish automatically or change an on-site badge.

No PlugShare data, Tripadvisor ratings/reviews/prices, invented URLs, fabricated rows, new Vercel functions, or DB/nightly enrichment changes are involved. `npm run test:hotel-evidence` checks that proximity-only rows have no evidence text and that every on-site row has a source URL, quote and accepted verification method.
