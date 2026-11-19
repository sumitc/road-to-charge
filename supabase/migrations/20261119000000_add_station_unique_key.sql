-- Unique key used by the sync upsert (provider, station_name, lat, lng).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ev_stations_unique
  ON public.ev_charging_stations (provider, station_name, latitude, longitude);
