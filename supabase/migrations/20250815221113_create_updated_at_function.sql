-- Shared trigger helper used by ev_charging_stations.
-- This existed in the original project but was never checked into migrations;
-- add it here so a fresh database can replay the full migration history.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
