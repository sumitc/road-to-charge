-- Enrich the EV charging station dictionary with connector-level, vehicle,
-- ownership, live-availability and provenance fields.
--
-- Sources that now populate these columns:
--   * BEE / Ministry of Power (via ev-charging-stations-api.vercel.app)
--   * OpenEV - Delhi Transport (live connector availability)
--   * OpenStreetMap Overpass (socket:* tags)
--   * Google Places API (New) evChargeOptions
--   * OCPI 2.2.1 location feeds

ALTER TABLE public.ev_charging_stations
  ADD COLUMN IF NOT EXISTS connectors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_power_kw NUMERIC,
  ADD COLUMN IF NOT EXISTS max_kw_by_standard JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_chargers INTEGER,
  ADD COLUMN IF NOT EXISTS total_connectors INTEGER,
  ADD COLUMN IF NOT EXISTS vehicle_classes TEXT[] NOT NULL DEFAULT '{}',
  -- `current` is a reserved word, hence the prefixed column name.
  ADD COLUMN IF NOT EXISTS charging_current TEXT,
  ADD COLUMN IF NOT EXISTS ownership TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS location_quality TEXT NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS mixed_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_hours TEXT,
  ADD COLUMN IF NOT EXISTS payment_modes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_numbers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS staff TEXT,
  ADD COLUMN IF NOT EXISTS access TEXT,
  ADD COLUMN IF NOT EXISTS fee BOOLEAN,
  ADD COLUMN IF NOT EXISTS station_type TEXT NOT NULL DEFAULT 'charging',
  ADD COLUMN IF NOT EXISTS available_count INTEGER,
  ADD COLUMN IF NOT EXISTS out_of_service_count INTEGER,
  ADD COLUMN IF NOT EXISTS availability_last_update TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_rider_report TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS data_as_of TEXT,
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Indexes for the new dictionary filters.
CREATE INDEX IF NOT EXISTS idx_ev_stations_state ON public.ev_charging_stations (state);
CREATE INDEX IF NOT EXISTS idx_ev_stations_city ON public.ev_charging_stations (city);
CREATE INDEX IF NOT EXISTS idx_ev_stations_ownership ON public.ev_charging_stations (ownership);
CREATE INDEX IF NOT EXISTS idx_ev_stations_station_type ON public.ev_charging_stations (station_type);
CREATE INDEX IF NOT EXISTS idx_ev_stations_max_power ON public.ev_charging_stations (max_power_kw DESC);
CREATE INDEX IF NOT EXISTS idx_ev_stations_vehicle_classes ON public.ev_charging_stations USING GIN (vehicle_classes);

COMMENT ON COLUMN public.ev_charging_stations.connectors IS
  'Gun-level detail: [{standard, kw, chargerKw, count, availableCount, outOfServiceCount, lastUpdate}]';
COMMENT ON COLUMN public.ev_charging_stations.location_quality IS
  'ok or suspect. Suspect coordinates (e.g. latitude == longitude) should not be used for routing.';
COMMENT ON COLUMN public.ev_charging_stations.source_name IS
  'Origin of the record, e.g. bee_api, openev_delhi, osm, google_places, ocpi.';
