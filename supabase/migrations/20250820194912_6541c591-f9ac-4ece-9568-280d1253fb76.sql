-- Add index for latitude/longitude queries if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ev_stations_lat_lng') THEN
        CREATE INDEX idx_ev_stations_lat_lng ON public.ev_charging_stations (latitude, longitude);
    END IF;
END $$;

-- Add index for provider queries if it doesn't exist  
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ev_stations_provider') THEN
        CREATE INDEX idx_ev_stations_provider ON public.ev_charging_stations (provider);
    END IF;
END $$;