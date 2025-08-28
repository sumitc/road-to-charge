import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OpenChargeMapStation {
  ID: number;
  AddressInfo: {
    Title: string;
    AddressLine1: string;
    Town: string;
    StateOrProvince: string;
    Latitude: number;
    Longitude: number;
  };
  OperatorInfo?: {
    Title: string;
  };
  StatusType?: {
    Title: string;
  };
  Connections?: Array<{
    ConnectionType?: {
      Title: string;
    };
    PowerKW?: number;
    Level?: {
      Title: string;
    };
  }>;
  UsageType?: {
    Title: string;
  };
}

interface ChargingStation {
  station_name: string;
  provider: string;
  latitude: number;
  longitude: number;
  address: string;
  charger_type?: string;
  connector_types?: string[];
  availability_status: string;
  power_output?: string;
  pricing?: string;
  external_id: string;
  maps_link: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting charging stations fetch...');
    
    const openChargeMapApiKey = Deno.env.get('OPEN_CHARGE_MAP_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!openChargeMapApiKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { latitude, longitude, radius = 50 } = await req.json();

    if (!latitude || !longitude) {
      throw new Error('Latitude and longitude are required');
    }

    console.log(`Fetching stations around ${latitude}, ${longitude} with radius ${radius}km`);

    // Fetch from Open Charge Map API for India
    const ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=IN&latitude=${latitude}&longitude=${longitude}&distance=${radius}&maxresults=100&compact=true&key=${openChargeMapApiKey}`;
    
    console.log('Fetching from Open Charge Map:', ocmUrl);
    
    const ocmResponse = await fetch(ocmUrl);
    if (!ocmResponse.ok) {
      throw new Error(`Open Charge Map API error: ${ocmResponse.status}`);
    }

    const ocmData: OpenChargeMapStation[] = await ocmResponse.json();
    console.log(`Found ${ocmData.length} stations from Open Charge Map`);

    // Transform OCM data to our format
    const transformedStations: ChargingStation[] = ocmData.map(station => {
      const operatorName = station.OperatorInfo?.Title || 'Unknown Provider';
      const connectorTypes = station.Connections?.map(conn => conn.ConnectionType?.Title).filter(Boolean) || [];
      const powerOutput = station.Connections?.[0]?.PowerKW ? `${station.Connections[0].PowerKW}kW` : undefined;
      const status = station.StatusType?.Title?.toLowerCase() || 'unknown';
      
      let availabilityStatus = 'unknown';
      if (status.includes('operational') || status.includes('available')) {
        availabilityStatus = 'operational';
      } else if (status.includes('temporarily unavailable') || status.includes('maintenance')) {
        availabilityStatus = 'maintenance';
      } else if (status.includes('not operational') || status.includes('out of service')) {
        availabilityStatus = 'out-of-service';
      }

      const address = [
        station.AddressInfo.AddressLine1,
        station.AddressInfo.Town,
        station.AddressInfo.StateOrProvince
      ].filter(Boolean).join(', ');

      return {
        station_name: station.AddressInfo.Title,
        provider: operatorName,
        latitude: station.AddressInfo.Latitude,
        longitude: station.AddressInfo.Longitude,
        address: address,
        charger_type: station.Connections?.[0]?.Level?.Title,
        connector_types: connectorTypes,
        availability_status: availabilityStatus,
        power_output: powerOutput,
        pricing: station.UsageType?.Title?.includes('Payment') ? 'Paid' : undefined,
        external_id: `ocm_${station.ID}`,
        maps_link: `https://www.google.com/maps?q=${station.AddressInfo.Latitude},${station.AddressInfo.Longitude}`
      };
    });

    console.log(`Transformed ${transformedStations.length} stations`);

    // Check which stations already exist in database
    const existingExternalIds = await supabase
      .from('ev_charging_stations')
      .select('external_id')
      .in('external_id', transformedStations.map(s => s.external_id));

    const existingIds = new Set(existingExternalIds.data?.map(row => row.external_id) || []);
    const newStations = transformedStations.filter(station => !existingIds.has(station.external_id));

    console.log(`Found ${newStations.length} new stations to insert`);

    if (newStations.length > 0) {
      // Insert new stations in batches
      const batchSize = 100;
      let insertedCount = 0;

      for (let i = 0; i < newStations.length; i += batchSize) {
        const batch = newStations.slice(i, i + batchSize);
        
        const { error } = await supabase
          .from('ev_charging_stations')
          .insert(batch);

        if (error) {
          console.error('Error inserting batch:', error);
          throw error;
        }

        insertedCount += batch.length;
        console.log(`Inserted batch ${Math.ceil((i + batchSize) / batchSize)} - Total: ${insertedCount}`);
      }
    }

    // Return summary
    const result = {
      success: true,
      message: `Successfully processed ${transformedStations.length} stations from Open Charge Map`,
      stats: {
        fetched: transformedStations.length,
        new: newStations.length,
        existing: transformedStations.length - newStations.length
      },
      networks_found: [...new Set(transformedStations.map(s => s.provider))]
    };

    console.log('Fetch completed:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in fetch-charging-stations function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message,
      details: error.stack
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});