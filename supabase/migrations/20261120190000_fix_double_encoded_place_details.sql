-- `createEnrichmentDb().update` previously bound JSON.stringify(details) as a
-- text parameter and cast it to jsonb, which stored a JSON *string scalar*
-- instead of an object. Unwrap every affected row so jsonb operators work.
UPDATE public.ev_charging_stations
SET place_details = (place_details #>> '{}')::jsonb
WHERE place_details IS NOT NULL
  AND jsonb_typeof(place_details) = 'string';
