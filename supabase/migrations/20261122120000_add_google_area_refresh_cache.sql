-- Demand-driven Google Places gap fill.
-- Stores only a small "we looked here recently" marker per rounded map cell,
-- plus a durable log so query-triggered DB refreshes are observable.

CREATE TABLE IF NOT EXISTS public.google_area_cache (
  cell text PRIMARY KEY,
  center_lat numeric NOT NULL,
  center_lng numeric NOT NULL,
  radius_km numeric NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'empty', 'failed')),
  found_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  enriched_count integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_area_cache_last_checked
  ON public.google_area_cache (last_checked_at DESC);

DROP TRIGGER IF EXISTS trg_google_area_cache_updated_at ON public.google_area_cache;
CREATE TRIGGER trg_google_area_cache_updated_at
  BEFORE UPDATE ON public.google_area_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.google_area_refresh_log (
  id bigserial PRIMARY KEY,
  cell text NOT NULL,
  status text NOT NULL,
  found_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  enriched_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_area_refresh_log_cell_created
  ON public.google_area_refresh_log (cell, created_at DESC);
