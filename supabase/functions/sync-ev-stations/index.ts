import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EVStationData {
  station_name: string;
  provider: string;
  latitude: number;
  longitude: number;
  address: string;
  charger_type?: string;
  connector_types?: string[];
  availability_status?: string;
  maps_link?: string;
  external_id?: string;
  pricing?: string;
  power_output?: string;
}

async function fetchTataPowerStations(): Promise<EVStationData[]> {
  try {
    // Tata Power EZ Charge API integration
    console.log('Fetching Tata Power stations...');
    
    // For now, return sample data - replace with actual API call when API key is available
    return [
      {
        station_name: "Tata Power EZ Charge - Phoenix Marketcity",
        provider: "Tata Power",
        latitude: 19.0874,
        longitude: 72.9114,
        address: "Phoenix Marketcity, Kurla West, Mumbai",
        charger_type: "DC Fast Charger",
        connector_types: ["CCS2", "CHAdeMO"],
        availability_status: "available",
        power_output: "60kW",
        pricing: "₹12/kWh"
      }
    ];
  } catch (error) {
    console.error('Error fetching Tata Power stations:', error);
    return [];
  }
}

async function fetchAtherGridStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Ather Grid stations...');
    
    // Sample Ather Grid stations - replace with actual API integration
    return [
      {
        station_name: "Ather Grid - Koramangala",
        provider: "Ather Energy",
        latitude: 12.9279,
        longitude: 77.6271,
        address: "Koramangala, Bangalore",
        charger_type: "DC Fast Charger",
        connector_types: ["CCS2"],
        availability_status: "available",
        power_output: "30kW",
        pricing: "₹10/kWh"
      }
    ];
  } catch (error) {
    console.error('Error fetching Ather Grid stations:', error);
    return [];
  }
}

async function fetchNITIAayogData(): Promise<EVStationData[]> {
  try {
    console.log('Fetching NITI Aayog E-Amrit data...');
    
    // NITI Aayog E-Amrit Dataset integration
    const response = await fetch('https://e-amrit.niti.gov.in/assets/data/charging_stations.json');
    if (!response.ok) {
      throw new Error(`NITI Aayog API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Transform NITI data to our schema
    return data.map((station: any) => ({
      station_name: station.name || station.station_name,
      provider: station.operator || "Government",
      latitude: parseFloat(station.latitude || station.lat),
      longitude: parseFloat(station.longitude || station.lng),
      address: station.address || station.location,
      charger_type: station.charger_type,
      connector_types: station.connector_types ? station.connector_types.split(',') : [],
      availability_status: station.status || 'unknown',
      external_id: station.id,
      power_output: station.power_kw ? `${station.power_kw}kW` : undefined
    }));
  } catch (error) {
    console.error('Error fetching NITI Aayog data:', error);
    return [];
  }
}

async function fetchStatiqStations(): Promise<EVStationData[]> {
  try {
    console.log('Fetching Statiq stations...');
    
    // Sample Statiq stations - replace with actual scraping/API
    return [
      {
        station_name: "Statiq - DLF Cybercity",
        provider: "Statiq",
        latitude: 28.4945,
        longitude: 77.0863,
        address: "DLF Cybercity, Gurugram",
        charger_type: "AC Charger",
        connector_types: ["Type 2"],
        availability_status: "available",
        power_output: "22kW",
        pricing: "₹8/kWh"
      }
    ];
  } catch (error) {
    console.error('Error fetching Statiq stations:', error);
    return [];
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('Starting EV stations sync...');
    
    // Fetch data from all sources
    const [tataPowerStations, atherStations, nitiStations, statiqStations] = await Promise.all([
      fetchTataPowerStations(),
      fetchAtherGridStations(),
      fetchNITIAayogData(),
      fetchStatiqStations()
    ]);
    
    const allStations = [
      ...tataPowerStations,
      ...atherStations,
      ...nitiStations,
      ...statiqStations
    ];
    
    console.log(`Collected ${allStations.length} stations from all sources`);
    
    if (allStations.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'No stations fetched from any source' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Insert/update stations in database
    const { data, error } = await supabase
      .from('ev_charging_stations')
      .upsert(allStations, {
        onConflict: 'provider,station_name,latitude,longitude',
        ignoreDuplicates: false
      });
    
    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message 
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    console.log(`Successfully synced ${allStations.length} EV charging stations`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: allStations.length,
        sources: {
          'Tata Power': tataPowerStations.length,
          'Ather Grid': atherStations.length,
          'NITI Aayog': nitiStations.length,
          'Statiq': statiqStations.length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});