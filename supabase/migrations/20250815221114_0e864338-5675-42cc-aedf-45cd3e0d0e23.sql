-- Create table for EV charging stations
CREATE TABLE public.ev_charging_stations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address TEXT NOT NULL,
  charger_type TEXT,
  connector_types TEXT[],
  availability_status TEXT DEFAULT 'unknown',
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  maps_link TEXT,
  external_id TEXT,
  pricing TEXT,
  power_output TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ev_charging_stations ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (no authentication required for viewing stations)
CREATE POLICY "Anyone can view charging stations" 
ON public.ev_charging_stations 
FOR SELECT 
USING (true);

-- Create index for efficient location-based queries
CREATE INDEX idx_ev_stations_location ON public.ev_charging_stations USING btree (latitude, longitude);
CREATE INDEX idx_ev_stations_provider ON public.ev_charging_stations (provider);
CREATE INDEX idx_ev_stations_updated ON public.ev_charging_stations (last_updated);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_ev_stations_updated_at
BEFORE UPDATE ON public.ev_charging_stations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();