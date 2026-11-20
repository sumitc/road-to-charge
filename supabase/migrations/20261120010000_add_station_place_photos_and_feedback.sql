-- Google Places enrichment and community feedback for charging stations.
ALTER TABLE public.ev_charging_stations
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS photo_references text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS place_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS photo_enriched_at timestamptz;

CREATE INDEX IF NOT EXISTS ev_charging_stations_photo_enriched_at_idx
  ON public.ev_charging_stations (photo_enriched_at);

CREATE TABLE IF NOT EXISTS public.station_feedback (
  id text PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES public.ev_charging_stations (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('working', 'not_working', 'wrong_location', 'other')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS station_feedback_station_id_created_at_idx
  ON public.station_feedback (station_id, created_at DESC);

-- When the catalog changes a station's identity or location, its old Google
-- match and photo references are no longer trustworthy. Clear them so the
-- next enrichment pass re-queries Google for the new details.
CREATE OR REPLACE FUNCTION public.reset_station_place_enrichment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.station_name IS DISTINCT FROM OLD.station_name
     OR NEW.address IS DISTINCT FROM OLD.address
     OR round(NEW.latitude::numeric, 6) IS DISTINCT FROM round(OLD.latitude::numeric, 6)
     OR round(NEW.longitude::numeric, 6) IS DISTINCT FROM round(OLD.longitude::numeric, 6) THEN
    NEW.google_place_id := NULL;
    NEW.photo_references := '{}';
    NEW.place_details := '{}'::jsonb;
    NEW.photo_enriched_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reset_station_place_enrichment_on_update
  ON public.ev_charging_stations;
CREATE TRIGGER reset_station_place_enrichment_on_update
  BEFORE UPDATE ON public.ev_charging_stations
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_station_place_enrichment();
